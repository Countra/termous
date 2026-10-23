import type { OCRPreview } from '#entities/desktop-workflow'
import { isWorkflowOCRQuery } from '#common/contracts'
import { TermousApiError } from '#shared/api'

export async function decodeOCRPreview(blob: Blob, contentType: string): Promise<OCRPreview> {
  const invalid = () => new TermousApiError('文字观察响应无效', 'desktop_invalid_response', 0)
  if (contentType.split(';', 1)[0].trim().toLowerCase() !== 'multipart/form-data' || blob.size > 36 * 1024 * 1024) throw invalid()
  let image: Blob; let result: Omit<OCRPreview, 'image'>
  try {
    // Chromium 的 Response.blob() 可能丢弃 MIME 参数；分隔符必须取自原始响应头。
    const form = await new Response(blob, { headers: { 'Content-Type': contentType } }).formData()
    const json = form.get('result'); const png = form.get('image')
    if (form.getAll('result').length !== 1 || form.getAll('image').length !== 1 || !(json instanceof Blob) || json.type !== 'application/json' || json.size > 2 * 1024 * 1024 || !(png instanceof Blob) || png.type !== 'image/png' || !png.size || png.size > 32 * 1024 * 1024) throw invalid()
    result = JSON.parse(await json.text()) as Omit<OCRPreview, 'image'>
    image = png
  } catch { throw invalid() }
  const meta = result?.capture?.metadata; const observation = result?.observation
  if (!meta || ![meta.width, meta.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384) || meta.width * meta.height > 16 * 1024 * 1024 || meta.desktop_width !== meta.width || meta.desktop_height !== meta.height || meta.region?.x !== 0 || meta.region.y !== 0 || meta.region.width !== meta.width || meta.region.height !== meta.height || ![meta.connection_generation, meta.display_epoch, meta.frame_sequence].every(n => Number.isSafeInteger(n) && n > 0) || typeof meta.captured_at !== 'string' || !Number.isFinite(Date.parse(meta.captured_at))) throw invalid()
  if (!observation || observation.width !== meta.width || observation.height !== meta.height || !Array.isArray(observation.spans) || observation.spans.length > 1000 || observation.recognized_count !== observation.spans.length || !Number.isInteger(observation.matched_count) || observation.matched_count < 0 || observation.matched_count > observation.recognized_count || !Number.isFinite(observation.duration_ms) || observation.duration_ms < 0 || !isWorkflowOCRQuery(observation.parameters)) throw invalid()
  if (typeof observation.truncated !== 'boolean' || !Array.isArray(observation.truncation_reasons) || observation.truncation_reasons.some(reason => !['ocr_candidate_limit', 'ocr_text_limit'].includes(reason)) || observation.truncated !== (observation.truncation_reasons.length > 0) || typeof observation.device !== 'string' || !['cpu', 'cuda', 'mps'].includes(observation.device) || typeof observation.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(observation.fingerprint) || !Array.isArray(observation.selected_ids)) throw invalid()
  const selected = new Set(observation.selected_ids)
  if (selected.size !== observation.selected_ids.length || observation.selected_ids.some(id => !Number.isInteger(id) || id < 0 || id >= observation.recognized_count)) throw invalid()
  let matched = 0
  for (const [index, s] of observation.spans.entries()) {
    if (!s || s.id !== index || typeof s.text !== 'string' || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1 || !Array.isArray(s.bbox_xyxy) || s.bbox_xyxy.length !== 4 || !s.bbox_xyxy.every(Number.isInteger) || !Array.isArray(s.center_xy) || s.center_xy.length !== 2 || !s.center_xy.every(Number.isInteger) || typeof s.matched !== 'boolean' || s.selected !== undefined && typeof s.selected !== 'boolean' || Boolean(s.selected) !== selected.has(s.id) || s.selected && !s.matched) throw invalid()
    const [x1,y1,x2,y2] = s.bbox_xyxy
    if (x1 < 0 || y1 < 0 || x2 > meta.width || y2 > meta.height || x1 >= x2 || y1 >= y2 || s.center_xy[0] < x1 || s.center_xy[0] >= x2 || s.center_xy[1] < y1 || s.center_xy[1] >= y2) throw invalid()
    if (s.matched) matched++
  }
  if (matched !== observation.matched_count) throw invalid()
  return { ...result, image }
}
