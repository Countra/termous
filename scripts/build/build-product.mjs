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
  if (process.platform === 'win32') {
    const tools = process.env.TERMOUS_BUILDTOOLS_DIR || path.resolve(web, '../termous-buildtools')
    const entry = path.join(tools, 'build.py')
    if (!existsSync(entry)) throw new Error('缺少 termous-buildtools，请先准备统一构建工具链')
    await run(process.env.PYTHON || 'python', [entry, 'build', '--config',
      process.env.TERMOUS_BUILD_CONFIG || path.join(tools, 'configs/local.windows.json'), ...argumentsList])
    return
  }
  const phaseIndex = argumentsList.indexOf('--phase')
  const packageOnly = phaseIndex >= 0 && argumentsList[phaseIndex + 1] === 'package'
  if (!packageOnly) {
    if (!process.env.npm_execpath) throw new Error('请通过 pnpm run 调用构建入口')
    await run(process.execPath, [process.env.npm_execpath, 'run', 'typecheck'])
    await run(process.execPath, [process.env.npm_execpath, 'run', 'build:renderer'])
  }
  const packageArgs = phaseIndex < 0 ? argumentsList
    : argumentsList.filter((_, index) => index !== phaseIndex && index !== phaseIndex + 1)
  await run(process.execPath, ['scripts/ci/build-local-package.mjs', ...packageArgs])
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
