import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { registerTerminalCompletionIPC, terminalCompletionIPCChannels } from './ipc.ts'
import { completionFailure } from './protocol.ts'
import { completionTestRequest } from './testFixture.ts'

test('IPC拒绝非受信页面，取消绑定窗口，导航期间撤销请求并清理监听器', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, value: unknown) => unknown>()
  const emitter = new EventEmitter() as EventEmitter & { id: number }
  emitter.id = 17
  const event = { sender: emitter } as unknown as IpcMainInvokeEvent
  let trusted = false
  let resolve!: (value: ReturnType<typeof completionFailure>) => void
  const cancelled: number[] = []
  const cleanup = registerTerminalCompletionIPC({
    ipcMain: { handle: (key: string, handler: (event: IpcMainInvokeEvent, value: unknown) => unknown) => handlers.set(key, handler), removeHandler: (key: string) => handlers.delete(key) } as unknown as IpcMain,
    isTrustedSender: () => trusted,
    runtime: { generate: async (_request, ownerId) => { assert.equal(ownerId, 17); return await new Promise((done) => { resolve = done }) },
      cancel: (_request, ownerId) => cancelled.push(ownerId), cancelOwner: (ownerId) => cancelled.push(ownerId) },
  })
  const generate = handlers.get(terminalCompletionIPCChannels.generate)!
  await assert.rejects(async () => generate(event, completionTestRequest()), /IPC_NOT_ALLOWED/u)
  trusted = true
  const task = generate(event, completionTestRequest())
  emitter.emit('did-start-navigation')
  assert.deepEqual(cancelled, [17])
  resolve(completionFailure(completionTestRequest(), 'TERMINAL_AI_CANCELLED', '取消'))
  await task
  assert.equal(emitter.listenerCount('destroyed'), 0)
  assert.equal(emitter.listenerCount('did-start-navigation'), 0)
  cleanup()
  assert.equal(handlers.size, 0)
})
