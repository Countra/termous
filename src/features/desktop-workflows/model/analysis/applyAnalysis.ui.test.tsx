import { afterEach, expect, it, vi } from 'vitest'
import { prepareAnalysisApplication } from './applyAnalysis'
import { element, result, setup } from '../../ui/analysis/analysisTestFixture'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('拖动终点使用原图中心和原桌面尺寸，范围保持相交框语义', async () => {
  const { gateway, props } = setup()
  const drag = { ...props.step, kind: 'pointer.drag' as const, end_target: { kind: 'point' as const, x: 1, y: 2 } }
  const point = await prepareAnalysisApplication(gateway, result(), 'preview', element, drag, 'end_target', 'point', () => {})
  expect(point.step.target).toEqual(drag.target)
  expect(point.step.end_target).toMatchObject({ kind: 'point', x: 60, y: 40, reference_width: 800, reference_height: 400 })
  const range = await prepareAnalysisApplication(gateway, result(), 'preview', element, props.step, 'target', 'region', () => {})
  expect(range.step.target).toMatchObject({ kind: 'image', image: { region: { x: 10, y: 20, width: 100, height: 40 } } })
})

it('模板从分析原图裁剪，上传后再次复验；上传失败不返回草稿且释放解码对象', async () => {
  const { gateway, props } = setup()
  const close = vi.fn(); const drawImage = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['crop'], { type: 'image/png' })))
  vi.mocked(gateway.upload).mockRejectedValueOnce(new Error('upload failed')).mockResolvedValue({ id: 'template' } as never)
  await expect(prepareAnalysisApplication(gateway, result(), 'preview', element, props.step, 'target', 'template', () => {})).rejects.toThrow('upload failed')
  expect(close).toHaveBeenCalledOnce()
  expect(gateway.validateAnalysisAction).toHaveBeenCalledTimes(1)
  const value = await prepareAnalysisApplication(gateway, result(), 'preview', element, props.step, 'target', 'template', () => {})
  expect(value.step.target).toMatchObject({ kind: 'image', image: { asset_id: 'template', template_source: { region: { x: 10, y: 20, width: 100, height: 40 } } } })
  expect(drawImage).toHaveBeenLastCalledWith(expect.anything(), 10, 20, 100, 40, 0, 0, 100, 40)
  expect(gateway.validateAnalysisAction).toHaveBeenCalledTimes(3)
})

it('解码期间编辑上下文改变，拒绝上传并释放位图', async () => {
  const { gateway, props } = setup()
  let stale = false; const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockImplementation(async () => { stale = true; return { close } }))
  await expect(prepareAnalysisApplication(gateway, result(), 'preview', element, props.step, 'target', 'template', () => {
    if (stale) throw new Error('context changed')
  })).rejects.toThrow('context changed')
  expect(gateway.upload).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
})
