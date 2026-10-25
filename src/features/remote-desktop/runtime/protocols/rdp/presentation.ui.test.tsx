import { afterEach, expect, test, vi } from 'vitest'
import { create } from '@bufbuild/protobuf'
import { PixelPresentationStateSchema } from '@termous/rdp-protocol'
import { presentationDefaults, type PresentationState } from '@termous/remote-protocol/presentation'
import { PixelPresentation } from './presentation.ts'

afterEach(() => vi.useRealTimers())
test('默认质量只初始化当前观看者，回执与实际调度版本分别合并', async () => {
  vi.useFakeTimers()
  const send = vi.fn<(request: unknown) => boolean>(() => true), states: PresentationState[] = []
  const defaults = presentationDefaults('economy')
  const adapter = new PixelPresentation(2n, send, state => states.push(state), { defaults })
  adapter.start()
  const query = send.mock.calls[0][0] as unknown as { operationId: string }
  adapter.receive(create(PixelPresentationStateSchema, { operationId: query.operationId, requestedRate: 30, appliedRate: 30 }))
  await vi.advanceTimersByTimeAsync(300)
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ sessionGeneration: 2n, updateRateLimit: 15, expectedRevision: 0n }))
  const request = send.mock.calls[send.mock.calls.length - 1][0] as unknown as { operationId: string }
  adapter.receive(create(PixelPresentationStateSchema, { operationId: request.operationId, revision: 1n, requestedRate: 15, appliedRate: 30 }))
  expect(states[states.length - 1]?.status).toBe('confirming')
  adapter.receive(create(PixelPresentationStateSchema, { operationId: request.operationId, revision: 1n, appliedRevision: 1n, requestedRate: 15, appliedRate: 15 }))
  expect(states[states.length - 1]?.appliedPixels).toEqual({ updateRateLimit: 15 })
  defaults.pixels.updateRateLimit = 20
  expect(states[states.length - 1]?.requested).toEqual({ kind: 'pixels', updateRateLimit: 15 })
  adapter.dispose()
})

test('超时查询恢复配置，不关闭观看，也不接受迟到旧状态', async () => {
  vi.useFakeTimers()
  const send = vi.fn<(request: unknown) => boolean>(() => true)
  const adapter = new PixelPresentation(1n, send, vi.fn())
  adapter.receive(create(PixelPresentationStateSchema, { requestedRate: 30, appliedRate: 30 }))
  adapter.set({ kind: 'pixels', updateRateLimit: 20 })
  await vi.advanceTimersByTimeAsync(5300)
  expect(send).toHaveBeenCalledTimes(2)
  adapter.receive(create(PixelPresentationStateSchema, { operationId: (send.mock.calls[1][0] as { operationId: string }).operationId, revision: 1n, appliedRevision: 1n, requestedRate: 20, appliedRate: 20 }))
  adapter.receive(create(PixelPresentationStateSchema, { requestedRate: 30, appliedRate: 30 }))
  expect(adapter.controller.snapshot?.appliedPixels?.updateRateLimit).toBe(20)
  expect(adapter.controller.snapshot?.status).toBe('applied')
  adapter.dispose()
})

test('已接收但未应用的配置仍有确认超时，并能恢复迟到的调度状态', async () => {
  vi.useFakeTimers()
  const send = vi.fn<(request: unknown) => boolean>(() => true)
  const adapter = new PixelPresentation(1n, send, vi.fn())
  adapter.receive(create(PixelPresentationStateSchema, { requestedRate: 30, appliedRate: 30 }))
  adapter.set({ kind: 'pixels', updateRateLimit: 15 })
  await vi.advanceTimersByTimeAsync(300)
  const request = send.mock.calls[0][0] as { operationId: string }
  adapter.receive(create(PixelPresentationStateSchema, { operationId: request.operationId, revision: 1n, requestedRate: 15, appliedRate: 30 }))
  await vi.advanceTimersByTimeAsync(5000)
  expect(adapter.controller.snapshot?.status).toBe('uncertain')
  expect(send).toHaveBeenCalledTimes(2)
  adapter.receive(create(PixelPresentationStateSchema, { operationId: request.operationId, revision: 1n, appliedRevision: 1n, requestedRate: 15, appliedRate: 15 }))
  expect(adapter.controller.snapshot?.status).toBe('applied')
  adapter.dispose()
})
