import { afterEach, expect, test, vi } from 'vitest'
import { ScreenAnalysisClient } from './client'
import { analysisRemoteGateway, handleAnalysisMedia } from './bridge'
import type { AnalysisGateway, AnalysisText } from '#common/contracts'

afterEach(() => vi.unstubAllGlobals())

test.each(['get', 'list', 'cancel'] as const)('%s 拒绝旧版分析记录', async operation => {
  const record = { id: 'analysis', schema_version: 1 }
  const body = operation === 'list' ? { items: [record], total: 1 } : record
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
  const client = new ScreenAnalysisClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: '' })
  const request = operation === 'get' ? client.getAnalysis('analysis')
    : operation === 'list' ? client.listAnalyses() : client.cancelAnalysis('analysis')
  await expect(request).rejects.toMatchObject({ code: 'analysis_version_mismatch' })
})

test('完整读取显式请求 full，筛选图片保留坐标元数据并可跨窗口转发', async () => {
  const metadata = { analysis_id: 'analysis', layer: 'ocr', original: { width: 800, height: 600, coordinate_space: 'original_pixels' },
    crop: [100, 100, 500, 300], width: 400, height: 200, matched_count: 3, drawn_count: 2, limited_by_inference: false }
  const fetch = vi.fn(async (url: URL) => url.pathname.endsWith('/annotated')
    ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png', 'X-Termous-Analysis-Image': JSON.stringify(metadata) } })
    : Response.json({ id: 'analysis', schema_version: 2, result: { schema_version: 2 }, inference_identity: { fingerprint: 'test' } }))
  vi.stubGlobal('fetch', fetch)
  const client = new ScreenAnalysisClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: '' })
  await client.analysisFull('analysis')
  expect(fetch.mock.calls[0][0].searchParams.get('response_detail')).toBe('full')
  const remote = analysisRemoteGateway(request => handleAnalysisMedia(client, request))
  const result = await remote.renderAnalysisImage('analysis', { layer: 'ocr', text_gt: .5, element_ids: [2, 3] })
  expect(result.metadata).toEqual(metadata)
  expect(result.blob.size).toBe(3)
  const url = fetch.mock.calls[1][0]
  expect(url.searchParams.get('text_gt')).toBe('0.5')
  expect(url.searchParams.get('element_ids')).toBe('2,3')
  expect(url.searchParams.has('limit')).toBe(false)
})

test('图片元数据缺失、所属记录不一致或坐标越界明确失败', async () => {
  const client = new ScreenAnalysisClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: '' })
  for (const value of [undefined, { analysis_id: 'other' }, { analysis_id: 'analysis', layer: 'ocr', original: { width: 10, height: 10 } }]) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { headers: value ? { 'X-Termous-Analysis-Image': JSON.stringify(value) } : {} })))
    await expect(client.renderAnalysisImage('analysis', {})).rejects.toMatchObject({ code: 'analysis_invalid_response' })
  }
})

test('独立窗口转发 full 不调用提交接口', async () => {
  const span: AnalysisText = { element_id: 9, text: 'Save', text_confidence: .9,
    bbox_xyxy: [100, 200, 260, 240], center_xy: [179, 219], polygon_xy: [[100, 200], [260, 200], [260, 240], [100, 240]] }
  const full = { id: 'analysis', schema_version: 2, result: { diagnostics: { ocr_spans: [span] } } }
  const gateway = { analysisFull: vi.fn().mockResolvedValue(full), submitAnalysis: vi.fn() } as unknown as AnalysisGateway
  const remote = analysisRemoteGateway(request => handleAnalysisMedia(gateway, request))
  const received = await remote.analysisFull('analysis')
  expect(received).toBe(full)
  expect(received.result.diagnostics.ocr_spans[0].center_xy).toEqual([179, 219])
  expect(gateway.submitAnalysis).not.toHaveBeenCalled()
})
