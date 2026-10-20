import { spawn } from 'node:child_process'
import { publishCredentialNames } from '../ci/build-local-package.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertShellStopped, withShellPreparation } from './cache.mjs'
import identities from '../../common/desktop-identity/identities.json' with { type: 'json' }

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const identity = identities.development

export function shellExecutable(directory, platform = process.platform, arch = process.arch) {
  const suffix = arch === 'x64' ? '' : `-${arch}`
  if (platform === 'darwin') return path.join(directory, `mac${suffix}`, `${identity.name}.app/Contents/MacOS/${identity.executableName}`)
  return path.join(directory, `${platform === 'win32' ? 'win' : 'linux'}${suffix}-unpacked`, identity.executableName + (platform === 'win32' ? '.exe' : ''))
}

export async function shellFingerprint(root, version, platform, arch) {
  const hash = createHash('sha256').update(JSON.stringify({ root, version, platform, arch, identity }))
  for (const file of ['scripts/desktop-development/bootstrap.mjs', 'scripts/desktop-development/prepare.mjs', 'scripts/desktop-development/build-shell.mjs', 'scripts/desktop-development/cache.mjs', ...['png', 'ico', 'icns'].map(ext => `${identity.iconDirectory}/icon.${ext}`)]) {
    hash.update(await readFile(path.join(root, file)))
  }
  return hash.digest('hex')
}

async function validateShell(directory) {
  const executable = shellExecutable(directory)
  if (!(await stat(executable)).isFile()) throw new Error('开发壳缺少可执行文件')
  const resources = process.platform === 'darwin' ? path.resolve(executable, '../../Resources') : path.join(path.dirname(executable), 'resources')
  const metadata = JSON.parse(await readFile(path.join(resources, 'app/package.json'), 'utf8'))
  if (metadata.termousDesktopChannel !== 'development' || metadata.productName !== identity.name || metadata.main !== 'bootstrap.mjs') throw new Error('开发壳身份校验失败')
  await stat(path.join(resources, 'app/bootstrap.mjs'))
  await stat(path.join(resources, 'icon.png'))
  return executable
}

export async function prepareDevelopmentShell() {
  const cacheRoot = path.resolve(webRoot, '../TEMP/desktop-development', `${process.platform}-${process.arch}`)
  const shell = path.join(cacheRoot, 'shell')
  const version = require('electron/package.json').version
  const fingerprint = await shellFingerprint(webRoot, version, process.platform, process.arch)
  await mkdir(cacheRoot, { recursive: true })
  try {
    if (await readFile(path.join(shell, 'fingerprint'), 'utf8') === fingerprint) {
      const executable = await validateShell(shell)
      return await writeLauncher(cacheRoot, executable)
    }
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
  }
  return withShellPreparation(cacheRoot, async () => {
    await assertShellStopped(cacheRoot)
    const stage = path.join(cacheRoot, `staging-${randomUUID()}`)
    const backup = path.join(cacheRoot, `previous-${randomUUID()}`)
    await mkdir(path.join(stage, 'app'), { recursive: true })
    let moved = false
    try {
      await writeFile(path.join(stage, 'app/package.json'), JSON.stringify({
        name: 'termous-development', version: '0.0.0', private: true, main: 'bootstrap.mjs',
        productName: identity.name, desktopName: identity.desktopName,
        termousDesktopChannel: 'development', termousDevelopmentCache: cacheRoot, termousDevelopmentEntry: path.join(webRoot, 'dist-electron/main.js'),
      }, null, 2))
      await copyFile(path.join(webRoot, 'scripts/desktop-development/bootstrap.mjs'), path.join(stage, 'app/bootstrap.mjs'))
      const environment = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
      for (const key of [...publishCredentialNames, 'TERMOUS_API_TOKEN', 'TERMOUS_API_BASE_URL']) delete environment[key]
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(webRoot, 'scripts/desktop-development/build-shell.mjs'), webRoot, stage, version], { cwd: webRoot, env: environment, windowsHide: true, stdio: 'inherit' })
        child.once('error', reject)
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`开发壳构建失败：${code}`)))
      })
      await validateShell(path.join(stage, 'output'))
      await writeFile(path.join(stage, 'output/fingerprint'), fingerprint)
      try { await rename(shell, backup); moved = true } catch (error) { if (error.code !== 'ENOENT') throw error }
      try { await rename(path.join(stage, 'output'), shell) }
      catch (error) { if (moved) { await rename(backup, shell); moved = false }; throw error }
      const executable = await validateShell(shell)
      if (moved) await rm(backup, { recursive: true })
      return await writeLauncher(cacheRoot, executable)
    } catch (error) {
      throw new Error('无法准备 Termous Dev 开发壳。若开发版正在运行，请关闭后重新运行 pnpm dev；无需退出正式版。', { cause: error })
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  })
}

async function writeLauncher(directory, executable) {
  const launcher = path.join(directory, 'electron-path.cjs')
  await writeFile(launcher, `module.exports = ${JSON.stringify(executable)}\n`)
  return launcher
}
