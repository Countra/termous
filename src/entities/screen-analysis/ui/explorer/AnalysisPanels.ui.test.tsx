import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { screenAnalysisDefaults, type AnalysisGateway, type AnalysisRecord, type AnalysisRenderedImage } from '#common/contracts'
import { AnalysisFilterEditor } from './AnalysisFilterEditor'
import { AnalysisToolsPanel } from './AnalysisToolsPanel'
import { AnalysisExplorer } from './AnalysisExplorer'
import { analysisMinimumFilter } from '../../model/analysisFilterInput'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('窄窗口打开辅助面板切到结果，仍可切回画面检查裁剪，切换面板后回到结果', () => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { if (element.hasAttribute('data-analysis-layout')) this.callback([{ target: element, contentRect: { width: 640 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  })
  const props = { gateway: {} as AnalysisGateway, state: { open: true, history: false, layer: 'elements' as const, filter: {} }, onChange: vi.fn(), history: null, onError: vi.fn() }
  const view = render(<AnalysisExplorer {...props} panel={{ key: 'export', content: <p>导出配置</p> }} />)
  const pane = () => view.container.querySelector('[data-mobile]')
  expect(pane()).toHaveAttribute('data-mobile', 'results')
  fireEvent.click(screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.collapseResults' }))
  expect(pane()).toHaveAttribute('data-mobile', 'canvas')
  view.rerender(<AnalysisExplorer {...props} panel={{ key: 'export', content: <p>更新裁剪</p> }} />)
  expect(pane()).toHaveAttribute('data-mobile', 'canvas')
  view.rerender(<AnalysisExplorer {...props} panel={{ key: 'details', content: <p>分析详情</p> }} />)
  expect(pane()).toHaveAttribute('data-mobile', 'results')
  view.rerender(<AnalysisExplorer {...props} state={{ ...props.state, history: true }} panel={{ key: 'details', content: <p>分析详情</p> }} />)
  expect(pane()).toHaveAttribute('data-mobile', 'history')
  fireEvent.click(screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.collapseHistory' }))
  view.rerender(<AnalysisExplorer {...props} panel={{ key: 'details', content: <p>分析详情</p> }} />)
  expect(pane()).toHaveAttribute('data-mobile', 'canvas')
})

it('筛选输入立即生效，未完成的像素范围不替换已提交条件', () => {
  const change = vi.fn()
  render(<AnalysisFilterEditor value={{ q: '连接' }} ocr={false} onChange={change} />)
  fireEvent.click(screen.getByText('desktopWorkflow.analysisWorkspace.advancedFilters'))
  const box = screen.getByRole('textbox', { name: 'analysisCenter.bbox' })
  fireEvent.change(box, { target: { value: '0,,10,20' } })
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('desktopWorkflow.analysisWorkspace.invalidFilter')
  fireEvent.change(box, { target: { value: '0,0,10,20' } })
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ q: '连接', bbox: [0, 0, 10, 20] }))
  const ids = screen.getByRole('textbox', { name: 'desktopWorkflow.analysisWorkspace.ids' })
  change.mockClear()
  fireEvent.change(ids, { target: { value: '1, 1' } })
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('desktopWorkflow.analysisWorkspace.invalidFilter')
  fireEvent.change(ids, { target: { value: '1, 2' } })
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ element_ids: [1, 2] }))
  expect(screen.queryByText('desktopWorkflow.analysisWorkspace.applyFilter')).not.toBeInTheDocument()
})

it('置信度只支持最低百分比，旧边界不成为隐藏条件，清空恢复不限', () => {
  const change = vi.fn()
  render(<AnalysisFilterEditor value={{ q: '连接', detection_gt: .5, text_max: .8 }} ocr={false} onChange={change} />)
  const minimum = screen.getByRole('spinbutton', { name: 'desktopWorkflow.analysisWorkspace.detectionMinimum' })
  expect(minimum).toHaveValue('50')
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  fireEvent.change(minimum, { target: { value: '70' } })
  const filter = change.mock.calls[change.mock.calls.length - 1][0]
  expect(filter).toMatchObject({ q: '连接', detection_min: .7 })
  expect(filter).not.toHaveProperty('detection_gt')
  expect(filter).not.toHaveProperty('text_max')
  fireEvent.change(minimum, { target: { value: '' } })
  expect(change.mock.calls[change.mock.calls.length - 1][0].detection_min).toBeUndefined()
  expect(analysisMinimumFilter({ detection_lt: .9, text_gt: .4, text_max: .7, q: 'Save' })).toEqual({ text_min: .4, q: 'Save' })
})

it('导出采用全部已提交筛选，非法裁剪拒绝请求，关闭后取消读取且不下载迟到响应', async () => {
  let finish!: (value: unknown) => void
  const renderImage = vi.fn<AnalysisGateway['renderAnalysisImage']>(() => new Promise<AnalysisRenderedImage>(resolve => { finish = value => resolve(value as AnalysisRenderedImage) }))
  const create = vi.spyOn(URL, 'createObjectURL')
  const record = { id: 'record', state: 'succeeded', sha256: 'saved', parameters: screenAnalysisDefaults, image: { width: 800, height: 600, coordinate_space: 'original_pixels' } } as AnalysisRecord
  const view = render(<AnalysisToolsPanel kind="export" record={record} gateway={{ renderAnalysisImage: renderImage } as unknown as AnalysisGateway}
    state={{ open: true, history: false, layer: 'ocr', filter: { text_gt: .5, limit: 20, cursor: 'next', sort: 'confidence_desc' } }} busy={false} onReanalyze={async () => {}} onCrop={() => {}} onClose={() => {}} />)
  const crop = screen.getByRole('textbox', { name: 'analysisCenter.image.crop' })
  fireEvent.change(crop, { target: { value: '0,0,801,600' } })
  fireEvent.click(screen.getByText('desktopWorkflow.analysisWorkspace.exportFiltered'))
  await screen.findByText('analysisCenter.image.invalidCrop')
  expect(renderImage).not.toHaveBeenCalled()
  fireEvent.change(crop, { target: { value: '0,0,400,300' } })
  fireEvent.click(screen.getByText('desktopWorkflow.analysisWorkspace.exportFiltered'))
  await waitFor(() => expect(renderImage).toHaveBeenCalledOnce())
  expect(renderImage).toHaveBeenCalledWith('record', { text_gt: .5, layer: 'ocr', crop: [0, 0, 400, 300], max_side: 1600, label_mode: 'auto' }, expect.any(AbortSignal))
  const signal = renderImage.mock.calls[0][2]
  view.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => finish({ blob: new Blob(['late']) }))
  expect(create).not.toHaveBeenCalled()
})
