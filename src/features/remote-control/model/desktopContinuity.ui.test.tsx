import { create } from '@bufbuild/protobuf'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DesktopAttachmentSchema, DesktopStreamStateSchema } from '@termous/remote-protocol/desktop-protocol'
import { DesktopContinuity } from '../../../../../termous-remote/browser/desktop/continuity'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const attachment = create(DesktopAttachmentSchema, { id: 'view', attachmentGeneration: 4n, mediaGeneration: 1n })
const value = (epoch: bigint, revision: bigint, timestamp = 100, status = 'recovering') => create(DesktopStreamStateSchema, {
  attachment, streamId: attachment.id, displayEpoch: epoch, revision, status, inputAvailable: true,
  boundary: { id: epoch, rtpTimestamp: timestamp }, remainingMs: 20_000n,
})

test('呈现与通知乱序、重复通知、旧帧及 RTP 回绕不提前恢复输入', () => {
  const actions = { suspend: vi.fn(), ready: vi.fn(), acknowledge: vi.fn(), failed: vi.fn() }
  const c = new DesktopContinuity(attachment, actions)
  c.presented(101)
  c.accept(value(1n, 1n))
  expect(actions.acknowledge).toHaveBeenCalledWith({ streamId: 'view', displayEpoch: 1n, boundaryId: 1n, rtpTimestamp: 101 })
  expect(actions.ready).not.toHaveBeenCalled()
  c.accept(value(1n, 2n, 100, 'ready'))
  expect(actions.ready).toHaveBeenCalledTimes(1)
  c.accept(value(2n, 3n, 200)); c.accept(value(1n, 2n, 100, 'ready')); c.presented(199)
  expect(actions.acknowledge).toHaveBeenCalledTimes(1)
  c.presented(201); c.accept(value(2n, 4n, 200, 'ready')); c.presented(202)
  expect(actions.acknowledge).toHaveBeenCalledTimes(2)
  c.close(); c.presented(203)
  const wrapped = new DesktopContinuity(attachment, actions)
  wrapped.accept(value(3n, 5n, 0xffffffff)); wrapped.presented(0xfffffffe); wrapped.presented(0)
  expect(actions.acknowledge).toHaveBeenLastCalledWith({ streamId: 'view', displayEpoch: 3n, boundaryId: 3n, rtpTimestamp: 0 })
  wrapped.close()
})

test('不匹配附着和稳定暂停不能授予输入，失败立即清理展示', () => {
  const actions = { suspend: vi.fn(), ready: vi.fn(), acknowledge: vi.fn(), failed: vi.fn() }
  const c = new DesktopContinuity(attachment, actions)
  c.accept({ ...value(1n, 1n), attachment: { ...attachment, mediaGeneration: 2n } })
  expect(actions.suspend).not.toHaveBeenCalled()
  c.accept(value(1n, 2n, 100, 'restricted')); c.presented(101)
  expect(actions.acknowledge).not.toHaveBeenCalled()
  c.accept({ ...value(1n, 3n, 100, 'cleanup_pending'), reason: 'input_cleanup_unconfirmed' })
  expect(actions.failed).toHaveBeenCalledWith('input_cleanup_unconfirmed')
  c.close()
})

test('同一显示代次更换发送边界后，旧呈现标记不能确认新边界', () => {
  const actions = { suspend: vi.fn(), ready: vi.fn(), acknowledge: vi.fn(), failed: vi.fn() }
  const c = new DesktopContinuity(attachment, actions)
  c.accept(value(1n, 1n)); c.presented(101)
  const replacement = { ...value(1n, 2n, 200, 'ready'), boundary: { ...value(1n, 2n).boundary!, id: 2n, rtpTimestamp: 200 } }
  c.accept(replacement)
  expect(actions.ready).not.toHaveBeenCalled()
  expect(actions.acknowledge).toHaveBeenCalledTimes(1)
  c.presented(201)
  expect(actions.acknowledge).toHaveBeenLastCalledWith({ streamId: 'view', displayEpoch: 1n, boundaryId: 2n, rtpTimestamp: 201 })
  c.accept({ ...replacement, revision: 3n })
  expect(actions.ready).toHaveBeenCalledWith(true)
  c.close()
})
