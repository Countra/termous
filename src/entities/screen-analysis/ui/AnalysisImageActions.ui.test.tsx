import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { screenAnalysisDefaults, type AnalysisGateway, type AnalysisRecord, type AnalysisRenderedImage } from '#common/contracts'
import { AnalysisImageActions } from './AnalysisImageActions'

afterEach(() => vi.restoreAllMocks())
const record = { id: 'analysis', parameters: screenAnalysisDefaults, image: { width: 800, height: 600, coordinate_space: 'original_pixels' } } as AnalysisRecord
const result = (): AnalysisRenderedImage => ({ blob: new Blob(['image'], { type: 'image/png' }), metadata: { analysis_id: 'analysis', layer: 'ocr',
  original: record.image!, crop: [0, 0, 800, 600], width: 800, height: 600, matched_count: 4, drawn_count: 4, limited_by_inference: false } })

test('显式生成全部筛选结果，不发送分页参数，关闭弹窗释放图片', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:filtered')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const renderAnalysisImage = vi.fn().mockResolvedValue(result())
  render(<AnalysisImageActions record={record} gateway={{ renderAnalysisImage } as unknown as AnalysisGateway}
    query={{ text_gt: .5, limit: 20, cursor: 'next', sort: 'confidence_desc' }} layer="ocr" active />)
  fireEvent.click(screen.getByText('analysisCenter.image.open'))
  expect(renderAnalysisImage).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('analysisCenter.image.generate'))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect(renderAnalysisImage).toHaveBeenCalledWith('analysis', { text_gt: .5, layer: 'ocr' }, expect.any(AbortSignal))
  expect(screen.getByAltText('analysisCenter.image.title')).toHaveAttribute('src', 'blob:filtered')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:filtered'))
})

test('非法裁剪不请求，关闭后迟到响应不能显示或导出', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late')
  let finish!: (value: AnalysisRenderedImage) => void
  const renderAnalysisImage = vi.fn(() => new Promise<AnalysisRenderedImage>(resolve => { finish = resolve }))
  const view = render(<AnalysisImageActions record={record} gateway={{ renderAnalysisImage } as unknown as AnalysisGateway} query={{}} layer="elements" active />)
  fireEvent.click(screen.getByText('analysisCenter.image.open'))
  const crop = screen.getByRole('textbox', { name: 'analysisCenter.image.crop' })
  fireEvent.change(crop, { target: { value: '0,0,801,600' } })
  fireEvent.click(screen.getByText('analysisCenter.image.generate'))
  expect(renderAnalysisImage).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('analysisCenter.image.invalidCrop')
  fireEvent.change(crop, { target: { value: '0,0,400,300' } })
  fireEvent.click(screen.getByText('analysisCenter.image.generate'))
  await waitFor(() => expect(renderAnalysisImage).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => finish(result()))
  expect(create).not.toHaveBeenCalled()
})

test('筛选切换后旧请求不能覆盖新预览，低阈值提示使用现有文案', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  let finish!: (value: AnalysisRenderedImage) => void
  const renderAnalysisImage = vi.fn()
    .mockImplementationOnce(() => new Promise<AnalysisRenderedImage>(resolve => { finish = resolve }))
    .mockResolvedValueOnce({ ...result(), metadata: { ...result().metadata, limited_by_inference: true } })
  const gateway = { renderAnalysisImage } as unknown as AnalysisGateway
  const view = render(<AnalysisImageActions record={record} gateway={gateway} query={{ text_min: .8 }} layer="ocr" active />)
  fireEvent.click(screen.getByText('analysisCenter.image.open'))
  fireEvent.click(screen.getByText('analysisCenter.image.generate'))
  view.rerender(<AnalysisImageActions record={record} gateway={gateway} query={{ text_max: .4 }} layer="ocr" active />)
  fireEvent.click(screen.getByText('analysisCenter.image.generate'))
  await waitFor(() => expect(create).toHaveBeenCalledOnce())
  expect(screen.getByRole('alert')).toHaveTextContent('analysisCenter.inferenceLimited')
  await act(async () => finish(result()))
  expect(create).toHaveBeenCalledOnce()
  expect(screen.getByAltText('analysisCenter.image.title')).toHaveAttribute('src', 'blob:current')
})
