import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const output = path.resolve(root, '../TEMP/vnc-handoff')
await mkdir(output, { recursive: true })
const children = []
// 只连接本轮创建的夹具，端口已被占用时不接触现有进程。
for (const port of [5191, 5192, 5194, 5195]) {
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()))
  })
}
const start = (command, args, cwd, env = process.env) => {
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  let log = ''
  child.stdout.on('data', data => { log += data })
  child.stderr.on('data', data => { log += data })
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)) })
  return { child, done, log: () => log }
}
const ready = async (url, process) => {
  const deadline = Date.now() + 30_000
  for (;;) {
    if (process.child.exitCode !== null) throw new Error(process.log())
    try { if ((await fetch(url, { headers: { 'X-Termous-Fixture': 'desktop' }, signal: AbortSignal.timeout(500) })).ok) return } catch { /* 只等待本轮启动的回环夹具。 */ }
    if (Date.now() > deadline) throw new Error(`夹具启动超时: ${url}\n${process.log()}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
const executable = path.join(output, process.platform === 'win32' ? 'host-fixture.exe' : 'host-fixture')
let server, host, electron, timeout
try {
  timeout = setTimeout(() => {
    console.error('VNC 交接验收超时')
    for (const child of children) if (child.exitCode === null) child.kill()
  }, 240_000)
  console.log('正在检查浏览器夹具类型')
  const check = start(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'scripts/desktop/tsconfig.vnc-handoff.json'], root)
  if (await check.done !== 0) throw new Error(check.log())
  console.log('正在编译后端夹具')
  const compile = start('go', ['test', '-c', '-o', executable, './internal/service/remotecontrol/host'], path.resolve(root, '../backend'))
  if (await compile.done !== 0) throw new Error(compile.log())
  console.log('正在启动本机 VNC 和远控夹具')
  server = start(process.execPath, ['scripts/desktop/fixture-server.mjs'], root)
  await ready('http://127.0.0.1:5191/scripts/desktop/remote-fixture.html', server)
  host = start(executable, ['-test.run=^TestRemoteDesktopBrowserFixture$', '-test.timeout=3m', '-test.v'], path.resolve(root, '../backend'), { ...process.env, TERMOUS_REMOTE_DESKTOP_FIXTURE: '1', TERMOUS_RDP_VIDEO_FIXTURE: '0' })
  await ready('http://127.0.0.1:5195/fixture/session', host)
  console.log('正在验证 Electron 画面、输入和观看交接')
  electron = start(require('electron'), ['scripts/desktop/vnc-handoff-acceptance.mjs', output], root)
  if (await electron.done !== 0) throw new Error(electron.log())
  if (await host.done !== 0) throw new Error(host.log())
  console.log(electron.log())
} finally {
  clearTimeout(timeout)
  for (const child of children) if (child.exitCode === null) child.kill()
  if (host) await writeFile(path.join(output, 'host.log'), host.log())
  if (server) await writeFile(path.join(output, 'server.log'), server.log())
  if (electron) await writeFile(path.join(output, 'electron.log'), electron.log())
}
