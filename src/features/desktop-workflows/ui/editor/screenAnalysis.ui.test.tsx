import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ScreenAnalysis, Step } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { ScreenshotEditor } from './ScreenshotEditor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const metadata = { width: 800, height: 400, desktop_width: 800, desktop_height: 400, connection_generation: 1, execution_generation: 1, display_epoch: 1, frame_sequence: 1, captured_at: '', region: { x: 0, y: 0, width: 800, height: 400 } }
const result = (): ScreenAnalysis => ({ id: 'analysis', session_id: 'session', sha256: 'digest', expires_at: new Date(Date.now() + 300000).toISOString(), metadata,
  result: { schema_version: 1, model: 'icon_detect', device: 'cpu', image: { width: 800, height: 400 }, parameters: {}, detection_ms: 1, render_ms: 1, total_ms: 5, ocr: { count: 0, inference_ms: 1 }, count: 1, truncated: false,
    elements: [{ id: 0, type: 'interactive_region', source: 'yolo', text: 'Connect', confidence: .9, bbox_xyxy: [10, 20, 110, 60], bbox_normalized: [.0125, .05, .1375, .15], center_xy: [60, 40] }] } })

function setup() {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screen')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  const gateway: WorkflowMediaGateway = { openPreview: vi.fn().mockResolvedValue({ id: 'preview' }), closePreview: vi.fn().mockResolvedValue(undefined), capture: vi.fn().mockResolvedValue({ metadata, blob: new Blob(['original']) }),
    analyze: vi.fn().mockResolvedValue(result()), analysisImage: vi.fn().mockResolvedValue(new Blob(['analyzed-original'])), deleteAnalysis: vi.fn().mockResolvedValue(undefined), match: vi.fn(), asset: vi.fn(), upload: vi.fn() }
  const step: Step = { id: 'click', kind: 'pointer.click', name: '', action: {}, target: { kind: 'point', x: 0, y: 0 } }
  const props = { gateway, step, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: vi.fn(), sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }] }
  return { gateway, props }
}
afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })

it('分析使用原图，列表选择能应用中心坐标，刷新释放旧结果', async () => {
  const { gateway, props } = setup()
  render(<ScreenshotEditor {...props} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  const option = await screen.findByRole('option', { name: /Connect/ })
  expect(gateway.analysisImage).toHaveBeenCalledWith('preview', 'analysis', 'original', expect.any(AbortSignal))
  fireEvent.click(option)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.usePoint' }))
  expect(props.onChange).toHaveBeenCalledWith('click', expect.any(Function))
  const edit = props.onChange.mock.calls[0][1]
  expect(edit(props.step).target).toMatchObject({ kind: 'point', x: 60, y: 40, reference_width: 800, reference_height: 400 })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.refresh' }))
  await waitFor(() => expect(screen.queryByRole('listbox', { name: 'desktopWorkflow.analysis.elements' })).not.toBeInTheDocument())
  expect(gateway.deleteAnalysis).toHaveBeenCalledWith('preview', 'analysis')
})

it('切换连接代次后丢弃迟到分析，不覆盖新的画面', async () => {
  const { gateway, props } = setup()
  let finish!: (value: ScreenAnalysis) => void
  vi.mocked(gateway.analyze).mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const view = render(<ScreenshotEditor {...props} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  await waitFor(() => expect(gateway.analyze).toHaveBeenCalledOnce())
  const signal = vi.mocked(gateway.analyze).mock.calls[0][1]!
  view.rerender(<ScreenshotEditor {...props} target={{ ...props.target, connectionGeneration: 2 }} sessions={[{ ...props.sessions[0], connection_generation: 2 }]} />)
  expect(signal.aborted).toBe(true)
  await act(async () => finish(result()))
  expect(screen.queryByRole('listbox', { name: 'desktopWorkflow.analysis.elements' })).not.toBeInTheDocument()
  expect(gateway.deleteAnalysis).toHaveBeenCalledWith('preview', 'analysis')
  expect(props.onChange).not.toHaveBeenCalled()
})

it('模板解码属于媒体任务，切换步骤后不上传或应用旧区域', async () => {
  const { gateway, props } = setup()
  let decoded!: () => void
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn(() => new Promise<void>(resolve => { decoded = resolve })) })
  const onMediaTask = vi.fn()
  const view = render(<ScreenshotEditor {...props} onMediaTask={onMediaTask} />)
  await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.analyze' }))
  fireEvent.click(await screen.findByRole('option', { name: /Connect/ }))
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysis.useTemplate' }))
  expect(onMediaTask).toHaveBeenCalledTimes(2)
  view.rerender(<ScreenshotEditor {...props} step={{ ...props.step, id: 'other' }} onMediaTask={onMediaTask} />)
  await act(async () => { decoded(); await onMediaTask.mock.calls[1][0] })
  expect(gateway.upload).not.toHaveBeenCalled()
  expect(props.onChange).not.toHaveBeenCalled()
  Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
})
