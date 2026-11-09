import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OCRPreview, Step } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { ScreenshotEditor } from './ScreenshotEditor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>
const metadata = { width: 1000, height: 500, desktop_width: 1000, desktop_height: 500, connection_generation: 1, display_epoch: 1, frame_sequence: 1, captured_at: '', region: { x: 0, y: 0, width: 1000, height: 500 } }
const query = { text_confidence: .5, ocr_max_side: 1600 }
const reading: Step = { id: 'read', kind: 'ocr.read', name: '', action: {}, ocr: query }
const result = (): OCRPreview => ({
  capture: { metadata }, image: new Blob(['ocr'], { type: 'image/png' }),
  observation: { role: '', width: 1000, height: 500, parameters: query, recognized_count: 3, matched_count: 1,
    selected_ids: [], truncated: false, truncation_reasons: [], duration_ms: 30, device: 'cpu', fingerprint: '',
    spans: [
      { id: 0, text: '范围外', confidence: .9, bbox_xyxy: [800, 300, 900, 320], center_xy: [850, 310], matched: false },
      { id: 1, text: '范围内但文字不匹配', confidence: .9, bbox_xyxy: [120, 100, 200, 120], center_xy: [160, 110], matched: false },
      { id: 2, text: '保存', confidence: .9, bbox_xyxy: [120, 140, 200, 160], center_xy: [160, 150], matched: true },
    ] },
})

function setup(step = reading) {
  let sequence = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:ocr-${++sequence}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const api = { openPreview: vi.fn().mockResolvedValue({ id: 'preview' }), closePreview: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue({ metadata, blob: new Blob(['screen']) }), previewOCR: vi.fn().mockResolvedValue(result()),
  } as unknown as WorkflowMediaGateway
  const props = { gateway: api, step, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: vi.fn(),
    sessions: [{ id: 'session', profile_name: '合成桌面', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }] }
  const view = render(<ScreenshotEditor {...props} />, { wrapper })
  return { ...view, api, props }
}

async function canvas() {
  const image = await screen.findByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 40, width: 500, height: 250 } as DOMRect)
  fireEvent.load(image)
  const element = screen.getByRole('group', { name: 'desktopWorkflow.selection.canvas' })
  element.setPointerCapture = vi.fn(); element.hasPointerCapture = vi.fn().mockReturnValue(true); element.releasePointerCapture = vi.fn()
  return element
}
function draw(element: HTMLElement) {
  fireEvent.pointerDown(element, { clientX: 70, clientY: 90, button: 0, pointerId: 1, isPrimary: true })
  fireEvent.pointerUp(element, { clientX: 170, clientY: 140, button: 0, pointerId: 1, isPrimary: true })
}
afterEach(() => vi.restoreAllMocks())

describe('OCR 可选范围与匹配预览', () => {
  it.each(['contains', 'regex'] as const)('选择文字保留 %s 和范围，列表与画面双向联动且可反复选择', async match => {
    const configured: Step = { ...reading, ocr: { ...query, text: '', match, case_sensitive: false, normalize_whitespace: true,
      region: { x: 100, y: 100, width: 201, height: 101 }, reference_width: 1000, reference_height: 500 } }
    const view = setup(configured)
    const response = result()
    response.observation.spans[1] = { ...response.observation.spans[1], text: '取消', matched: true }
    response.observation.matched_count = 2
    vi.mocked(view.api.previewOCR).mockResolvedValue(response)
    await canvas()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' }))
    const panel = await screen.findByRole('region', { name: 'desktopWorkflow.ocr.preview' })
    await waitFor(() => expect(screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })).toHaveAttribute('src', 'blob:ocr-2'))
    await canvas()
    const image = screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }))
    let updated = view.props.onChange.mock.calls[0][1](configured) as Step
    expect(updated.ocr).toEqual({ ...configured.ocr, text: '保存' })
    view.rerender(<ScreenshotEditor {...view.props} step={updated} />)
    expect(view.container.querySelector('[data-ocr-id="2"]')).toHaveAttribute('aria-pressed', 'true')
    expect(within(panel).getByRole('button', { name: '保存' })).toHaveAttribute('aria-pressed', 'true')

    const other = view.container.querySelector('[data-ocr-id="1"]')!
    fireEvent.click(other, { ctrlKey: true })
    expect(view.props.onChange).toHaveBeenCalledTimes(1)
    fireEvent.click(other)
    updated = view.props.onChange.mock.calls[1][1](updated) as Step
    expect(updated.ocr).toEqual({ ...configured.ocr, text: '取消' })
    view.rerender(<ScreenshotEditor {...view.props} step={updated} />)
    expect(within(panel).getByRole('button', { name: '取消' })).toHaveAttribute('aria-pressed', 'true')
    expect(view.container.querySelector('[data-ocr-id="2"]')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })).toBe(image)
    expect(view.api.previewOCR).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)

    // 手动修改正文必须使旧匹配结果失效，不能借选择保留逻辑混入新条件。
    view.rerender(<ScreenshotEditor {...view.props} step={{ ...updated, ocr: { ...updated.ocr!, text: '手动输入' } }} />)
    expect(screen.queryByRole('region', { name: 'desktopWorkflow.ocr.preview' })).not.toBeInTheDocument()
  })

  it('拖动终点填入文字保留起点、锚点、偏移和序号；绑定文字只高亮', async () => {
    const configured: Step = { ...reading, kind: 'pointer.drag', ocr: undefined,
      target: { kind: 'point', x: 10, y: 20, reference_width: 1000, reference_height: 500 },
      end_target: { kind: 'ocr', ocr: { ...query, text: '', match: 'contains', anchor: 'bottom_right', occurrence: 2, offset: { x: 5, y: 10 } } } }
    const view = setup(configured)
    view.rerender(<ScreenshotEditor {...view.props} slot="end_target" />)
    await canvas()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' }))
    const panel = await screen.findByRole('region', { name: 'desktopWorkflow.ocr.preview' })
    await waitFor(() => expect(screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })).toHaveAttribute('src', 'blob:ocr-2'))
    await canvas()
    fireEvent.click(within(panel).getByRole('button', { name: '保存' }))
    const updated = view.props.onChange.mock.calls[0][1](configured) as Step
    expect(updated.target).toEqual(configured.target)
    expect(updated.end_target?.ocr).toEqual({ ...configured.end_target!.ocr, text: '保存' })
    view.rerender(<ScreenshotEditor {...view.props} slot="end_target" step={{ ...updated, bindings: { end_target_ocr_text: 'label' } }} />)
    fireEvent.click(view.container.querySelector('[data-ocr-id="2"]')!)
    expect(view.props.onChange).toHaveBeenCalledTimes(1)
    expect(within(panel).getByRole('button', { name: '保存' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('默认查看全屏，拖动不进入绘制，也不要求范围即可测试', async () => {
    const { api, props } = setup()
    const element = await canvas()
    expect(element).toHaveAttribute('data-disabled', 'true')
    expect(screen.getByText('desktopWorkflow.ocr.scopeAll')).toBeVisible()
    expect(screen.queryByRole('group', { name: 'desktopWorkflow.selectionMode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.importTemplate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.undo' })).not.toBeInTheDocument()
    draw(element)
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.useRegion' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' }))
    await waitFor(() => expect(api.previewOCR).toHaveBeenCalledWith('preview', query, expect.any(AbortSignal)))
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('范围可绘制、取消和应用；确认前不修改步骤或允许测试旧范围', async () => {
    const view = setup()
    await canvas()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.selectScope' }))
    draw(await canvas())
    expect(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' })).toBeDisabled()
    expect(view.props.onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.cancelScope' }))
    expect(view.props.onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.selectScope' }))
    await canvas()
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.useRegion' })).not.toBeInTheDocument()
    draw(screen.getByRole('group', { name: 'desktopWorkflow.selection.canvas' }))
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.selection.useRegion' }))
    await waitFor(() => expect(view.props.onChange).toHaveBeenCalledOnce())
    const updated = view.props.onChange.mock.calls[0][1](reading) as Step
    expect(updated.ocr).toEqual({ ...query, region: { x: 100, y: 100, width: 201, height: 101 }, reference_width: 1000, reference_height: 500 })
    view.rerender(<ScreenshotEditor {...view.props} step={updated} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.ocr.editScope' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.selection.move' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' }))
    await waitFor(() => expect(view.api.previewOCR).toHaveBeenCalledWith('preview', updated.ocr, expect.any(AbortSignal)))
  })

  it('列表和覆盖层仅展示匹配结果，保留编号；清除范围同时清除旧结果', async () => {
    const configured: Step = { ...reading, ocr: { ...query, text: '保存', region: { x: 100, y: 100, width: 201, height: 101 }, reference_width: 1000, reference_height: 500 } }
    const view = setup(configured)
    await canvas()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' }))
    const panel = await screen.findByRole('region', { name: 'desktopWorkflow.ocr.preview' })
    // OCR 返回新帧后图片组件会重建，load 必须发送给新帧而不是旧截图。
    await waitFor(() => expect(screen.getByRole('img', { name: 'desktopWorkflow.readonlyScreen' })).toHaveAttribute('src', 'blob:ocr-2'))
    await canvas()
    expect(within(panel).getByRole('button', { name: '保存' })).toBeVisible()
    expect(screen.queryByText('范围外')).not.toBeInTheDocument()
    expect(screen.queryByText('范围内但文字不匹配')).not.toBeInTheDocument()
    expect([...view.container.querySelectorAll('[data-ocr-id]')].map(el => el.getAttribute('data-ocr-id'))).toEqual(['2'])
    expect(within(panel).getByText('2')).toBeVisible()
    expect(screen.getByRole('region', { name: 'desktopWorkflow.screen' })).toHaveAttribute('data-analysis', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.fullScreen' }))
    const updated = view.props.onChange.mock.calls[0][1](configured) as Step
    expect(updated.ocr).toEqual({ ...query, text: '保存', region: undefined, reference_width: undefined, reference_height: undefined })
    view.rerender(<ScreenshotEditor {...view.props} step={updated} />)
    expect(screen.queryByRole('region', { name: 'desktopWorkflow.ocr.preview' })).not.toBeInTheDocument()
    expect(view.container.querySelector('[data-ocr-id]')).toBeNull()
  })

  it('没有匹配时展示空结果，不回退为全图文字', async () => {
    const view = setup()
    const empty = result()
    empty.observation.matched_count = 0
    empty.observation.spans.forEach(span => { span.matched = false })
    vi.mocked(view.api.previewOCR).mockResolvedValue(empty)
    await canvas()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' }))
    expect(await screen.findByText('desktopWorkflow.ocr.emptyMatches')).toBeVisible()
    await canvas()
    expect(view.container.querySelector('[data-ocr-id]')).toBeNull()
    expect(screen.queryByText('保存')).not.toBeInTheDocument()
  })

  it('旧尺寸范围明确提示并阻止测试，恢复全屏后可以继续', async () => {
    const configured: Step = { ...reading, ocr: { ...query, region: { x: 0, y: 0, width: 100, height: 50 }, reference_width: 2000, reference_height: 1000 } }
    const view = setup(configured)
    await canvas()
    expect(screen.getByText('desktopWorkflow.ocr.staleScope')).toBeVisible()
    expect(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.fullScreen' }))
    const updated = view.props.onChange.mock.calls[0][1](configured) as Step
    view.rerender(<ScreenshotEditor {...view.props} step={updated} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.ocr.test' })).toBeEnabled()
  })

  it('切换步骤会退出未应用的框选，返回时仍使用该步骤已保存的范围', async () => {
    const view = setup()
    await canvas()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.ocr.selectScope' }))
    draw(await canvas())
    view.rerender(<ScreenshotEditor {...view.props} step={{ ...reading, id: 'other' }} />)
    view.rerender(<ScreenshotEditor {...view.props} />)
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'desktopWorkflow.ocr.cancelScope' })).not.toBeInTheDocument()
    expect(screen.getByText('desktopWorkflow.ocr.scopeAll')).toBeVisible()
    expect(view.props.onChange).not.toHaveBeenCalled()
  })
})
