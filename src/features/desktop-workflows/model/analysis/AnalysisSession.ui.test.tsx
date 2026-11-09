import { afterEach, expect, it, vi } from 'vitest'
import type { AnalysisRecord } from '#common/contracts'
import type { WorkflowMediaGateway } from '../workspace/types'
import { AnalysisSession } from './AnalysisSession'

afterEach(() => vi.useRealTimers())
const record = { id: 'analysis', state: 'queued', sha256: 'saved' } as AnalysisRecord
function fixture() {
  const gateway = { openPreview: vi.fn().mockResolvedValue({ id: 'preview' }), closePreview: vi.fn().mockResolvedValue(undefined),
    submitAnalysis: vi.fn().mockResolvedValue(record), getAnalysis: vi.fn().mockResolvedValue(record), cancelAnalysis: vi.fn() } as unknown as WorkflowMediaGateway
  return { gateway, session: new AnalysisSession(gateway) }
}

it('重复提交合并在途请求，传输失败重试复用身份，新操作使用新身份', async () => {
  const { gateway, session } = fixture()
  vi.mocked(gateway.submitAnalysis).mockRejectedValueOnce(new Error('connection lost'))
  const target = { id: 'desktop', generation: 1 }
  await expect(session.submit(target, undefined, vi.fn())).rejects.toThrow('connection lost')
  const first = vi.mocked(gateway.submitAnalysis).mock.calls[0][0]
  const running = session.submit(target, undefined, vi.fn())
  expect(session.submit(target, undefined, vi.fn())).toBe(running)
  await running
  expect(vi.mocked(gateway.submitAnalysis).mock.calls[1][0]).toEqual(first)
  await session.submit(target, undefined, vi.fn())
  expect(vi.mocked(gateway.submitAnalysis).mock.calls[2][0].request_id).not.toBe(first.request_id)
  await session.dispose()
  expect(gateway.closePreview).toHaveBeenCalledTimes(1)
  expect(gateway.cancelAnalysis).not.toHaveBeenCalled()
})

it('宿主关闭等待捕获落盘才释放预览，后台任务保持独立', async () => {
  vi.useFakeTimers()
  const { gateway, session } = fixture()
  vi.mocked(gateway.submitAnalysis).mockResolvedValue({ ...record, state: 'preparing', sha256: undefined })
  const submitted = vi.fn()
  const running = session.submit({ id: 'desktop', generation: 1 }, undefined, submitted)
  await vi.advanceTimersByTimeAsync(0)
  expect(submitted).toHaveBeenCalledOnce()
  const closing = session.dispose()
  expect(gateway.closePreview).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  await running; await closing
  expect(gateway.closePreview).toHaveBeenCalledWith('preview')
  expect(gateway.cancelAnalysis).not.toHaveBeenCalled()
})

it('桌面代次变化更换预览，历史重算不产生实时应用资格', async () => {
  const { gateway, session } = fixture()
  await session.submit({ id: 'desktop', generation: 1 }, undefined, vi.fn())
  await session.submit({ id: 'desktop', generation: 2 }, undefined, vi.fn())
  expect(gateway.openPreview).toHaveBeenCalledTimes(2)
  expect(gateway.closePreview).toHaveBeenCalledTimes(1)
  const live = session.live
  await session.reanalyze('history', undefined)
  expect(session.live).toBe(live)
  expect(vi.mocked(gateway.submitAnalysis).mock.calls[2][0]).toMatchObject({ source: { kind: 'analysis', id: 'history' }, reuse: false })
  await session.dispose()
})
