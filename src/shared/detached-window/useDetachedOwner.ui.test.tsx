import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DetachedPacket } from '#common/contracts'
import { useDetachedOwner, type DetachedHostAdapter } from './useDetachedOwner.ts'

const bridge = vi.hoisted(() => ({ open: vi.fn(), focus: vi.fn(), close: vi.fn(), reveal: vi.fn(), send: vi.fn(), subscribe: vi.fn() }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ detachedWindows: bridge }) }))
const identity = { module: 'test-module', instance: 'one' }
const connection = { ...identity, generation: 'one' }
const appearance = { theme: 'dark' as const, language: 'zh-CN' as const }
let receive: (packet: DetachedPacket) => void
let adapter: DetachedHostAdapter

beforeEach(() => {
  vi.resetAllMocks()
  bridge.open.mockResolvedValue({ ...connection, capture: 'data:image/png;base64,fixture' })
  bridge.focus.mockResolvedValue(true)
  bridge.close.mockResolvedValue(undefined)
  bridge.subscribe.mockImplementation(listener => { receive = listener; return () => undefined })
  adapter = { snapshot: vi.fn(() => ({})), command: vi.fn(), prepare: vi.fn(async () => undefined),
    returned: vi.fn(), navigate: vi.fn(async () => true), cancelFeedback: vi.fn() }
})
afterEach(cleanup)

it('准备交接时卸载宿主不会再创建原生窗口', async () => {
  let prepared!: () => void
  adapter.prepare = () => new Promise<void>(resolve => { prepared = resolve })
  const { result, unmount } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  let opening!: Promise<void>
  act(() => { opening = result.current.open(null) })
  unmount()
  await act(async () => { prepared(); await opening })
  expect(bridge.open).not.toHaveBeenCalled()
})

it('原生窗口创建中卸载宿主会关闭迟到窗口，不再初始化', async () => {
  let created!: (value: typeof connection) => void
  bridge.open.mockImplementationOnce(() => new Promise(resolve => { created = resolve }))
  const { result, unmount } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  let opening!: Promise<void>
  act(() => { opening = result.current.open(null) })
  await waitFor(() => expect(bridge.open).toHaveBeenCalledOnce())
  unmount()
  await act(async () => { created(connection); await opening })
  expect(bridge.close).toHaveBeenCalledWith(connection)
  expect(bridge.send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'initialize' }))
})

it('导航确认期间旧窗口关闭后，取消回执不会覆盖新窗口的打开状态', async () => {
  let navigate!: (accepted: boolean) => void
  adapter.navigate = () => new Promise<boolean>(resolve => { navigate = resolve })
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  let returning!: Promise<boolean>
  act(() => { returning = result.current.returnWindow(true) })
  await waitFor(() => expect(navigate).toBeDefined())
  act(() => receive({ connection, kind: 'closed' }))
  bridge.open.mockResolvedValueOnce({ ...connection, generation: 'two' })
  await act(async () => { await result.current.open(null) })
  await act(async () => { navigate(false); expect(await returning).toBe(false) })
  expect(result.current.phase).toBe('opening')
})

it('先等待输入法完成，再冻结视图；初始化前安装通道并忽略旧代事件', async () => {
  let composed!: () => void
  adapter.prepare = () => new Promise<void>(resolve => { composed = resolve })
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  let opening!: Promise<void>
  act(() => { opening = result.current.open(null) })
  expect(result.current.phase).toBe('opening')
  expect(result.current.frozen).toBe(false)
  expect(bridge.open).not.toHaveBeenCalled()
  await act(async () => { composed(); await opening })
  expect(result.current.frozen).toBe(true)
  expect(bridge.send).toHaveBeenCalledWith({ connection: expect.objectContaining(connection), kind: 'initialize' })
  expect(bridge.send.mock.calls[0][0].connection).not.toHaveProperty('capture')
  act(() => receive({ connection: { ...connection, generation: 'old' }, kind: 'ready' }))
  expect(result.current.phase).toBe('opening')
  act(() => receive({ connection, kind: 'ready' }))
  expect(result.current.phase).toBe('detached')
})

it('初始化超时或窗口启动失败恢复嵌入视图并允许重试', async () => {
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  bridge.open.mockRejectedValueOnce(new Error('launch_failed'))
  await act(async () => { await result.current.open(null) })
  expect(result.current.phase).toBe('embedded')
  expect(result.current.error).toBe(true)
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'closed' }))
  expect(result.current.phase).toBe('embedded')
  expect(result.current.frozen).toBe(false)
  expect(result.current.error).toBe(true)
})

it('重复打开聚焦已有窗口，聚焦失败保留交接状态并显示错误，不能重复创建窗口', async () => {
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  bridge.focus.mockRejectedValueOnce(new Error('focus_failed'))
  await act(async () => { await expect(result.current.open(null)).resolves.toBeUndefined() })
  expect(result.current.phase).toBe('detached')
  expect(result.current.error).toBe(true)
  expect(bridge.open).toHaveBeenCalledOnce()
  await act(async () => { await result.current.open(null) })
  expect(result.current.error).toBe(false)
  expect(bridge.open).toHaveBeenCalledOnce()
})

it('准备交接期间重复打开不聚焦尚未创建的窗口，也不重复准备', async () => {
  let prepared!: () => void
  adapter.prepare = vi.fn(() => new Promise<void>(resolve => { prepared = resolve }))
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  let opening!: Promise<void>
  act(() => { opening = result.current.open(null) })
  await act(async () => { await result.current.open(null) })
  expect(adapter.prepare).toHaveBeenCalledOnce()
  expect(bridge.focus).not.toHaveBeenCalled()
  expect(result.current.error).toBe(false)
  await act(async () => { prepared(); await opening })
  act(() => receive({ connection, kind: 'ready' }))
  expect(result.current.phase).toBe('detached')
  expect(bridge.open).toHaveBeenCalledOnce()
})

it('占位页直接聚焦处理 IPC 拒绝及窗口不存在，成功重试后清除错误', async () => {
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  bridge.focus.mockRejectedValueOnce(new Error('focus_failed')).mockResolvedValueOnce(false)
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => { await expect(result.current.focus()).resolves.toBe(false) })
    expect(result.current.error).toBe(true)
    expect(result.current.phase).toBe('detached')
  }
  await act(async () => { expect(await result.current.focus()).toBe(true) })
  expect(result.current.error).toBe(false)
  expect(bridge.open).toHaveBeenCalledOnce()
  expect(bridge.close).not.toHaveBeenCalled()
})

it('旧窗口聚焦的迟到失败不会影响重新打开的窗口', async () => {
  let reject!: (reason: Error) => void
  bridge.focus.mockImplementationOnce(() => new Promise<boolean>((_resolve, fail) => { reject = fail }))
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  let focusing!: Promise<boolean>
  act(() => { focusing = result.current.focus() })
  act(() => receive({ connection, kind: 'closed' }))
  bridge.open.mockResolvedValueOnce({ ...connection, generation: 'two' })
  await act(async () => { await result.current.open(null) })
  await act(async () => { reject(new Error('focus_failed')); expect(await focusing).toBe(false) })
  expect(result.current.phase).toBe('opening')
  expect(result.current.error).toBe(false)
  expect(bridge.open).toHaveBeenCalledTimes(2)
})

it('取消导航保留小窗，交接失败保留编辑权，重试成功后才关闭', async () => {
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  vi.mocked(adapter.navigate).mockResolvedValueOnce(false)
  await act(async () => { expect(await result.current.returnWindow(true)).toBe(false) })
  expect(result.current.phase).toBe('detached')
  expect(bridge.close).not.toHaveBeenCalled()
  expect(result.current.restoring).toBe(false)
  let fail = true
  bridge.send.mockImplementation((packet: DetachedPacket) => {
    if (packet.kind === 'request' && packet.operation === 'flush') queueMicrotask(() => receive({
      connection, kind: 'response', id: packet.id, ...(fail ? { error: 'unconfirmed' } : { payload: { sessionsOpen: true } }),
    }))
  })
  await act(async () => { expect(await result.current.returnWindow(false)).toBe(false) })
  expect(result.current.phase).toBe('detached')
  expect(bridge.close).not.toHaveBeenCalled()
  expect(result.current.restoring).toBe(false)
  fail = false
  await act(async () => { expect(await result.current.returnWindow(false)).toBe(true) })
  await waitFor(() => expect(result.current.phase).toBe('embedded'))
  expect(adapter.returned).toHaveBeenCalledWith({ sessionsOpen: true })
  expect(bridge.close).toHaveBeenCalledTimes(1)
  expect(result.current.capture).toBeUndefined()
})

it('确认输入后保留占位和编辑锁，等待视图过渡完成才关闭，期间重复打开只定位', async () => {
  let finish!: () => void
  adapter.finishReturn = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  bridge.send.mockImplementation((packet: DetachedPacket) => {
    if (packet.operation === 'flush') queueMicrotask(() => receive({ connection, kind: 'response', id: packet.id, payload: {} }))
  })
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  let returning!: Promise<boolean>
  act(() => { returning = result.current.returnWindow(false) })
  await waitFor(() => expect(adapter.finishReturn).toHaveBeenCalledOnce())
  expect(result.current.restoring).toBe(true)
  expect(result.current.phase).toBe('returning')
  expect(result.current.capture).toBeDefined()
  expect(bridge.close).not.toHaveBeenCalled()
  await act(async () => { receive({ connection, kind: 'request', id: 'late-edit', operation: 'command' }) })
  expect(adapter.command).not.toHaveBeenCalled()
  expect(bridge.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'late-edit', kind: 'response', error: 'detached_operation_failed' }))
  await act(async () => { await result.current.open(null) })
  expect(bridge.open).toHaveBeenCalledOnce()
  expect(bridge.focus).toHaveBeenCalledWith(identity)
  await act(async () => { finish(); expect(await returning).toBe(true) })
  expect(bridge.close).toHaveBeenCalledOnce()
  expect(result.current.phase).toBe('embedded')
  expect(result.current.restoring).toBe(false)
  expect(result.current.capture).toBeUndefined()
})

it('返回过渡期间小窗崩溃时，迟到的动画完成不会影响重新打开的窗口', async () => {
  let finish!: () => void
  adapter.finishReturn = () => new Promise<void>(resolve => { finish = resolve })
  bridge.send.mockImplementation((packet: DetachedPacket) => {
    if (packet.operation === 'flush') queueMicrotask(() => receive({ connection, kind: 'response', id: packet.id, payload: {} }))
  })
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  let returning!: Promise<boolean>
  act(() => { returning = result.current.returnWindow(false) })
  await waitFor(() => expect(finish).toBeDefined())
  act(() => receive({ connection, kind: 'closed' }))
  bridge.open.mockResolvedValueOnce({ ...connection, generation: 'two' })
  await act(async () => { await result.current.open(null) })
  await act(async () => { finish(); expect(await returning).toBe(false) })
  expect(result.current.phase).toBe('opening')
  expect(bridge.close).not.toHaveBeenCalled()
})

it('过渡后关闭失败时撤销恢复状态，通知小窗恢复编辑并允许重试', async () => {
  adapter.finishReturn = vi.fn(async () => undefined)
  bridge.close.mockRejectedValueOnce(new Error('close_failed'))
  bridge.send.mockImplementation((packet: DetachedPacket) => {
    if (packet.operation === 'flush') queueMicrotask(() => receive({ connection, kind: 'response', id: packet.id, payload: {} }))
  })
  const { result } = renderHook(() => useDetachedOwner(identity, adapter, appearance, true))
  await act(async () => { await result.current.open(null) })
  act(() => receive({ connection, kind: 'ready' }))
  await act(async () => { expect(await result.current.returnWindow(false)).toBe(false) })
  expect(result.current.phase).toBe('detached')
  expect(result.current.restoring).toBe(false)
  expect(result.current.capture).toBeDefined()
  expect(bridge.send).toHaveBeenCalledWith({ connection, kind: 'state', payload: { handoffFailed: true } })
  await act(async () => { expect(await result.current.returnWindow(false)).toBe(true) })
  expect(result.current.phase).toBe('embedded')
})
