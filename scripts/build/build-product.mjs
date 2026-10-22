import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../../', import.meta.url))
const argumentsList = process.argv.slice(2)

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: web, stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`构建命令失败：${code}`)))
  })
}

async function main() {
  const platform = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform]
  if (!platform || (process.platform === 'darwin' ? process.arch !== 'arm64' : process.arch !== 'x64')) {
    throw new Error('构建支持 Windows/Linux x64 和 macOS ARM64')
  }
  const tools = process.env.TERMOUS_BUILDTOOLS_DIR || path.resolve(web, '../termous-buildtools')
  const entry = path.join(tools, 'build.py')
  if (!existsSync(entry)) throw new Error('缺少 termous-buildtools，请先准备统一构建工具链')
  await run(process.env.PYTHON || (platform === 'windows' ? 'python' : 'python3.12'), [entry, 'build', '--config',
    process.env.TERMOUS_BUILD_CONFIG || path.join(tools, `configs/local.${platform}.json`), ...argumentsList])
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
