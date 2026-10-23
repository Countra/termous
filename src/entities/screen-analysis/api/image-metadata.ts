import { TermousApiError } from '#shared/api'
import type { AnalysisImageMetadata } from '#common/contracts'

export function parseAnalysisImageMetadata(raw: string | null, id: string): AnalysisImageMetadata {
  const invalid = () => new TermousApiError('画面分析图片元数据无效', 'analysis_invalid_response', 502)
  if (!raw || raw.length > 2048) throw invalid()
  let value: AnalysisImageMetadata
  try { value = JSON.parse(raw) as AnalysisImageMetadata } catch { throw invalid() }
  if (!value || value.analysis_id !== id || !['elements', 'ocr'].includes(value.layer) || !value.original
    || value.original.coordinate_space !== 'original_pixels' || typeof value.limited_by_inference !== 'boolean'
    || ![value.width, value.height, value.original.width, value.original.height].every(n => Number.isSafeInteger(n) && n > 0)
    || value.original.width * value.original.height > 16 * 1024 * 1024
    || ![value.matched_count, value.drawn_count].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1300)
    || value.drawn_count > value.matched_count || !Array.isArray(value.crop) || value.crop.length !== 4 || !value.crop.every(Number.isSafeInteger)) throw invalid()
  const [x1, y1, x2, y2] = value.crop
  if (x1 < 0 || y1 < 0 || x2 <= x1 || y2 <= y1 || x2 > value.original.width || y2 > value.original.height
    || value.width > x2 - x1 || value.height > y2 - y1) throw invalid()
  return value
}
