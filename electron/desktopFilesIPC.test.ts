import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { RemoteResult, SystemFileClipboardContext, SystemFileClipboardState } from '#common/contracts'
import { registerDesktopFilesIPC } from './desktopFilesIPC.ts'
import type { RemoteCore } from './remoteControl/core.ts'
import { RemoteCoreError } from './remoteControl/core.ts'

const context: SystemFileClipboardContext = { sessionId: 'desktop', generation: 1, subscriptionId: 'viewer', controlGeneration: 3 }
type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<RemoteResult<unknown>>
function fixture(request: (path: string, body?: unknown, method?: string) => Promise<unknown>) {
  const handlers = new Map<string, Handler>(), warnings: string[] = []
  const sender = new EventEmitter() as EventEmitter & { id: number; isDestroyed: () => boolean; getBackgroundThrottling: () => boolean; setBackgroundThrottling: (value: boolean) => void }
  sender.id = 7; sender.isDestroyed = () => false
  let throttled = true
  sender.getBackgroundThrottling = () => throttled
  sender.setBackgroundThrottling = value => { throttled = value }
  let trusted = true, focused = true
  registerDesktopFilesIPC({
    ipc: { handle: (name: string, handler: Handler) => handlers.set(name, handler) } as unknown as IpcMain,
    core: { request } as unknown as RemoteCore, trusted: () => trusted, focused: () => focused, warn: code => warnings.push(code),
  })
  return { sender, warnings, trusted: (value: boolean) => { trusted = value }, focused: (value: boolean) => { focused = value },
    invoke: (channel: string, ...args: unknown[]) => handlers.get(`desktop-files:${channel}`)!({ sender } as unknown as IpcMainInvokeEvent, ...args) }
}
const state = (enabled: boolean): SystemFileClipboardState => ({ supported: true, enabled, files: [] })
const tick = () => new Promise(resolve => setImmediate(resolve))

test('新窗口使用 Core 的持久开关，不能以默认关闭的心跳覆盖实际状态', async () => {
  const f = fixture(async (_path, body) => {
    assert.equal('enabled' in (body as object), false)
    return state((body as { action?: string }).action !== 'detach')
  })
  const result = await f.invoke('configure', context, true)
  assert.deepEqual(result, { ok: true, value: state(true) })
  assert.equal(f.sender.getBackgroundThrottling(), false)
  await f.invoke('configure', context, false, 'detach')
  assert.equal(f.sender.getBackgroundThrottling(), true)
})

test('窗口关闭后迟到的开启结果不复活，关闭请求排在开启之后', async () => {
  let finish!: (value: unknown) => void
  const calls: boolean[] = []
  const f = fixture(async (_path, body) => {
    const enabled = (body as { action?: string }).action !== 'detach'; calls.push(enabled)
    return enabled ? new Promise(resolve => { finish = resolve }) : state(false)
  })
  const enabling = f.invoke('configure', context, true)
  await tick(); f.sender.emit('destroyed'); finish(state(true))
  assert.deepEqual(await enabling, { ok: false, code: 'desktop_sender_not_allowed', uncertain: false })
  await tick(); assert.deepEqual(calls, [true, false]); assert.deepEqual(f.warnings, [])
})

test('开启系统文件剪贴板后后台仍续租，最后一个入口停用或崩溃才恢复节流', async () => {
  const f = fixture(async (_path, body) => state((body as { action?: string }).action !== 'detach'))
  await f.invoke('configure', context, true)
  assert.equal(f.sender.getBackgroundThrottling(), false)
  const second = { ...context, sessionId: 'second' }
  await f.invoke('configure', second, true)
  await f.invoke('configure', context, false, 'detach')
  assert.equal(f.sender.getBackgroundThrottling(), false)
  f.sender.emit('render-process-gone')
  await tick()
  assert.equal(f.sender.getBackgroundThrottling(), true)
})

test('窗口导航期间获得的选择立即释放，不能返还给旧页面', async () => {
  let finish!: (value: unknown) => void
  const released: string[] = []
  const f = fixture(async (path, _body, method) => {
    if (method === 'DELETE') { released.push(path); return }
    if (path === '/local-file-grants') return new Promise(resolve => { finish = resolve })
    return state(false)
  })
  const dropping = f.invoke('drop', context, ['C:\\fixture\\file.txt'])
  await tick(); f.sender.emit('did-start-navigation', {}, 'file:///reloaded', false, true)
  finish({ id: 'grant', items: [] })
  assert.equal((await dropping).ok, false)
  assert.deepEqual(released, ['/local-file-grants/grant'])
  assert.equal(f.sender.listenerCount('did-start-navigation'), 0)
})

test('系统导入拒绝未启用、非可信入口和真实失焦，开启关闭顺序保持一致', async () => {
  let imports = 0
  const f = fixture(async (path, body) => { if (path.endsWith('/import')) { imports++; return { kind: 'text' } }; return state((body as { action?: string }).action !== 'detach') })
  assert.equal((await f.invoke('import', context)).ok, false)
  await f.invoke('configure', context, true)
  f.focused(false); assert.equal((await f.invoke('import', context)).ok, false)
  f.focused(true); assert.equal((await f.invoke('import', context)).ok, true)
  f.trusted(false); assert.equal((await f.invoke('configure', context, true)).ok, false)
  assert.equal(imports, 1)
})

test('配置查询失败后撤回本机导入资格并恢复后台节流', async () => {
  let failed = false
  const f = fixture(async () => {
    if (failed) throw new RemoteCoreError('desktop_not_ready')
    return state(true)
  })
  await f.invoke('configure', context, true)
  assert.equal(f.sender.getBackgroundThrottling(), false)
  failed = true
  assert.equal((await f.invoke('configure', context, true)).ok, false)
  assert.equal(f.sender.getBackgroundThrottling(), true)
  assert.equal((await f.invoke('import', context)).ok, false)
})
