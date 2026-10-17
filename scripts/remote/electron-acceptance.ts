import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { WebSocketServer } from 'ws'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { EnvelopeSchema, StreamFrameSchema } from '@termous/remote-protocol'
import { RemoteCore } from '../../electron/remoteControl/core'
import { RemoteControlRuntime } from '../../electron/remoteControl/runtime'
import { RemoteTerminalStream } from '../../electron/remoteControl/stream'
import { createPreview } from './previewBridge'

async function main() {
// 只装配真实窗口、preload、HTTP 和二进制桥；业务数据使用隔离夹具。
console.log('启动隔离 Electron 验收')
const output = path.resolve(process.argv[2])
await mkdir(output, { recursive: true })
app.setPath('userData', path.join(output, 'user-data'))
const token = randomUUID()
const { bridge } = createPreview(new URLSearchParams('agent'))
let attachment = Buffer.alloc(0)
let creates = 0, closes = 0, authenticatedRequests = 0, terminalFrames = 0
let rejectUpgrade = false
let activeLocalTransfer = false
const originalMessageBox = dialog.showMessageBox
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.headers['x-termous-token'], token)
    authenticatedRequests++
    const parts: Buffer[] = []
    for await (const chunk of request) parts.push(Buffer.from(chunk))
    const route = new URL(request.url!, 'http://localhost').pathname
    if (route.endsWith('/agent-content')) {
      attachment = Buffer.concat(parts)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ id: 'content-fixture' }))
      return
    }
    if (route.endsWith('/agent-content/content-fixture')) {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end(attachment)
      return
    }
    const input = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {}
    let value: unknown
    if (route === '/api/v1/remote-control/status') value = { generation: '1', available: true }
    else if (route === '/api/v1/cloud/status') value = { generation: '1', authenticated: true }
    else if (route === '/api/v1/remote-control/connections') { creates++; value = (await (creates === 1 ? bridge.connection() : bridge.reconnect()) as { value: unknown }).value }
    else if (route.endsWith('/local-transfers')) value = { tasks: activeLocalTransfer ? [{ id: 'active-transfer', state: 'running', remote_id: '', name: 'fixture.txt', direction: 'download', confirmed_bytes: 0, total_bytes: 1, resumable: false }] : [] }
    else if (route.endsWith('/request')) {
      const result = await bridge.request(input.request, 'preview')
      if (!result.ok) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: result.code } })); return }
      value = result.value
    } else if (route.endsWith('/close')) { closes++; value = {} }
    else if (route.includes('/connections/preview')) value = (await bridge.connection() as { value: unknown }).value
    else throw new Error('未预期的本机接口')
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value))
  } catch {
    response.writeHead(500); response.end()
  }
})
const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  if (request.headers['x-termous-token'] !== token) { socket.destroy(); return }
  if (rejectUpgrade) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return }
  sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws))
})
sockets.on('connection', socket => {
  const stop = bridge.subscribe((_sequence, data) => socket.send(data, { binary: true }), () => socket.close(), 'preview')
  socket.on('message', bytes => { terminalFrames++; void bridge.send(new Uint8Array(bytes as Buffer), 'preview') })
  socket.on('close', stop)
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert(address && typeof address !== 'string')
console.log('本机合成服务已监听')
await app.whenReady()
console.log('Electron 就绪')
const launcher = new BrowserWindow({ show: false, webPreferences: { preload: path.join(output, 'launcher.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
const runtime = new RemoteControlRuntime({
  core: new RemoteCore(async () => ({ apiBaseUrl: `http://127.0.0.1:${address.port}`, apiToken: token })),
  trusted: event => event.sender === launcher.webContents && event.senderFrame === launcher.webContents.mainFrame,
  preload: path.join(output, 'remote-preload.cjs'), renderer: '', devURL: 'http://127.0.0.1:5183/',
  appearance: () => ({ language: 'zh-CN', theme: 'dark' }), warn: code => console.log(code),
})
const until = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 15000
  while (!await check()) { assert(Date.now() < deadline, '窗口状态等待超时'); await new Promise(resolve => setTimeout(resolve, 50)) }
}
try {
  await launcher.loadURL('data:text/html,<title>Isolated remote acceptance</title>')
  console.log('启动窗口已加载')
  const forbidden = await launcher.webContents.executeJavaScript('window.acceptance.call("remote:connection")')
  assert.equal(forbidden.code, 'remote_ipc_forbidden')
  const forbiddenAgent = await launcher.webContents.executeJavaScript('window.acceptance.call("remote:agent-download", "content-fixture", "preview")')
  assert.equal(forbiddenAgent.code, 'remote_ipc_forbidden')
  for (const channel of ['remote:window-minimize', 'remote:window-toggle-maximize', 'remote:window-is-maximized']) {
    assert.equal((await launcher.webContents.executeJavaScript(`window.acceptance.call(${JSON.stringify(channel)})`)).code, 'remote_ipc_forbidden')
  }
  for (let i = 0; i < 2; i++) assert.equal((await launcher.webContents.executeJavaScript('window.acceptance.call("remote:open", "1", "host", "Termous Workstation")')).ok, true)
  const windows = BrowserWindow.getAllWindows().filter(item => item !== launcher)
  console.log('远控窗口已打开')
  assert.equal(windows.length, 1); assert.equal(creates, 1)
  const remote = windows[0]
  await until(() => remote.webContents.executeJavaScript('Boolean(window.termousRemote)'))
  const security = (remote.webContents as typeof remote.webContents & { getLastWebPreferences(): Record<string, unknown> }).getLastWebPreferences()
  assert.equal(security.sandbox, true); assert.equal(security.contextIsolation, true); assert.equal(security.nodeIntegration, false)
  assert.equal(await remote.webContents.executeJavaScript('typeof require'), 'undefined')
  assert.equal(await remote.webContents.executeJavaScript('typeof window.termous'), 'undefined')
  const result = await remote.webContents.executeJavaScript('window.termousRemote.request({inventory:{}}, "preview")')
  assert.equal(result.ok, true); assert.equal(result.value.inventory.sessions.length, 4)
  assert.equal(result.value.inventory.agentEnabled, true)
  const agent = await remote.webContents.executeJavaScript('window.termousRemote.request({agent:{query:{kind:1}}}, "preview")')
  assert.equal(agent.ok, true); assert.equal(agent.value.agent.type, 'readiness')
  const upload = await remote.webContents.executeJavaScript('window.termousRemote.agentUpload(new Uint8Array([65,66,67]), "text/plain", "preview")')
  assert.equal(upload.ok, true); assert.equal(upload.value.id, 'content-fixture')
  const download = await remote.webContents.executeJavaScript('window.termousRemote.agentDownload("content-fixture", "preview")')
  assert.equal(download.ok, true); assert.deepEqual(Array.from(download.value), [65, 66, 67])
  const jsonUpload = await remote.webContents.executeJavaScript('window.termousRemote.agentUpload(new Uint8Array([123,125]), "application/json", "preview")')
  assert.equal(jsonUpload.ok, true)
  const badAttachment = await remote.webContents.executeJavaScript('window.termousRemote.agentUpload(new Uint8Array([65]), "invalid mime", "preview")')
  assert.equal(badAttachment.code, 'remote_invalid_request')
  const invalid = await remote.webContents.executeJavaScript('window.termousRemote.request({hello:{}}, "preview")')
  assert.equal(invalid.code, 'remote_invalid_request')
  await until(() => remote.webContents.executeJavaScript('document.body.innerText.includes("远程工作台") && document.body.innerText.includes("Release bucket")'))
  assert.equal(await remote.webContents.executeJavaScript('getComputedStyle(document.querySelector("header")).getPropertyValue("-webkit-app-region")'), 'drag')
  assert.equal(await remote.webContents.executeJavaScript('getComputedStyle(document.querySelector("header button")).getPropertyValue("-webkit-app-region")'), 'no-drag')
  if (process.platform !== 'darwin') {
    // 使用真实按钮与系统事件，验证新 IPC 只操作当前窗口且同步还原状态。
    await remote.webContents.executeJavaScript('document.querySelector("button[aria-label=最大化]").click()')
    await until(() => remote.isMaximized())
    await until(() => remote.webContents.executeJavaScript('Boolean(document.querySelector("button[aria-label=还原]:not(:disabled)"))'))
    remote.unmaximize()
    await until(() => remote.webContents.executeJavaScript('Boolean(document.querySelector("button[aria-label=最大化]:not(:disabled)"))'))
    await remote.webContents.executeJavaScript('document.querySelector("button[aria-label=最小化]").click()')
    await until(() => remote.isMinimized())
    remote.restore()
    assert.equal(creates, 1); assert.equal(closes, 0)
  }
  // DOM 就绪早于合成器提交；等绘制完成再保存界面证据。
  await remote.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await writeFile(path.join(output, 'window.png'), (await remote.webContents.capturePage()).toPNG())
  await remote.webContents.executeJavaScript('window.__acceptanceFrames = []; void window.termousRemote.subscribe((sequence, data) => { window.__acceptanceFrames.push(Array.from(data)); window.termousRemote.consume(sequence, "preview") }, () => {}, "preview")')
  await until(() => sockets.clients.size === 1)
  const credit = toBinary(StreamFrameSchema, create(StreamFrameSchema, { streamId: 'terminal:preview', kind: 'credit', credit: 262144n }))
  assert.equal((await remote.webContents.executeJavaScript(`window.termousRemote.send(new Uint8Array(${JSON.stringify(Array.from(credit))}), "preview")`)).ok, true)
  await until(() => remote.webContents.executeJavaScript('window.__acceptanceFrames.length > 0'))
  const firstFrame = fromBinary(EnvelopeSchema, new Uint8Array(await remote.webContents.executeJavaScript('window.__acceptanceFrames[0]')))
  assert.equal(firstFrame.payload.case, 'stream')
  if (firstFrame.payload.case === 'stream') {
    assert.equal(firstFrame.payload.value.kind, 'terminal_output')
    assert.match(new TextDecoder().decode(firstFrame.payload.value.data), /Ubuntu 24\.04 LTS/u)
  }
  const input = toBinary(StreamFrameSchema, create(StreamFrameSchema, { streamId: 'terminal:preview', kind: 'terminal_input', controlGeneration: 1n, sequence: 1n, data: new TextEncoder().encode('synthetic input') }))
  assert.equal((await remote.webContents.executeJavaScript(`window.termousRemote.send(new Uint8Array(${JSON.stringify(Array.from(input))}), "preview")`)).ok, true)
  await until(() => remote.webContents.executeJavaScript('window.__acceptanceFrames.length >= 3'))
  const echo = fromBinary(EnvelopeSchema, new Uint8Array(await remote.webContents.executeJavaScript('window.__acceptanceFrames[1]')))
  assert.equal(echo.payload.case, 'stream')
  if (echo.payload.case === 'stream') assert.equal(new TextDecoder().decode(echo.payload.value.data), 'synthetic input')
  assert.equal(terminalFrames, 2)
  // 本机流关闭或握手失败必须清除旧引用，后续订阅不能对失效对象返回成功。
  await remote.webContents.executeJavaScript('window.__acceptanceClosed = 0; void window.termousRemote.subscribe(() => {}, () => { window.__acceptanceClosed++ }, "preview")')
  for (const socket of sockets.clients) socket.terminate()
  await until(() => remote.webContents.executeJavaScript('window.__acceptanceClosed > 0'))
  rejectUpgrade = true
  await remote.webContents.executeJavaScript('window.__retryClosed = false; void window.termousRemote.subscribe(() => {}, () => { window.__retryClosed = true }, "preview")')
  await until(() => remote.webContents.executeJavaScript('window.__retryClosed'))
  rejectUpgrade = false
  await remote.webContents.executeJavaScript('void window.termousRemote.subscribe(() => {}, () => {}, "preview")')
  await until(() => sockets.clients.size === 1)
  // 同窗重连只创建一个新连接，旧页面请求和旧额度不得落到新连接。
  const retries = await remote.webContents.executeJavaScript('Promise.all([window.termousRemote.reconnect(), window.termousRemote.reconnect()])')
  assert.equal(retries[0].ok, true); assert.equal(retries[1].ok, true)
  assert.equal(retries[0].value.id, retries[1].value.id)
  assert.equal(creates, 2)
  const stale = await remote.webContents.executeJavaScript('window.termousRemote.request({inventory:{}}, "preview")')
  assert.equal(stale.code, 'remote_disconnected')
  const staleAgent = await remote.webContents.executeJavaScript('window.termousRemote.agentDownload("content-fixture", "preview")')
  assert.equal(staleAgent.code, 'remote_disconnected')
  const unbound = await remote.webContents.executeJavaScript('window.termousRemote.request({inventory:{}})')
  assert.equal(unbound.code, 'remote_disconnected')
  const nullBinding = await remote.webContents.executeJavaScript('window.termousRemote.request({inventory:{}}, null)')
  assert.equal(nullBinding.code, 'remote_disconnected')
  const staleSend = await remote.webContents.executeJavaScript(`window.termousRemote.send(new Uint8Array(${JSON.stringify(Array.from(input))}), "preview")`)
  assert.equal(staleSend.ok, false)
  // 只替换隔离进程的确认回执：取消保留窗口，再确认关闭，不弹出测试系统对话框。
  activeLocalTransfer = true
  let confirmations = 0
  dialog.showMessageBox = async () => ({ response: ++confirmations === 1 ? 0 : 1, checkboxChecked: false })
  const closeWindow = () => remote.webContents.executeJavaScript(process.platform === 'darwin' ? 'window.termousRemote.close()' : 'document.querySelector("header button[aria-label=关闭]").click()')
  await closeWindow()
  await until(() => confirmations === 1)
  assert.equal(remote.isDestroyed(), false)
  assert.equal(closes, 1)
  if (process.platform !== 'darwin') await until(() => remote.webContents.executeJavaScript('Boolean(document.querySelector("header button[aria-label=关闭]:not(:disabled)"))'))
  await closeWindow()
  await until(() => closes === 2 && remote.isDestroyed())
  assert.equal(confirmations, 2)
  await until(() => sockets.clients.size === 0)
  // 同一网络读取可以包含大量小帧；慢渲染应施加背压，不能直接关闭连接。
  const received: number[] = []
  let streamClosed = false
  const stream = new RemoteTerminalStream(sequence => { received.push(sequence) }, () => { streamClosed = true })
  try {
    await stream.open({ apiBaseUrl: `http://127.0.0.1:${address.port}`, apiToken: token }, '1', 'preview')
    const socket = [...sockets.clients][0]!
    const packet = toBinary(EnvelopeSchema, create(EnvelopeSchema, { connectionId: 'preview', generation: 1n, payload: { case: 'stream', value: { streamId: 'stream', kind: 'terminal_output', data: Uint8Array.of(65) } } }))
    for (let i = 0; i < 300; i++) socket.send(packet)
    await until(() => streamClosed || received.length >= 64)
    assert.equal(streamClosed, false)
    assert(received.length <= 64, '慢渲染未限制在途消息数')
    let consumed = 0
    await until(() => {
      while (consumed < received.length) stream.consume(received[consumed++]!)
      return consumed === 300 || streamClosed
    })
    assert.equal(streamClosed, false); assert.equal(consumed, 300)
    socket.send('invalid text frame')
    await until(() => streamClosed)
  } finally { stream.close() }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, customTitlebar: true, windowControls: true, windowControlsOwnedIPC: true, closeTransferConfirmation: true, sandbox: true, windowReuse: true, ownedIPC: true, protobufRPC: true, binaryRoundTrip: true, agentRPC: true, agentAttachmentRoundTrip: true, agentOwnedIPC: true, failedStreamRetry: true, disconnectOnly: true, reconnect: true, staleConnectionRejected: true, boundedTerminalBackpressure: true, authenticatedRequests, terminalFrames }, null, 2))
  console.log('Electron 独立窗口及 IPC 验收通过')
} finally {
  dialog.showMessageBox = originalMessageBox
  runtime.close(); launcher.destroy(); ipcMain.removeAllListeners()
  for (const socket of sockets.clients) socket.terminate()
  sockets.close(); server.close(); app.quit()
}

}
void main().catch(error => { console.error(error); app.exit(1) })
