import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { expect, test, vi } from 'vitest'
import { screenAnalysisDefaults, type AnalysisGateway, type AnalysisRecord } from '#common/contracts'
import { AnalysisHistory } from './AnalysisHistory'
import { ReanalyzeDialog } from './ReanalyzeDialog'
import { AnalysisFilters } from './AnalysisFilters'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const record: AnalysisRecord = { id: 'analysis-fixture', state: 'succeeded', stage: 'complete', source: { kind: 'preview', id: 'closed-preview', name: '测试桌面' },
  created_at: '2026-10-23T00:00:00Z', expires_at: '2026-10-30T00:00:00Z', duration_ms: 10, inference_ms: 1000, reused: true, reuse_allowed: true,
  parameters: screenAnalysisDefaults, parameter_source: 'settings', schema_version: 2,
  summary: { element_count: 0, region_count: 0, text_count: 0, ocr_span_count: 0, truncated: false, truncation_reasons: [] } }

test('没有桌面连接也能浏览记录，详情按需读取且关闭不取消任务', async () => {
  const getAnalysis = vi.fn(async () => record)
  const exportAnalysis = vi.fn()
  const cancelAnalysis = vi.fn()
  const deleteAnalysis = vi.fn(async () => undefined)
  const gateway = { getAnalysis, exportAnalysis, cancelAnalysis, deleteAnalysis,
    listAnalyses: vi.fn(async () => ({ items: [record], total: 1, limited_by_inference: false })),
    analysisElements: vi.fn(async () => ({ items: [], total: 0, limited_by_inference: false })),
    analysisGeometry: vi.fn(async () => []) } as unknown as AnalysisGateway
  const view = render(<App><AnalysisHistory gateway={gateway} active /></App>)
  fireEvent.click(await screen.findByRole('button', { name: /测试桌面/ }))
  expect(await screen.findByText('analysisCenter.historyReadonly')).toBeInTheDocument()
  await waitFor(() => expect(gateway.analysisElements).toHaveBeenCalled())
  expect(exportAnalysis).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'desktopWorkflow.analysis.usePoint' })).not.toBeInTheDocument()
  view.unmount()
  expect(cancelAnalysis).not.toHaveBeenCalled()
  expect(deleteAnalysis).not.toHaveBeenCalled()
})

test('重新分析强制推理，失败重试沿用请求 ID，改参数使用新请求', async () => {
  const submitAnalysis = vi.fn().mockRejectedValue(new Error('lost reply'))
  const gateway = { submitAnalysis } as unknown as AnalysisGateway
  render(<App><ReanalyzeDialog record={record} gateway={gateway} onDone={vi.fn()} onClose={vi.fn()} /></App>)
  const ok = screen.getByRole('button', { name: /OK|确 定|确定/u })
  fireEvent.click(ok)
  expect(await screen.findByText('analysisCenter.submitFailed')).toBeInTheDocument()
  await waitFor(() => expect(ok).not.toHaveClass('ant-btn-loading'))
  fireEvent.click(ok)
  await waitFor(() => expect(submitAnalysis).toHaveBeenCalledTimes(2))
  expect(submitAnalysis.mock.calls[1][0]).toEqual(submitAnalysis.mock.calls[0][0])
  expect(submitAnalysis.mock.calls[0][0]).toMatchObject({ source: { kind: 'analysis', id: record.id }, parameters: screenAnalysisDefaults, reuse: false })
  const confidence = screen.getByRole('spinbutton', { name: 'settings.screenAnalysis.confidence' })
  await waitFor(() => expect(confidence).toBeEnabled())
  fireEvent.change(confidence, { target: { value: '0.2' } }); fireEvent.blur(confidence)
  fireEvent.click(ok)
  await waitFor(() => expect(submitAnalysis).toHaveBeenCalledTimes(3))
  expect(submitAnalysis.mock.calls[2][0].request_id).not.toBe(submitAnalysis.mock.calls[0][0].request_id)
})

test('无效空间范围显示错误并保留当前筛选', () => {
  const change = vi.fn()
  render(<AnalysisFilters value={{}} spans={false} onChange={change} />)
  const box = screen.getByRole('textbox', { name: 'analysisCenter.bbox' })
  fireEvent.change(box, { target: { value: '0,,10,20' } }); fireEvent.keyDown(box, { key: 'Enter' }); fireEvent.keyUp(box, { key: 'Enter' })
  expect(screen.getByRole('alert')).toHaveTextContent('analysisCenter.bboxInvalid')
  expect(change).not.toHaveBeenCalled()
  const corrected = screen.getByRole('textbox', { name: 'analysisCenter.bbox' })
  fireEvent.change(corrected, { target: { value: '0,0,10,20' } }); fireEvent.keyDown(corrected, { key: 'Enter' }); fireEvent.keyUp(corrected, { key: 'Enter' })
  expect(change).toHaveBeenCalledWith({ bbox: [0, 0, 10, 20], cursor: undefined })
})
