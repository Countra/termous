import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AgentRuntimeStatus } from '#common/contracts'
import {
  agentRuntimeIPCChannels,
  registerAgentRuntimeIPC,
} from './ipc.ts'

test('Agent Runtime IPC 拒绝非主窗口调用并转发可信请求', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    },
  } as unknown as IpcMain
  const started: unknown[] = []
  const statuses: AgentRuntimeStatus[] = []
  const supervisor = {
    getStatus: () => ({ state: 'ready' as const }),
    startRun: async (request: unknown) => {
      started.push(request)
      return { accepted: true, status: { state: 'starting' as const } }
    },
    stopRun: async () => ({ accepted: true, status: { state: 'stopping' as const } }),
    steerRun: async () => ({ accepted: true, status: { state: 'running' as const } }),
    subscribe: (listener: (status: AgentRuntimeStatus) => void) => {
      listener({ state: 'ready' })
      return () => undefined
    },
  }
  const dispose = registerAgentRuntimeIPC({
    ipcMain,
    supervisor,
    isTrustedSender: (event) => event === trustedEvent,
    sendStatus: (status) => statuses.push(status),
  })
  const start = handlers.get(agentRuntimeIPCChannels.start)
  assert.ok(start)

  await assert.rejects(
    async () => start(untrustedEvent, { run_id: 'agr_1', generation: 1 }),
    /AGENT_RUNTIME_IPC_NOT_ALLOWED/,
  )
  assert.equal(started.length, 0)

  await start(trustedEvent, { run_id: 'agr_1', generation: 1 })
  assert.deepEqual(started, [{ run_id: 'agr_1', generation: 1 }])
  assert.deepEqual(statuses, [{ state: 'ready' }])

  dispose()
  assert.equal(handlers.size, 0)
})

const trustedEvent = { trusted: true } as unknown as IpcMainInvokeEvent
const untrustedEvent = { trusted: false } as unknown as IpcMainInvokeEvent
