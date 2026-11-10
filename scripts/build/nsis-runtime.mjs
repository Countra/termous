import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const builderRequire = createRequire(import.meta.resolve('electron-builder'))

export async function withNsisCompatibility(target, action) {
  if (target !== 'windows-x64') return action()
  const previous = process.env.ELECTRON_BUILDER_7Z_FILTER
  // 新版 7-Zip 会自动为 Python 包中的 ARM64 模板选用旧 Nsis7z 不支持的过滤器。
  // 固定双方支持的 BCJ，保留全部文件，不改变运行时合同与更新包格式。
  process.env.ELECTRON_BUILDER_7Z_FILTER = 'BCJ'
  try {
    return await action()
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_BUILDER_7Z_FILTER
    else process.env.ELECTRON_BUILDER_7Z_FILTER = previous
  }
}

async function files(root, relative = '') {
  const info = await lstat(path.join(root, relative))
  if (info.isSymbolicLink()) throw new Error(`运行组件不能包含链接：${relative}`)
  if (info.isFile()) return [relative]
  if (!info.isDirectory()) throw new Error(`运行组件文件类型无效：${relative}`)
  const result = []
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    result.push(...await files(root, path.join(relative, name)))
  }
  return result
}

async function hash(file) {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  return digest.digest('hex')
}

export async function compareRuntimeFiles(expected, extracted) {
  const names = await files(expected)
  if (names.length === 0) throw new Error('运行组件载荷为空')
  const actual = new Set(await files(extracted))
  for (const name of names) {
    if (!actual.delete(name)) throw new Error(`NSIS 解压遗漏运行组件：${name}`)
    const source = path.join(expected, name)
    const target = path.join(extracted, name)
    if ((await lstat(source)).size !== (await lstat(target)).size || await hash(source) !== await hash(target)) {
      throw new Error(`NSIS 解压后的运行组件内容不一致：${name}`)
    }
  }
  if (actual.size > 0) throw new Error(`NSIS 解压出现额外运行组件：${actual.values().next().value}`)
  return names.length
}

function nsisPath(value, runtime = false) {
  if (/["\r\n\0]/.test(value)) throw new Error('NSIS 验收路径包含非法字符')
  // 编译期路径不展开变量，只有运行期字符串需要转义美元符号。
  return runtime ? value.replaceAll('$', () => '$$') : value
}

export async function verifyNsisRuntime({ archive, unpacked, work, config, tools }) {
  // 使用构建器实际选择的插件，不能以 7za 自检代替安装器的解码能力。
  if (!tools) {
    const { getMakeNsisPath, getNsisPluginsPath } = builderRequire('app-builder-lib/out/toolsets/windows.js')
    tools = {
      compiler: await getMakeNsisPath(config.toolsets?.nsis, config.nsis?.customNsisBinary),
      plugins: await getNsisPluginsPath(config.toolsets?.nsis, config.nsis?.customNsisResources),
    }
  }
  await mkdir(work, { recursive: true })
  const directory = await mkdtemp(path.join(work, 'nsis-runtime-'))
  try {
    const output = path.join(directory, 'extracted')
    const executable = path.join(directory, 'extract.exe')
    const script = path.join(directory, 'extract.nsi')
    await writeFile(script, `Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
Name "Termous runtime extraction check"
OutFile "${nsisPath(executable)}"
!addplugindir /x86-unicode "${nsisPath(path.join(tools.plugins, 'x86-unicode'))}"
Section
  SetDetailsPrint none
  SetOutPath "${nsisPath(output, true)}"
  Nsis7z::Extract "${nsisPath(archive, true)}"
SectionEnd
`, 'utf8')
    const options = { windowsHide: true, timeout: 300000, maxBuffer: 1 << 20 }
    await run(tools.compiler.path, ['/V2', '/INPUTCHARSET', 'UTF8', script], {
      ...options, env: { ...process.env, ...tools.compiler.env },
    })
    // 夹具只解压到隔离临时目录，不包含安装宏、注册表、服务、ACL 或 UAC 操作。
    await run(executable, ['/S'], { ...options, env: { ...process.env, TEMP: directory, TMP: directory } })
    const count = await compareRuntimeFiles(path.join(unpacked, 'runtime/python'), path.join(output, 'runtime/python'))
    console.log(`NSIS 运行组件解压校验通过：${count} 个文件`)
    await rm(directory, { recursive: true, force: true })
  } catch (error) {
    throw new Error(`${error.message}\nNSIS 解压验收目录：${directory}`, { cause: error })
  }
}
