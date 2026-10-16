import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { systemClipboardChannels as channels } from '#common/contracts'
import type { ClipboardCapabilitiesClient } from './client.ts'
import { ClipboardCapabilitiesState } from './state.ts'
import { registerClipboardCapabilitiesIPC } from './ipc.ts'

test('可信多窗口共用能力缓存，导航和关闭释放广播订阅', () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent) => unknown>()
  const state = new ClipboardCapabilitiesState()
  let stopped = false
  const client = { state, stop: () => { stopped = true } } as unknown as ClipboardCapabilitiesClient
  const ipc = { handle: (key: string, handler: (event: IpcMainInvokeEvent) => unknown) => handlers.set(key, handler), removeHandler: (key: string) => handlers.delete(key) } as unknown as IpcMain
  const dispose = registerClipboardCapabilitiesIPC(ipc, client, event => event.sender.id !== 3)
  const calls = [0, 0, 0]
  const windows = calls.map((_, i) => Object.assign(new EventEmitter(), { id: i + 1, isDestroyed: () => false, send: () => { calls[i]++ } }))
  const get = handlers.get(channels.get)!
  for (const sender of windows.slice(0, 2)) assert.equal(get({ sender } as unknown as IpcMainInvokeEvent), state.get())
  assert.throws(() => get({ sender: windows[2] } as unknown as IpcMainInvokeEvent))
  state.offline()
  assert.deepEqual(calls, [1, 1, 0])
  windows[0]!.emit('did-start-navigation', {}, 'https://untrusted.invalid', false, true)
  windows[1]!.emit('destroyed')
  state.offline()
  assert.deepEqual(calls, [1, 1, 0])
  for (const sender of windows.slice(0, 2)) get({ sender } as unknown as IpcMainInvokeEvent)
  let failedSends = 0
  windows[0]!.send = () => { failedSends++; throw new Error('渲染帧已退出') }
  assert.doesNotThrow(() => state.offline())
  assert.deepEqual(calls, [1, 2, 0])
  state.offline()
  assert.equal(failedSends, 1)
  assert.deepEqual(calls, [1, 3, 0])
  dispose()
  assert.equal(stopped, true)
  assert.equal(handlers.size, 0)
})
