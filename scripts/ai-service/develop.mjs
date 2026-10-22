import { spawn } from 'node:child_process'
import path from 'node:path'
import { developmentEnvironment, workspace } from './environment.mjs'

const [mode, ...args] = process.argv.slice(2)
const env = developmentEnvironment()
const core = mode === 'core'
if (!core && mode !== 'pnpm') throw new Error('用法：node scripts/ai-service/develop.mjs core | pnpm <命令>')
// Core 仍由独立开发终端持有；前端开发只启动既有的 Vite/Electron 流程。
const command = core ? 'go' : process.execPath
const supplied = core ? ['run', './cmd/termous-core', ...args] : [process.env.npm_execpath, ...args]
if (supplied.some(value => !value)) throw new Error('请通过 pnpm run dev 或 pnpm run dev:env 启动前端开发命令。')
const child = spawn(command, supplied, { cwd: path.join(workspace, core ? 'backend' : 'web'), env, stdio: 'inherit', windowsHide: true })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (!child.killed) child.kill(signal) })
