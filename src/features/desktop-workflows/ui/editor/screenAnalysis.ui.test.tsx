import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Step } from '#entities/desktop-workflow'
import { screenAnalysisDefaults, type AnalysisRecord, type AnalysisElementView } from '#common/contracts'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { ScreenshotEditor } from './ScreenshotEditor'
import { AnalysisPanel } from '#entities/screen-analysis'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const metadata = { width: 800, height: 400, desktop_width: 800, desktop_height: 400, connection_generation: 1, execution_generation: 1, display_epoch: 1, frame_sequence: 1, captured_at: '', region: { x: 0, y: 0, width: 800, height: 400 } }
const element: AnalysisElementView = { id: 0, kind: 'region', source: 'detector+ocr', text: 'Connect', detection_confidence: .9,
  bbox_xyxy: [10, 20, 110, 60], center_xy: [60, 40], text_offset: 0, text_length: 7, text_truncated: false, matched_ocr_spans: 1 }
const result = (): AnalysisRecord => ({ id: 'analysis', state: 'succeeded', stage: 'complete', source: { kind: 'preview', id: 'preview' },
  parameters: { ...screenAnalysisDefaults }, parameter_source: 'settings', session_id: 'session', settings_revision: 1, sha256: 'digest', metadata,
  created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), action_expires_at: new Date(Date.now() + 300000).toISOString(),
  reused: false, reuse_allowed: true, duration_ms: 10, inference_ms: 5, schema_version: 2, image: { width: 800, height: 400, coordinate_space: 'original_pixels' },
  summary: { element_count: 1, region_count: 1, text_count: 0, ocr_span_count: 1, truncated: false, truncation_reasons: [] } })
function setup() {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screen'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const gateway: WorkflowMediaGateway = {
    ocrDefaults: vi.fn().mockResolvedValue({text_confidence:.5,ocr_max_side:1600}), previewOCR: vi.fn(), ocrReport: vi.fn(), openPreview: vi.fn().mockResolvedValue({ id: 'preview' }), closePreview: vi.fn().mockResolvedValue(undefined), capture: vi.fn().mockResolvedValue({ metadata, blob: new Blob(['original']) }),
    analysisFull: vi.fn(), renderAnalysisImage: vi.fn(), submitAnalysis: vi.fn().mockResolvedValue({ ...result(), state: 'queued' }), getAnalysis: vi.fn().mockResolvedValue(result()),
    analysisImage: vi.fn().mockResolvedValue(new Blob(['analyzed-original'])), deleteAnalysis: vi.fn(), cancelAnalysis: vi.fn().mockResolvedValue({ ...result(), state: 'cancelling' }),
    match: vi.fn(), asset: vi.fn(), upload: vi.fn(), listAnalyses: vi.fn(), clearAnalyses: vi.fn(), analysisStorage: vi.fn(),
    analysisElements: vi.fn().mockResolvedValue({ items: [element], total: 1, limited_by_inference: false }),
    analysisElement: vi.fn().mockResolvedValue(element), analysisSpans: vi.fn().mockResolvedValue({ items: [], total: 0 }), analysisSpan: vi.fn(),
    analysisGeometry: vi.fn().mockResolvedValue([element]), analysisDiagnostics: vi.fn(), exportAnalysis: vi.fn().mockResolvedValue(new Blob(['{}'])),
    validateAnalysisAction: vi.fn().mockResolvedValue(undefined),
  }
  const step: Step = { id: 'click', kind: 'pointer.click', name: '', action: {}, target: { kind: 'point', x: 0, y: 0 } }
  const props = { gateway, step, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: vi.fn(),
    sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }] }
  return { gateway, props }
}
afterEach(() => vi.restoreAllMocks())

it('一键提交后按需查询，应用坐标校验原预览；刷新不删除持久记录', async () => {
  const { gateway, props } = setup()
  render(<ScreenshotEditor {...props} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  fireEvent.click(await screen.findByRole('option', { name: /Connect/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.analysis.usePoint' }))
  await waitFor(() => expect(props.onChange).toHaveBeenCalled())
  expect(gateway.submitAnalysis).toHaveBeenCalledWith({ request_id: expect.any(String), source: { kind: 'preview', id: 'preview' } }, expect.any(AbortSignal))
  expect(gateway.validateAnalysisAction).toHaveBeenCalledWith('analysis', 'preview')
  expect(props.onChange.mock.calls[0][1](props.step).target).toMatchObject({ x: 60, y: 40, reference_width: 800, reference_height: 400 })
  expect(gateway.exportAnalysis).not.toHaveBeenCalled()
  expect(gateway.analysisDiagnostics).not.toHaveBeenCalled()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.exportJSON' }))
  await waitFor(() => expect(gateway.exportAnalysis).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.refresh' }))
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  expect(gateway.deleteAnalysis).not.toHaveBeenCalled()
  expect(gateway.cancelAnalysis).not.toHaveBeenCalled()
})

it('关闭编辑器只停止读取，明确取消才请求后台取消', async () => {
  const { gateway, props } = setup()
  vi.mocked(gateway.getAnalysis).mockResolvedValue({ ...result(), state: 'running', stage: 'inference' })
  const view = render(<ScreenshotEditor {...props} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.analysis.cancel' }))
  await waitFor(() => expect(gateway.cancelAnalysis).toHaveBeenCalledWith('analysis'))
  view.unmount()
  expect(gateway.cancelAnalysis).toHaveBeenCalledTimes(1)
  expect(gateway.deleteAnalysis).not.toHaveBeenCalled()
})

it('结果图片读取失败可重试同一任务，不重新截图或提交推理', async () => {
  const { gateway, props } = setup()
  vi.mocked(gateway.analysisImage).mockRejectedValueOnce(new Error('temporary image failure'))
  render(<ScreenshotEditor {...props} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  expect(await screen.findByText('analysisCenter.readFailed')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  await screen.findByRole('option', { name: /Connect/ })
  expect(screen.queryByText('analysisCenter.readFailed')).not.toBeInTheDocument()
  expect(gateway.submitAnalysis).toHaveBeenCalledOnce()
  expect(gateway.openPreview).toHaveBeenCalledOnce()
  expect(gateway.capture).toHaveBeenCalledOnce()
  expect(gateway.analysisImage).toHaveBeenCalledTimes(2)
})

it('切换连接代次丢弃迟到概览，不覆盖新的画面也不删除任务', async () => {
  const { gateway, props } = setup()
  let finish!: (value: AnalysisRecord) => void
  vi.mocked(gateway.submitAnalysis).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<ScreenshotEditor {...props} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  await waitFor(() => expect(gateway.submitAnalysis).toHaveBeenCalledOnce())
  view.rerender(<ScreenshotEditor {...props} target={{ ...props.target, connectionGeneration: 2 }} sessions={[{ ...props.sessions[0], connection_generation: 2 }]} />)
  await act(async () => finish(result()))
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(gateway.cancelAnalysis).not.toHaveBeenCalled(); expect(gateway.deleteAnalysis).not.toHaveBeenCalled()
})

it('模板解码期间切换步骤，不上传或应用旧区域', async () => {
  const { gateway, props } = setup()
  let decoded!: () => void
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn(() => new Promise<void>(resolve => { decoded = resolve })) })
  const view = render(<ScreenshotEditor {...props} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  fireEvent.click(await screen.findByRole('option', { name: /Connect/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.analysis.useTemplate' }))
  await waitFor(() => expect(decoded).toBeDefined())
  view.rerender(<ScreenshotEditor {...props} step={{ ...props.step, id: 'other' }} />)
  await act(async () => decoded())
  expect(gateway.upload).not.toHaveBeenCalled(); expect(props.onChange).not.toHaveBeenCalled()
  Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
})

it('筛选和翻页使用查询接口，不下载完整结果', async () => {
  const { gateway } = setup()
  vi.mocked(gateway.analysisElements).mockResolvedValue({ items: [element], total: 30, next_cursor: 'next', limited_by_inference: true })
  render(<AnalysisPanel analysis={result()} gateway={gateway} onSelect={vi.fn()} onHover={vi.fn()} onExport={vi.fn()} onError={vi.fn()} />)
  await screen.findByRole('option', { name: /Connect/ })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.next' }))
  await waitFor(() => expect(gateway.analysisElements).toHaveBeenLastCalledWith('analysis', { cursor: 'next' }, expect.any(AbortSignal)))
  const input = screen.getByRole('searchbox', { name: 'desktopWorkflow.analysis.search' })
  fireEvent.change(input, { target: { value: '中文' } }); fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 })
  await waitFor(() => expect(gateway.analysisElements).toHaveBeenLastCalledWith('analysis', { q: '中文', cursor: undefined }, expect.any(AbortSignal)))
  expect(screen.getByText('analysisCenter.inferenceLimited')).toBeInTheDocument()
  expect(gateway.exportAnalysis).not.toHaveBeenCalled()
})
