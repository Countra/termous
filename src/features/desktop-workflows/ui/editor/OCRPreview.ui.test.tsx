import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import type { OCRPreview, OCRQuery } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway } from '../../model/workspace/types'
import { OCRPreviewPanel } from './OCRPreviewPanel'
import { OCRFields } from './OCRFields'
import { useOCRPreview } from './useOCRPreview'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const query: OCRQuery = { text: '保存', text_confidence: .5, ocr_max_side: 1600 }
const preview: OCRPreview = {
  capture: { metadata: { width: 100, height: 100, desktop_width: 100, desktop_height: 100, connection_generation: 1, display_epoch: 1, frame_sequence: 1, region: { x: 0, y: 0, width: 100, height: 100 }, captured_at: '' } },
  image: new Blob(['png']),
  observation: { role: 'condition', width: 100, height: 100, parameters: query, recognized_count: 1, matched_count: 1,
    selected_ids: [], truncated: false, truncation_reasons: [], duration_ms: 20, device: 'cpu', fingerprint: '',
    spans: [{ id: 0, text: '保存\nSave', confidence: .9, bbox_xyxy: [0, 0, 20, 10], center_xy: [10, 5], matched: true }] },
}
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>

describe('OCR 编辑观察生命周期', () => {
  it('选中其他分页的文字框时跳到对应列表页，仍允许手动翻页', () => {
    const spans = Array.from({ length: 41 }, (_, id) => ({ ...preview.observation.spans[0], id, text: `结果 ${id}` }))
    const observation = { ...preview.observation, spans }
    const select = vi.fn()
    const view = render(<OCRPreviewPanel observation={observation} spans={spans} onSelect={select} />, { wrapper })
    expect(screen.queryByRole('button', { name: '结果 40' })).not.toBeInTheDocument()
    view.rerender(<OCRPreviewPanel observation={observation} spans={spans} selected={40} onSelect={select} />)
    expect(screen.getByRole('button', { name: '结果 40' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTitle('Previous Page'))
    expect(screen.getByRole('button', { name: '结果 20' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '结果 40' })).not.toBeInTheDocument()
    view.rerender(<OCRPreviewPanel observation={observation} spans={spans} selected={0} onSelect={select} />)
    expect(screen.getByRole('button', { name: '结果 0' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('选择保留仅适用于当前上下文的正文填入，重新测试替换观察', async () => {
    const request = vi.fn().mockResolvedValue(preview)
    const gateway = { previewOCR: request } as unknown as WorkflowMediaGateway
    const snapshot = vi.fn()
    const view = renderHook(({ value, context }) => useOCRPreview(gateway, 'preview', context, value, snapshot), { initialProps: { value: query, context: 'step' } })
    await act(() => view.result.current.test(new AbortController().signal))
    act(() => view.result.current.retainText('Save'))
    view.rerender({ value: { ...query, text: 'Save' }, context: 'step' })
    expect(view.result.current.value).toBe(preview)
    const next = { ...preview, observation: { ...preview.observation, spans: [] } }
    request.mockResolvedValue(next)
    await act(() => view.result.current.test(new AbortController().signal))
    expect(view.result.current.value).toBe(next)
    act(() => view.result.current.retainText('Save'))
    view.rerender({ value: { ...query, text: 'Save' }, context: 'other-step' })
    expect(view.result.current.value).toBeUndefined()
  })

  it('条件变化取消旧请求，迟到的画面不能覆盖新条件', async () => {
    let finish!: (value: OCRPreview) => void
    const request = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const gateway = { previewOCR: request } as unknown as WorkflowMediaGateway
    const snapshot = vi.fn()
    const view = renderHook(({ value }) => useOCRPreview(gateway, 'preview', 'step', value, snapshot), { initialProps: { value: query } })
    let pending!: Promise<void>
    act(() => { pending = view.result.current.test(new AbortController().signal) })
    const signal = request.mock.calls[0][2] as AbortSignal
    view.rerender({ value: { ...query, text: '取消' } })
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(preview); await pending })
    expect(snapshot).not.toHaveBeenCalled()
    expect(view.result.current.value).toBeUndefined()
  })

  it('卸载取消观察；选中文字只返回原始文字框，不派发输入', () => {
    const select = vi.fn()
    render(<OCRPreviewPanel observation={preview.observation} spans={preview.observation.spans} onSelect={select} />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: /保存\s+Save/ }))
    expect(select).toHaveBeenCalledExactlyOnceWith(preview.observation.spans[0])
    const request = vi.fn().mockImplementation(() => new Promise(() => {}))
    const gateway = { previewOCR: request } as unknown as WorkflowMediaGateway
    const view = renderHook(() => useOCRPreview(gateway, 'preview', 'step', query, vi.fn()))
    act(() => { void view.result.current.test(new AbortController().signal) })
    view.unmount()
    expect((request.mock.calls[0][2] as AbortSignal).aborted).toBe(true)
  })

  it('绑定正文禁用字面输入，清除范围不改变固定推理参数', () => {
    const change = vi.fn()
    render(<OCRFields value={{ ...query, region: { x: 0, y: 0, width: 20, height: 10 }, reference_width: 100, reference_height: 100 }} bound change={change} />, { wrapper })
    expect(screen.getByRole('textbox')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.fullScreen' }))
    expect(change).toHaveBeenCalledWith({ ...query, region: undefined, reference_width: undefined, reference_height: undefined })
  })
})
