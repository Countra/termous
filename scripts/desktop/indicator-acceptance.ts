import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'
import { DesktopIndicatorRuntime } from '../../electron/desktopIndicator/runtime.ts'
import type { DesktopControlSnapshot } from '../../common/contracts/desktop-controls.ts'

async function main() {
const [root, output] = process.argv.slice(2)
app.setPath('userData', path.join(output, 'electron-profile'))
app.on('window-all-closed', () => { /* 崩溃恢复期间保持测试进程存活。 */ })
const snapshot: DesktopControlSnapshot = { instance_id: 'fixture-core', controls: [{
  target: { kind: 'host_desktop', instance_id: 'fixture-capture', host: { id: 'display', title: '测试桌面', kind: 'screen', generation: 1 } },
  reference: 'a'.repeat(64), source: 'agent', name: 'Termous Agent', active: true,
}] }
let current = snapshot
let reclaims = 0
const server = createServer(async (req, res) => {
  if (req.url === '/api/v1/desktop-controls/reclaim') {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.equal(request.reference, current.controls[0]?.reference)
    reclaims++
    current = { ...snapshot, controls: [] }
    publish()
    res.writeHead(204).end()
    return
  }
  res.writeHead(404).end()
})
const ws = new WebSocketServer({ server, path: '/api/v1/desktop-controls/events' })
const publish = () => { for (const c of ws.clients) if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(current)) }
ws.on('connection', publish)
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}`
const until = async (check: () => boolean | Promise<boolean>) => {
  const limit = Date.now() + 15000
  while (!await check()) {
    if (Date.now() > limit) throw new Error('等待浮层状态超时')
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}
let runtime: DesktopIndicatorRuntime | undefined
let exitCommitted = false
try {
  await app.whenReady()
  runtime = new DesktopIndicatorRuntime({ config: async () => ({ apiBaseUrl: url, apiToken: 'fixture-token', version: 'test' }),
    exitCommitted: () => exitCommitted,
    appearance: () => ({ language: 'zh-CN', theme: 'dark' }), preload: path.join(root, 'dist-electron/desktop-indicator-preload.cjs'),
    renderer: path.join(root, 'dist/index.html'),
    warn: code => console.log(code), reclaimFailed: () => { throw new Error('不应触发收回失败') },
  })
  runtime.start()
  await until(() => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length === 2)
  const bar = BrowserWindow.getAllWindows().find(w => w.isFocusable())!
  const badge = BrowserWindow.getAllWindows().find(w => !w.isFocusable())!
  await until(() => bar.webContents.executeJavaScript("Boolean(document.querySelector('button'))"))
  assert.equal(bar.isAlwaysOnTop(), true)
  assert.equal(badge.isAlwaysOnTop(), true)
  assert.equal(bar.isFocused(), false)
  assert.equal(badge.isFocused(), false)
  assert.equal(await badge.webContents.executeJavaScript('Boolean(window.termous || window.termousDesktopAutomation)'), false)
  await assert.rejects(badge.webContents.executeJavaScript(`window.termousDesktopIndicator.reclaim(${JSON.stringify({ instance_id: snapshot.instance_id, ...snapshot.controls[0] })})`))
  await writeFile(path.join(output, 'bar.png'), (await bar.webContents.capturePage()).toPNG())
  await writeFile(path.join(output, 'badge.png'), (await badge.webContents.capturePage()).toPNG())
  await bar.webContents.executeJavaScript("document.querySelector('button').click()")
  await until(() => BrowserWindow.getAllWindows().every(w => !w.isVisible()))
  assert.equal(reclaims, 1)
  current = { ...snapshot, controls: [{ ...snapshot.controls[0], reference: 'b'.repeat(64) }] }
  publish()
  await until(() => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length === 2)
  for (const client of ws.clients) client.terminate()
  await until(() => BrowserWindow.getAllWindows().every(w => !w.isVisible()))
  assert.equal(reclaims, 1)
  await until(() => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length === 2)
  const old = BrowserWindow.getAllWindows()[0]
  old.webContents.forcefullyCrashRenderer()
  await until(() => old.isDestroyed())
  await until(() => BrowserWindow.getAllWindows().filter(w => w.isVisible()).length === 2)
  assert.equal(reclaims, 1)
  await until(() => BrowserWindow.getAllWindows().find(w => w.isFocusable())!.webContents.executeJavaScript("Boolean(document.querySelector('button'))"))
  // 第一次退出被取消，浮层继续展示；确认退出后必须能到达 will-quit。
  const visible = BrowserWindow.getAllWindows()
  app.once('before-quit', event => event.preventDefault())
  app.quit()
  assert.equal(visible.every(w => !w.isDestroyed() && w.isVisible()), true)
  let reachedWillQuit = false
  app.once('will-quit', event => { event.preventDefault(); reachedWillQuit = true })
  exitCommitted = true
  app.quit()
  await until(() => reachedWillQuit)
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  assert.equal(reclaims, 1)
  console.log('桌面浮层原生验收通过：沙箱、置顶、不抢焦点、收回、重授权、断线、崩溃恢复和退出协调；未注入真实输入。')
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, platform: process.platform, reclaims }))
} catch (error) { console.error(error); process.exitCode = 1 }
finally {
  runtime?.close()
  for (const client of ws.clients) client.terminate()
  ws.close()
  server.close()
  app.exit(process.exitCode ?? 0)
}
}
void main().catch(error => { console.error(error); app.exit(1) })
