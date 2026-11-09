import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import { screenAnalysisDefaults, type AnalysisDiagnosticView, type AnalysisGateway, type AnalysisRecord } from '#common/contracts'
import { AnalysisRecordDetails } from './AnalysisRecordDetails'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const record = { id: 'saved-analysis', state: 'succeeded', source: { kind: 'preview', id: 'preview', name: 'test desktop' },
  parameters: screenAnalysisDefaults, reused: true, duration_ms: 5, inference_ms: 2300, created_at: '2026-10-25T00:00:00Z',
  summary: { region_count: 2, text_count: 3, ocr_span_count: 5, truncated: false },
  confidence_distribution: { detection: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1], ocr: [0, 0, 0, 0, 0, 0, 0, 0, 2, 3] },
} as AnalysisRecord

it('概览区分本次和原始推理耗时，诊断按需读取，关闭后取消未完成请求', async () => {
  let resolve!: (value: AnalysisDiagnosticView) => void
  const diagnostics = vi.fn<AnalysisGateway['analysisDiagnostics']>(() => new Promise(done => { resolve = done }))
  const back = vi.fn()
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}><AnalysisRecordDetails record={record} gateway={{ analysisDiagnostics: diagnostics } as unknown as AnalysisGateway} onBack={back} onError={vi.fn()} /></ConfigProvider>)
  expect(screen.getByText('5 ms')).toBeInTheDocument()
  expect(screen.getByText(`${(2300).toLocaleString()} ms`)).toBeInTheDocument()
  expect(diagnostics).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /desktopWorkflow.analysis.diagnostics/ }))
  await waitFor(() => expect(diagnostics).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.back' }))
  expect(back).toHaveBeenCalledOnce()
  view.unmount()
  expect(diagnostics.mock.calls[0][1]?.aborted).toBe(true)
  await act(async () => resolve({} as AnalysisDiagnosticView))
})

it('未成功任务不读推理诊断，参数和空分布仍可查看', () => {
  const diagnostics = vi.fn()
  render(<AnalysisRecordDetails record={{ ...record, state: 'failed', error: 'model unavailable', confidence_distribution: undefined, summary: undefined }} gateway={{ analysisDiagnostics: diagnostics } as unknown as AnalysisGateway} onBack={() => {}} onError={vi.fn()} />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText('desktopWorkflow.analysis.diagnostics')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /desktopWorkflow.analysisWorkspace.detail.parameters/ }))
  expect(screen.getByText('5%')).toBeInTheDocument()
  expect(diagnostics).not.toHaveBeenCalled()
})
