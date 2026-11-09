import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { AnalysisElementView, AnalysisGateway, AnalysisPresentation, AnalysisSpanView } from '#common/contracts'
import { useAnalysisResults } from '../../model/useAnalysisResults'
import { AnalysisResults } from './AnalysisResults'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

test('单击仅选中，独立入口打开详情；返回保留列表滚动和焦点，关联 OCR 使用自己的接口', async () => {
  const element: AnalysisElementView = { id: 0, kind: 'region', source: 'detector+ocr', text: 'Connect', text_offset: 0,
    text_length: 7, text_truncated: false, matched_ocr_spans: 1, bbox_xyxy: [0, 0, 100, 100], center_xy: [49, 49], detection_confidence: .9 }
  const span: AnalysisSpanView = { id: 0, element_id: 0, text: 'Connect', text_offset: 0, text_length: 7, text_truncated: false,
    bbox_xyxy: [10, 20, 60, 40], center_xy: [34, 29], text_confidence: .8 }
  const page = <T,>(items: T[]) => ({ items, total: items.length, limited_by_inference: false })
  const gateway = {
    analysisElements: vi.fn(async () => page([element])), analysisSpans: vi.fn(async () => page([span])),
    analysisElement: vi.fn(async () => element), analysisSpan: vi.fn(async () => span),
    analysisGeometry: vi.fn<AnalysisGateway['analysisGeometry']>(async (_id, _signal, query) => query?.layer === 'ocr'
      ? [{ id: 0, kind: 'text', element_id: 0, bbox_xyxy: span.bbox_xyxy, center_xy: span.center_xy }]
      : [{ id: 0, kind: 'region', bbox_xyxy: element.bbox_xyxy, center_xy: element.center_xy }]),
  } as unknown as AnalysisGateway
  function View() {
    const [state, setState] = useState<AnalysisPresentation>({ open: true, history: false, layer: 'elements', filter: {} })
    const result = useAnalysisResults(gateway, 'record', state.layer, state.filter)
    return <AnalysisResults gateway={gateway} id="record" state={state} onChange={patch => setState(value => ({ ...value, ...patch }))}
      result={result} cursor={0} onPage={vi.fn()} onError={vi.fn()} />
  }
  render(<View />)
  const row = await screen.findByRole('button', { name: /Connect/ })
  const list = screen.getByRole('list')
  list.scrollTop = 120
  fireEvent.click(row)
  expect(row).toHaveAttribute('aria-pressed', 'true')
  expect(list).toBeVisible()
  expect(gateway.analysisElement).not.toHaveBeenCalled()
  expect(screen.queryByText('desktopWorkflow.analysisWorkspace.back')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.viewItem' }))
  expect(await screen.findByText('0.900')).toBeVisible()
  expect(gateway.analysisSpans).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('desktopWorkflow.analysisWorkspace.back'))
  expect(screen.getByRole('list')).toBe(list)
  expect(list.scrollTop).toBe(120)
  expect(row).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.viewItem' }))
  fireEvent.click(await screen.findByText('desktopWorkflow.analysisWorkspace.relatedText'))
  fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.analysisWorkspace.viewOCR' }))
  await waitFor(() => expect(gateway.analysisSpan).toHaveBeenCalledWith('record', 0, 0, expect.any(AbortSignal)))
  expect(await screen.findByText('34, 29', { selector: 'dd' })).toBeVisible()
  expect(screen.queryByText('desktopWorkflow.analysisWorkspace.relatedText')).not.toBeInTheDocument()
})
