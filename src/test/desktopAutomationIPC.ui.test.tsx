import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { AppConfig } from '#common/contracts'
import type { DesktopAutomationRuntime as Runtime } from '../../electron/desktopAutomation/runtime'

const state = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, value?: unknown) => unknown>(), windows: [] as FakeWindow[], sockets: [] as FakeSocket[] }))

class FakeWindow extends EventEmitter {
  destroyed = false
  url = ''
  visible = false
  webContents = Object.assign(new EventEmitter(), { mainFrame: { url: '' }, setWindowOpenHandler: vi.fn() })
  constructor(readonly options: Record<string, unknown>) { super(); state.windows.push(this) }
  loadURL(url: string) { this.url = url; this.webContents.mainFrame.url = url; return Promise.resolve() }
  show() { this.visible = true }
  focus() {}
  hide() { this.visible = false }
  destroy() { this.destroyed = true }
  isDestroyed() { return this.destroyed }
}
class FakeSocket extends EventEmitter {
  static OPEN = 1
  readyState = 1
  sent: Record<string, unknown>[] = []
  constructor() { super(); state.sockets.push(this) }
  close() { this.readyState = 3; this.emit('close') }
  send(raw: string, done: (error?: Error) => void) {
    const request = JSON.parse(raw) as Record<string, unknown>
    this.sent.push(request)
    done()
    queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: request.id, value: request.action === 'bootstrap' ? { shared: true } : request.action === 'attach' ? { ticket: 'once' } : { ticket: 'executor' } })), false))
  }
}
vi.doMock('electron', () => ({ BrowserWindow: class extends FakeWindow {}, ipcMain: { handle: (key: string, handler: (event: unknown, value?: unknown) => unknown) => state.handlers.set(key, handler) } }))
vi.doMock('ws', () => ({ default: class extends FakeSocket {} }))
const { DesktopAutomationRuntime } = await import('../../electron/desktopAutomation/runtime')

const host = { id: 'host-1', session_id: 'desktop-1', generation: 4, name: 'Fixture', state: 'preparing', show_sequence: 0 }
const config = { apiBaseUrl: 'http://127.0.0.1:5100', apiToken: 'fixture-private-token' } as AppConfig
const runtimes: Runtime[] = []
function runtime(load = async () => config) {
  const r = new DesktopAutomationRuntime({ config: load, appearance: () => ({ language: 'zh-CN', theme: 'dark' }), renderer: 'C:/fixture/index.html', preload: 'C:/fixture/preload.cjs', warn: vi.fn() })
  runtimes.push(r)
  return r
}
function snapshot(hosts = [host]) { state.sockets[state.sockets.length - 1]!.emit('message', Buffer.from(JSON.stringify({ hosts })), false) }
afterEach(() => { for (const r of runtimes.splice(0)) r.close(); state.handlers.clear(); state.windows.length = 0; state.sockets.length = 0 })

it('主进程仅向归属窗口主 frame 发放窄化票据，宿主关闭仅隐藏', async () => {
  const r = runtime(); await r.start(); snapshot()
  const window = state.windows[0]!
  expect(window.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false })
  const bootstrap = state.handlers.get('desktop-automation:bootstrap')!
  const sender = window.webContents
  expect(() => bootstrap({ sender, senderFrame: { url: window.url } })).toThrow('desktop_sender_not_allowed')
  expect(() => bootstrap({ sender: {}, senderFrame: sender.mainFrame })).toThrow('desktop_sender_not_allowed')
  const value = await bootstrap({ sender, senderFrame: sender.mainFrame })
  expect(JSON.stringify(value)).not.toContain('fixture-private-token')
  expect(value).toMatchObject({ host, streamURL: 'ws://127.0.0.1:5100/api/v1/remote-desktop-stream?ticket=once' })
  await bootstrap({ sender, senderFrame: sender.mainFrame })
  expect(state.sockets[0]!.sent.filter(item => item.action === 'attach')).toHaveLength(1)
  const preventDefault = vi.fn(); window.show(); window.emit('close', { preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce(); expect(window.visible).toBe(false); expect(window.destroyed).toBe(false)
  snapshot([]); expect(window.destroyed).toBe(true)
  expect(() => bootstrap({ sender, senderFrame: sender.mainFrame })).toThrow('desktop_sender_not_allowed')
})

it('并发启动复用通道，退出期间迟到配置不能创建连接或窗口', async () => {
  let resolve!: (value: AppConfig) => void
  const r = runtime(() => new Promise(done => { resolve = done }))
  const first = r.start(); await r.start(); r.close(); resolve(config); await first
  expect(state.sockets).toHaveLength(0)
  expect(state.windows).toHaveLength(0)
})

it('宿主移除立即取消其票据请求，迟到响应不会影响新宿主', async () => {
  const r = runtime(); await r.start(); snapshot()
  const socket = state.sockets[0]!
  const window = state.windows[0]!
  vi.spyOn(socket, 'send').mockImplementation((raw, done) => {
    socket.sent.push(JSON.parse(raw) as Record<string, unknown>); done()
  })
  const pending = state.handlers.get('desktop-automation:bootstrap')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) as Promise<unknown>
  const rejected = expect(pending).rejects.toThrow('desktop_executor_unavailable')
  snapshot([])
  await rejected
  snapshot([{ ...host, id: 'host-new' }])
  socket.emit('message', Buffer.from(JSON.stringify({ id: socket.sent[0]!.id, value: { shared: true } })), false)
  await Promise.resolve()
  expect(window.destroyed).toBe(true)
  expect(state.windows[1]!.destroyed).toBe(false)
  expect(socket.sent.map(item => item.action)).toEqual(['bootstrap'])
})

it('引导失败立即通知 Core 回收宿主，不等待首帧准备超时', async () => {
  const r = runtime(); await r.start(); snapshot()
  const socket = state.sockets[0]!
  const window = state.windows[0]!
  vi.spyOn(socket, 'send').mockImplementation((raw, done) => {
    const request = JSON.parse(raw) as Record<string, unknown>
    socket.sent.push(request); done()
    queueMicrotask(() => socket.emit('message', Buffer.from(JSON.stringify({ id: request.id, error: request.action === 'bootstrap' ? 'failed' : undefined })), false))
  })
  const pending = state.handlers.get('desktop-automation:bootstrap')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) as Promise<unknown>
  await expect(pending).rejects.toThrow('desktop_host_request_failed')
  expect(socket.sent.map(item => item.action)).toEqual(['bootstrap', 'failed'])
})
