import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { notificationIPCChannels as channels } from '#common/contracts'
import { registerNotificationIPC } from './ipc.ts'
import { NotificationRuntime } from './runtime.ts'
import { NotificationPreferencesStore } from './preferences.ts'

test('消息 IPC 只接受主窗口，激活确认不接受路径或命令', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown>()
  const ipcMain = { handle: (channel: string, fn: (event: IpcMainInvokeEvent, payload?: unknown) => unknown) => handlers.set(channel, fn), removeHandler: (channel: string) => handlers.delete(channel) } as unknown as IpcMain
  const runtime = new NotificationRuntime({ background: () => false, supported: () => false, preferences: () => ({ enabled: true, agent: true, file: true, approval: true }), language: () => 'en-US', create: () => { throw new Error('不得投递') }, activate() {}, warn() {} })
  const trusted = {} as IpcMainInvokeEvent
  const dispose = registerNotificationIPC({ ipcMain, runtime, preferences: new NotificationPreferencesStore('unused', () => {}), supported: () => false, trusted: (event) => event === trusted })
  for (const handler of handlers.values()) assert.throws(() => handler({} as IpcMainInvokeEvent), /NOT_ALLOWED/)
  assert.throws(() => handlers.get(channels.acknowledge)!(trusted, { command: 'open' }), /INVALID/)
  assert.deepEqual(handlers.get(channels.pending)!(trusted), [])
  dispose()
  assert.equal(handlers.size, 0)
  runtime.close()
})
