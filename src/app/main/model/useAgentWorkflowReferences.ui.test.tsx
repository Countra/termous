import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Script } from '#entities/desktop-workflow'
import { useAgentWorkflowReferences } from './useAgentWorkflowReferences.ts'

class Socket {
  static instances: Socket[] = []
  static fails = false
  onopen?: () => void
  onmessage?: () => void
  onerror?: () => void
  onclose?: () => void
  constructor() {
    if (Socket.fails) throw new Error('连接暂不可用')
    Socket.instances.push(this)
  }
  close() { this.onclose?.() }
}
const script: Script = { id: 'script', name: '回归', description: '', tags: [], revision: 2, created_at: '', updated_at: '' }

beforeEach(() => {
  Socket.instances = []
  Socket.fails = false
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('列表临时失败会重试，事件突发合并刷新，卸载不再重连', async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error('暂不可用')).mockResolvedValue([script])
  const gateway = { list, eventsURL: () => 'ws://fixture/workflows' }
  const view = renderHook(() => useAgentWorkflowReferences(gateway, true))
  await act(async () => { await Promise.resolve() })
  expect(view.result.current.ready).toBe(false)
  await act(() => vi.advanceTimersByTimeAsync(1_000))
  expect(view.result.current).toEqual({ scripts: [script], ready: true })
  act(() => { Socket.instances[0]?.onmessage?.(); Socket.instances[0]?.onmessage?.() })
  await act(() => vi.advanceTimersByTimeAsync(150))
  expect(list).toHaveBeenCalledTimes(3)
  view.unmount()
  await act(() => vi.advanceTimersByTimeAsync(20_000))
  expect(Socket.instances).toHaveLength(1)
  expect(list).toHaveBeenCalledTimes(3)
})

test('禁用后丢弃旧请求回执，重新启用刷新列表并恢复失败的事件连接', async () => {
  let resolve!: (items: Script[]) => void
  const list = vi.fn().mockImplementationOnce(() => new Promise<Script[]>((accept) => { resolve = accept }))
    .mockResolvedValue([])
  const gateway = { list, eventsURL: () => 'ws://fixture/workflows' }
  Socket.fails = true
  const view = renderHook(({ enabled }) => useAgentWorkflowReferences(gateway, enabled), { initialProps: { enabled: true } })
  const signal = list.mock.calls[0]?.[0] as AbortSignal
  view.rerender({ enabled: false })
  expect(signal.aborted).toBe(true)
  await act(async () => { resolve([script]) })
  expect(view.result.current).toEqual({ scripts: [], ready: false })
  view.rerender({ enabled: true })
  Socket.fails = false
  await act(() => vi.advanceTimersByTimeAsync(500))
  expect(Socket.instances).toHaveLength(1)
  expect(view.result.current).toEqual({ scripts: [], ready: true })
  view.unmount()
})

test('慢查询期间连续事件不会中止或并发查询，完成后补取最新摘要', async () => {
  let resolve!: (items: Script[]) => void
  const list = vi.fn().mockImplementationOnce(() => new Promise<Script[]>((accept) => { resolve = accept }))
    .mockResolvedValue([{ ...script, revision: 3 }])
  const gateway = { list, eventsURL: () => 'ws://fixture/workflows' }
  const view = renderHook(() => useAgentWorkflowReferences(gateway, true))
  const signal = list.mock.calls[0]?.[0] as AbortSignal
  for (let index = 0; index < 4; index++) {
    act(() => { Socket.instances[0]?.onmessage?.() })
    await act(() => vi.advanceTimersByTimeAsync(200))
  }
  expect(list).toHaveBeenCalledOnce()
  expect(signal.aborted).toBe(false)
  await act(async () => { resolve([script]) })
  expect(view.result.current).toEqual({ scripts: [script], ready: true })
  await act(() => vi.advanceTimersByTimeAsync(150))
  expect(list).toHaveBeenCalledTimes(2)
  expect(view.result.current.scripts[0]?.revision).toBe(3)
  view.unmount()
})

test('事件通道替换后忽略旧通道回调，不误关新连接或重复刷新', async () => {
  const list = vi.fn().mockResolvedValue([script])
  const gateway = { list, eventsURL: () => 'ws://fixture/workflows' }
  const view = renderHook(() => useAgentWorkflowReferences(gateway, true))
  await act(async () => { await Promise.resolve() })
  const old = Socket.instances[0]!
  act(() => { old.onclose?.() })
  await act(() => vi.advanceTimersByTimeAsync(500))
  const current = Socket.instances[1]!
  act(() => { old.onopen?.(); old.onmessage?.(); old.onerror?.(); old.onclose?.() })
  await act(() => vi.advanceTimersByTimeAsync(10_000))
  expect(Socket.instances).toHaveLength(2)
  expect(list).toHaveBeenCalledOnce()
  act(() => { current.onopen?.() })
  await act(async () => { await Promise.resolve() })
  expect(list).toHaveBeenCalledTimes(2)
  view.unmount()
})
