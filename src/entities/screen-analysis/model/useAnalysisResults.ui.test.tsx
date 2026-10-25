import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { AnalysisGateway, AnalysisGeometry, AnalysisPage, AnalysisElementView } from '#common/contracts'
import { useAnalysisResults } from './useAnalysisResults'

it('筛选过程中保留整组旧结果，列表和几何到齐才替换，迟到响应不能跨记录发布', async () => {
  const geometry = [{ id: 0, kind: 'region', bbox_xyxy: [0, 0, 2, 2], center_xy: [0, 0] }] as AnalysisGeometry[]
  const page = { items: [], total: 1, limited_by_inference: false } as AnalysisPage<AnalysisElementView>
  const gateway = { analysisElements: vi.fn().mockResolvedValue(page), analysisGeometry: vi.fn().mockResolvedValue(geometry) } as unknown as AnalysisGateway
  const view = renderHook(({ id, q }) => useAnalysisResults(gateway, id, 'elements', { q }), { initialProps: { id: 'first', q: '' } })
  await waitFor(() => expect(view.result.current.loading).toBe(false))
  let finish!: (value: AnalysisGeometry[]) => void
  vi.mocked(gateway.analysisGeometry).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  vi.mocked(gateway.analysisElements).mockResolvedValue({ ...page, total: 0 })
  view.rerender({ id: 'first', q: 'missing' })
  expect(view.result.current.loading).toBe(true)
  expect(view.result.current.data?.page.total).toBe(1)
  await act(async () => finish([]))
  expect(view.result.current.data?.page.total).toBe(0)
  expect(view.result.current.data?.geometry).toEqual([])
  view.rerender({ id: 'second', q: '' })
  expect(view.result.current.data).toBeUndefined()
  view.unmount()
  expect(vi.mocked(gateway.analysisGeometry).mock.calls[2][1]?.aborted).toBe(true)
})

it('新筛选读取失败时隐藏旧集合，重试成功后同时恢复列表和几何', async () => {
  const geometry = [{ id: 0, kind: 'region', bbox_xyxy: [0, 0, 2, 2], center_xy: [0, 0] }] as AnalysisGeometry[]
  const page = { items: [], total: 1, limited_by_inference: false } as AnalysisPage<AnalysisElementView>
  const gateway = { analysisElements: vi.fn().mockResolvedValue(page), analysisGeometry: vi.fn().mockResolvedValue(geometry) } as unknown as AnalysisGateway
  const view = renderHook(({ q }) => useAnalysisResults(gateway, 'analysis', 'elements', { q }), { initialProps: { q: '' } })
  await waitFor(() => expect(view.result.current.data?.page.total).toBe(1))
  vi.mocked(gateway.analysisGeometry).mockRejectedValueOnce(new Error('geometry unavailable'))
  view.rerender({ q: 'missing' })
  await waitFor(() => expect(view.result.current.error).toBeInstanceOf(Error))
  expect(view.result.current.data).toBeUndefined()
  vi.mocked(gateway.analysisElements).mockResolvedValue({ ...page, total: 0 })
  vi.mocked(gateway.analysisGeometry).mockResolvedValue([])
  act(() => view.result.current.reload())
  await waitFor(() => expect(view.result.current.data?.page.total).toBe(0))
  expect(view.result.current.data?.geometry).toEqual([])
  view.unmount()
})

it.each(['list', 'geometry'])('查询 %s 失败后取消同批另一侧读取，不等待关闭或重试', async failed => {
  const pending = () => new Promise<never>(() => {})
  const error = new Error('read failed')
  const gateway = {
    analysisElements: vi.fn(failed === 'list' ? () => Promise.reject(error) : pending),
    analysisGeometry: vi.fn(failed === 'geometry' ? () => Promise.reject(error) : pending),
  } as unknown as AnalysisGateway
  const view = renderHook(() => useAnalysisResults(gateway, 'analysis', 'elements', {}))
  await waitFor(() => expect(view.result.current.error).toBe(error))
  expect(vi.mocked(gateway.analysisElements).mock.calls[0][2]?.aborted).toBe(true)
  expect(vi.mocked(gateway.analysisGeometry).mock.calls[0][1]?.aborted).toBe(true)
  expect(view.result.current.data).toBeUndefined()
})
