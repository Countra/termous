import { spawn } from 'node:child_process'
import path from 'node:path'
import { developmentEnvironment, workspace } from './environment.mjs'
import { buildDevelopmentCore, buildDevelopmentDaemon } from '../desktop-development/core-build.mjs'

const [mode, ...args] = process.argv.slice(2)
const env = ['desktopd', 'desktop-build', 'desktop-status'].includes(mode) ? { ...process.env } : developmentEnvironment()
const core = mode === 'core'
const backend = mode !== 'pnpm'
if (!['core', 'pnpm', 'desktopd', 'desktop-build', 'desktop-status'].includes(mode)) throw new Error('用法：node scripts/ai-service/develop.mjs core | desktopd | desktop-build | desktop-status | pnpm <命令>')
// Core 仍由独立开发终端持有；前端开发只启动既有的 Vite/Electron 流程。
const supplied = backend ? args : [process.env.npm_execpath, ...args]
if (supplied.some(value => !value)) throw new Error('请通过 pnpm run dev 或 pnpm run dev:env 启动前端开发命令。')
let child
let interrupted = false
const signals = ['SIGINT', 'SIGTERM'].map(signal => {
  const stop = () => { interrupted = true; if (child && !child.killed) child.kill(signal) }
  process.on(signal, stop)
  return [signal, stop]
})
const run = (command, parameters, options = {}) => new Promise((resolve, reject) => {
  if (interrupted) { reject(new Error('开发启动已取消')); return }
  let output = ''
  child = spawn(command, parameters, { cwd: path.join(workspace, backend ? 'backend' : 'web'), env: options.env ?? env,
    stdio: options.captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit', windowsHide: true })
  if (options.captureOutput) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk })
  }
  child.once('error', reject)
  child.once('close', code => {
    child = null
    if (code === 0) resolve(output)
    else reject(Object.assign(new Error(`开发进程退出：${code ?? 'signal'}`), { exitCode: code ?? 1 }))
  })
})
try {
  if (mode === 'desktop-build') {
    await buildDevelopmentCore({ workspace, env, run, includeDaemon: true })
  } else if (mode === 'desktopd') {
    const command = await buildDevelopmentDaemon({ workspace, env, run })
    await run(command, ['foreground', ...supplied])
  } else if (mode === 'desktop-status') {
    await run(path.join(workspace, 'TEMP', 'core-development', `${process.platform}-${process.arch}`, 'termous-desktopd.exe'), ['status', ...supplied])
  } else {
    const command = core ? await buildDevelopmentCore({ workspace, env, run }) : process.execPath
    await run(command, supplied)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = error.exitCode ?? 1
} finally {
  for (const [signal, stop] of signals) process.off(signal, stop)
}
