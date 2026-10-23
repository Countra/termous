import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { AnalysisElementView, AnalysisGateway, AnalysisSpanView } from '#common/contracts'
import { AnalysisElementDetail } from './AnalysisElementDetail'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const text = { text: 'Save', text_offset: 0, text_length: 4, text_truncated: false }

test('文字段展示自身中心，新增坐标不把文字段误当父元素开放应用操作', async () => {
  const span: AnalysisSpanView = { ...text, id: 2, element_id: 9, text_confidence: .9, bbox_xyxy: [100, 200, 260, 240], center_xy: [180, 220] }
  const gateway = { analysisSpan: vi.fn(async () => span), analysisSpans: vi.fn() } as unknown as AnalysisGateway
  const apply = vi.fn()
  render(<AnalysisElementDetail gateway={gateway} id="analysis" selected={9} span={2} filter={{}} active canPoint canRegion onApply={apply} onError={vi.fn()} />)
  expect(await screen.findByText('desktopWorkflow.analysis.center: 180, 220')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'desktopWorkflow.analysis.usePoint' })).not.toBeInTheDocument()
  expect(gateway.analysisSpans).not.toHaveBeenCalled()
  expect(apply).not.toHaveBeenCalled()
})

test('元素中心及已有应用回调保持一致', async () => {
  const element: AnalysisElementView = { ...text, id: 9, kind: 'region', source: 'detector+ocr', detection_confidence: .8,
    bbox_xyxy: [80, 180, 280, 260], center_xy: [180, 220], matched_ocr_spans: 1 }
  const gateway = { analysisElement: vi.fn(async () => element), analysisSpans: vi.fn(async () => ({ items: [], total: 0, limited_by_inference: false })) } as unknown as AnalysisGateway
  const apply = vi.fn()
  render(<AnalysisElementDetail gateway={gateway} id="analysis" selected={9} filter={{}} active canPoint canRegion onApply={apply} onError={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.analysis.usePoint' }))
  expect(apply).toHaveBeenCalledWith('point', element)
  expect(screen.getByText('desktopWorkflow.analysis.detectionScore: 0.800')).toBeInTheDocument()
})
