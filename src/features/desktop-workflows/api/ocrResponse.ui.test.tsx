import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OCRPreview } from '#entities/desktop-workflow'
import { decodeOCRPreview } from './ocrResponse'
import { WorkflowClient } from './WorkflowClient'

// Node 的 Response 使用原生 Blob；与 jsdom 的 DOM 控件隔离，实际解析 multipart 正文。
beforeAll(() => { vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile) })
afterAll(() => vi.unstubAllGlobals())

function payload(): Omit<OCRPreview, 'image'> {
  return {
    capture: { metadata: { width: 100, height: 80, desktop_width: 100, desktop_height: 80,
      connection_generation: 1, display_epoch: 1, frame_sequence: 1, captured_at: '2026-10-23T00:00:00Z',
      region: { x: 0, y: 0, width: 100, height: 80 } } },
    observation: { role: '', width: 100, height: 80, parameters: { text_confidence: .5, ocr_max_side: 1600 },
      recognized_count: 1, matched_count: 1, selected_ids: [], truncated: false, truncation_reasons: [],
      duration_ms: 20, device: 'cpu', fingerprint: 'a'.repeat(64),
      spans: [{ id: 0, text: '保存\nSave', confidence: .9, bbox_xyxy: [0, 0, 20, 10], center_xy: [9, 4], matched: true }] },
  }
}
const boundary = 'OCR-Test-Boundary'
const contentType = `multipart/form-data; boundary=${boundary}`
async function multipart(value: unknown) {
  const part = (name: string, type: string, body: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n${body}\r\n`
  return new Blob([part('result', 'application/json', JSON.stringify(value)), part('image', 'image/png', 'png'), `--${boundary}--\r\n`], { type: 'multipart/form-data' })
}

describe('OCR 预览 multipart 合同', () => {
  it('保留中文原文及像素框，支持合法空观察', async () => {
    const value = payload()
    const parts = await new Response(await multipart(value), { headers: { 'Content-Type': contentType } }).formData()
    expect(parts.get('result')).toBeInstanceOf(Blob)
    expect(parts.get('image')).toBeInstanceOf(Blob)
    const result = await decodeOCRPreview(await multipart(value), contentType)
    expect(result.observation).toEqual(value.observation)
    expect(result.image.type).toBe('image/png')
    value.observation.spans = []; value.observation.recognized_count = 0; value.observation.matched_count = 0
    expect((await decodeOCRPreview(await multipart(value), contentType)).observation.spans).toEqual([])
  })
  it('客户端保留原始响应头，即使 Blob 丢失 boundary 也能读取中文与图片', async () => {
    const body = await multipart(payload())
    const response = new Response(body, { headers: { 'Content-Type': contentType } })
    vi.spyOn(response, 'blob').mockResolvedValue(body)
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    try {
      const result = await new WorkflowClient().previewOCR('preview', { text_confidence: .5, ocr_max_side: 1600 })
      expect(result.observation.spans[0].text).toBe('保存\nSave')
      expect(result.image.type).toBe('image/png')
      expect(fetcher).toHaveBeenCalledOnce()
    } finally { fetcher.mockRestore() }
  })
  it.each(['', 'multipart/form-data', 'multipart/form-data; boundary=wrong', 'application/json'])(
    '拒绝缺失或不匹配的原始 Content-Type：%s', async header => {
      await expect(decodeOCRPreview(await multipart(payload()), header)).rejects.toMatchObject({ code: 'desktop_invalid_response' })
    },
  )
  it.each([
    ['缺少耗时', (v: ReturnType<typeof payload>) => { Reflect.deleteProperty(v.observation, 'duration_ms') }],
    ['统计不一致', (v: ReturnType<typeof payload>) => { v.observation.matched_count = 0 }],
    ['编号不连续', (v: ReturnType<typeof payload>) => { v.observation.spans[0].id = 1 }],
    ['无匹配却选中', (v: ReturnType<typeof payload>) => { v.observation.selected_ids = [0] }],
    ['尺寸不一致', (v: ReturnType<typeof payload>) => { v.capture.metadata.desktop_width = 200 }],
    ['中心越界', (v: ReturnType<typeof payload>) => { v.observation.spans[0].center_xy = [20, 4] }],
    ['推理参数非法', (v: ReturnType<typeof payload>) => { v.observation.parameters.ocr_max_side = 641 }],
    ['截断不一致', (v: ReturnType<typeof payload>) => { v.observation.truncated = true }],
  ])('拒绝%s', async (_name, mutate) => {
    const value = payload(); mutate(value)
    await expect(decodeOCRPreview(await multipart(value), contentType)).rejects.toMatchObject({ code: 'desktop_invalid_response' })
  })
  it('损坏 JSON 和空正文返回明确协议错误', async () => {
    await expect(decodeOCRPreview(await multipart(null), contentType)).rejects.toMatchObject({ code: 'desktop_invalid_response' })
    await expect(decodeOCRPreview(new Blob(['broken']), contentType)).rejects.toMatchObject({ code: 'desktop_invalid_response' })
  })
})
