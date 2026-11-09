import assert from 'node:assert/strict'
import { mkdir, mkdtemp, open, access } from 'node:fs/promises'
import { createServer as createSocket } from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { build, createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.resolve(root, '../TEMP/workflow-exchange/ui')
const executable = path.resolve(process.env.TERMOUS_WORKFLOW_CORE || path.join(output, '../termous-core.exe'))
await access(executable)
await mkdir(output, { recursive: true })
const directory = await mkdtemp(path.join(output, 'run-'))
const socket = createSocket()
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
const address = socket.address(); assert(address && typeof address !== 'string')
await new Promise(resolve => socket.close(resolve))
const api = `http://127.0.0.1:${address.port}`
const headers = { 'X-Termous-Token': 'workflow-exchange-acceptance' }
const log = await open(path.join(directory, 'core.log'), 'w')
const core = spawn(executable, ['-addr', `127.0.0.1:${address.port}`], { cwd: directory, windowsHide: true,
  env: { ...process.env, TERMOUS_DATA_DIR: path.join(directory, 'core-data'), TERMOUS_API_TOKEN: headers['X-Termous-Token'],
    TERMOUS_REQUIRE_HEARTBEAT: '0', TERMOUS_LOG_LEVEL: 'warn' }, stdio: ['ignore', log.fd, log.fd] })
let coreError
core.on('error', error => { coreError = error })
let vite, electron
try {
  const deadline = Date.now() + 60000
  for (;;) {
    if (coreError) throw coreError
    assert(core.exitCode === null, '隔离 Core 启动失败，请查看 core.log')
    if (await fetch(`${api}/api/v1/desktop-workflows`, { headers }).then(r => r.ok, () => false)) break
    assert(Date.now() < deadline, '隔离 Core 启动超时')
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  for (const [entry, name, format] of [
    ['scripts/desktop/workflow-exchange-ui-acceptance.ts', 'ui-acceptance.mjs', 'es'],
    ['electron/preload.ts', 'preload.cjs', 'cjs'],
    ['electron/detached-preload.ts', 'detached-preload.cjs', 'cjs'],
  ]) await build({ configFile: false, root, logLevel: 'warn', ssr: { noExternal: true, external: ['electron'] },
    build: { ssr: path.join(root, entry), outDir: output, emptyOutDir: false, target: 'node24', minify: false,
      rolldownOptions: { external: ['electron'], output: { format, entryFileNames: name, codeSplitting: false } } } })
  // 开发版 React 保留 StrictMode 的 effect 重放，避免生产打包掩盖生命周期回归。
  process.env.NODE_ENV = 'development'
  vite = await createServer({ configFile: false, root, plugins: [react()], logLevel: 'warn', cacheDir: path.join(output, 'vite-cache'),
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: api, ws: true } } } })
  await vite.listen()
  const require = createRequire(import.meta.url)
  electron = spawn(require('electron'), [path.join(output, 'ui-acceptance.mjs'), directory],
    { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env,
      TERMOUS_EXCHANGE_UI_URL: vite.resolvedUrls.local[0], TERMOUS_EXCHANGE_CORE_URL: api } })
  const timer = setTimeout(() => { console.error('工作流界面文件交换验收超时'); electron.kill() }, 180000)
  try {
    const code = await new Promise((resolve, reject) => { electron.once('exit', resolve); electron.once('error', reject) })
    assert.equal(code, 0, `界面验收失败，产物：${directory}`)
  } finally { clearTimeout(timer) }
  console.log(`完整界面验收产物：${directory}`)
} finally {
  if (electron && electron.exitCode === null) electron.kill()
  await vite?.close()
  try { await fetch(`${api}/api/v1/runtime/shutdown`, { method: 'POST', headers, signal: AbortSignal.timeout(5000) }) }
  catch (error) { if (core.exitCode === null) console.warn('隔离 Core 正常退出请求失败', error.message) }
  if (core.exitCode === null) await new Promise(resolve => {
    const timeout = setTimeout(() => { core.kill(); resolve() }, 10000)
    core.once('exit', () => { clearTimeout(timeout); resolve() })
  })
  await log.close()
}
