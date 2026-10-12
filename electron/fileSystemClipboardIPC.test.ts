import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerFileSystemClipboardIPC } from './fileSystemClipboardIPC.ts'
import { RemoteCoreError, type RemoteCore } from './remoteControl/core.ts'

test('系统复制只接受可信窗口，窗口归属由主进程生成', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const calls: { path: string; body: Record<string, unknown> }[] = []
  let trusted = true
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false })
  registerFileSystemClipboardIPC({
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) } as unknown as IpcMain,
    core: { request: async (path: string, body: Record<string, unknown>) => { calls.push({ path, body }); return { phase: 'preparing' } } } as unknown as RemoteCore,
    trusted: () => trusted, focused: () => true, warn: () => undefined,
  })
  const event = { sender } as unknown as IpcMainInvokeEvent
  const request = { file_session_id: 'fs_test', connection_generation: 2, operation_id: 'op_test', paths: ['/file'], window_id: 'forged' }
  const result = await handlers.get('file-system-clipboard:copy')!(event, request)
  assert.deepEqual(result, { ok: true, value: { phase: 'preparing' } })
  assert.notEqual(calls[0]!.body.window_id, 'forged')
  trusted = false
  assert.deepEqual(await handlers.get('file-system-clipboard:copy')!(event, request), { ok: false, code: 'FILE_CLIPBOARD_SENDER_INVALID', uncertain: false })
  assert.equal(calls.length, 1)
})

test('系统复制拒绝无效选择及失焦操作', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  let focused = true
  registerFileSystemClipboardIPC({
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) } as unknown as IpcMain,
    core: { request: async () => assert.fail('不应发送无效请求') } as unknown as RemoteCore,
    trusted: () => true, focused: () => focused, warn: () => undefined,
  })
  const event = { sender: Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }) }
  for (const paths of [[], ['invalid\0path']]) {
    assert.equal((await handlers.get('file-system-clipboard:copy')!(event, { file_session_id: 'fs_test', connection_generation: 1, operation_id: 'op_test', paths }) as { ok: boolean }).ok, false)
  }
  focused = false
  assert.equal((await handlers.get('file-system-clipboard:copy')!(event, { file_session_id: 'fs_test', connection_generation: 1, operation_id: 'op_test', paths: ['/file'] }) as { ok: boolean }).ok, false)
})

test('系统粘贴只接受窗口上下文，拒绝伪造路径，关闭窗口回收未交付授权', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const calls: { path: string; body?: Record<string, unknown> }[] = []
  let destroyed = false
  let focused = true
  let invalidate = false
  registerFileSystemClipboardIPC({
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) } as unknown as IpcMain,
    core: { request: async (path: string, body?: Record<string, unknown>) => {
      calls.push({ path, body })
      if (invalidate) destroyed = true
      return { sequence: 7, grant: { id: 'grant' } }
    } } as unknown as RemoteCore,
    trusted: () => true, focused: () => focused, warn: () => undefined,
  })
  const event = { sender: Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => destroyed }) }
  const request = { file_session_id: 'fs_test', connection_generation: 3, sequence: 7, paths: ['forged'], window_id: 'forged' }
  await handlers.get('file-system-clipboard:import')!(event, request)
  assert.equal(calls[0]!.body!.paths, undefined)
  assert.notEqual(calls[0]!.body!.window_id, 'forged')
  assert.equal(calls[0]!.body!.connection_generation, 3)
  focused = false
  assert.equal((await handlers.get('file-system-clipboard:import')!(event, request) as { ok: boolean }).ok, false)
  assert.equal(calls.length, 1)
  focused = true
  invalidate = true
  const result = await handlers.get('file-system-clipboard:import')!(event, request)
  assert.deepEqual(result, { ok: false, code: 'FILE_CLIPBOARD_SENDER_INVALID', uncertain: false })
  assert.equal(calls[calls.length - 1]!.path, '/local-file-grants/grant')
})

test('文件剪贴板错误码统一使用公开业务码', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  registerFileSystemClipboardIPC({
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) } as unknown as IpcMain,
    core: { request: async () => { throw new RemoteCoreError('file_clipboard_changed') } } as unknown as RemoteCore,
    trusted: () => true, focused: () => true, warn: () => undefined,
  })
  const event = { sender: Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }) }
  assert.deepEqual(await handlers.get('file-system-clipboard:import')!(event, { file_session_id: 'fs', connection_generation: 1 }), { ok: false, code: 'FILE_CLIPBOARD_CHANGED', uncertain: false })
})

test('页面重载撤销旧窗口全部发布，迟到创建不能交付到新页面', async () => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const calls: { path: string; body?: Record<string, unknown> }[] = []
  let finish!: (value: unknown) => void
  registerFileSystemClipboardIPC({
    ipc: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, handler) } as unknown as IpcMain,
    core: { request: async (path: string, body?: Record<string, unknown>) => {
      calls.push({ path, body })
      if (path === '/file-system-clipboard') return new Promise(resolve => { finish = resolve })
      return { phase: 'idle' }
    } } as unknown as RemoteCore,
    trusted: () => true, focused: () => true, warn: () => assert.fail('清理不应失败'),
  })
  const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false })
  const event = { sender }
  const pending = handlers.get('file-system-clipboard:copy')!(event, { file_session_id: 'fs', connection_generation: 1, operation_id: 'op', paths: ['/file'] })
  sender.emit('did-start-navigation', {}, 'app://reload', false, true)
  await handlers.get('file-system-clipboard:status')!(event)
  finish({ phase: 'preparing', publication_id: 'pub' })
  assert.deepEqual(await pending, { ok: false, code: 'FILE_CLIPBOARD_SENDER_INVALID', uncertain: false })
  const oldWindow = calls[0]!.body!.window_id
  assert.equal(calls[1]!.path, `/file-system-clipboard?window_id=${oldWindow}`)
  assert.notEqual(calls[2]!.path, calls[1]!.path)
  assert.equal(calls[3]!.path, calls[1]!.path)
})
