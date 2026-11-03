import { spawn } from 'node:child_process'
import path from 'node:path'
import { developmentEnvironment, workspace } from './environment.mjs'
import { buildDevelopmentCore } from '../desktop-development/core-build.mjs'

const [mode, ...args] = process.argv.slice(2)
const env = developmentEnvironment()
const core = mode === 'core'
if (!core && mode !== 'pnpm') throw new Error('用法：node scripts/ai-service/develop.mjs core | pnpm <命令>')
// Core 仍由独立开发终端持有；前端开发只启动既有的 Vite/Electron 流程。
const supplied = core ? args : [process.env.npm_execpath, ...args]
if (supplied.some(value => !value)) throw new Error('请通过 pnpm run dev 或 pnpm run dev:env 启动前端开发命令。')
let child
let interrupted = false
const signals = ['SIGINT', 'SIGTERM'].map(signal => {
  const stop = () => { interrupted = true; if (child && !child.killed) child.kill(signal) }
  process.on(signal, stop)
  return [signal, stop]
})
const run = (command, parameters) => new Promise((resolve, reject) => {
  if (interrupted) { reject(new Error('开发启动已取消')); return }
  child = spawn(command, parameters, { cwd: path.join(workspace, core ? 'backend' : 'web'), env, stdio: 'inherit', windowsHide: true })
  child.once('error', reject)
  child.once('close', code => {
    child = null
    if (code === 0) resolve()
    else reject(Object.assign(new Error(`开发进程退出：${code ?? 'signal'}`), { exitCode: code ?? 1 }))
  })
})
try {
  const command = core ? await buildDevelopmentCore({ workspace, env, run }) : process.execPath
  await run(command, supplied)
} catch (error) {
  console.error(error.message)
  process.exitCode = error.exitCode ?? 1
} finally {
  for (const [signal, stop] of signals) process.off(signal, stop)
}
