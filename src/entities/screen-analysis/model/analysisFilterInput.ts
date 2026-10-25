import type { AnalysisQuery } from '#common/contracts'

// 旧窗口偏好可能包含严格边界和上限；界面统一为可见的最低值，避免隐藏条件继续筛选。
export function analysisMinimumFilter(value: AnalysisQuery): AnalysisQuery {
  const result = { ...value }
  if (result.detection_min === undefined && result.detection_gt !== undefined) result.detection_min = result.detection_gt
  if (result.text_min === undefined && result.text_gt !== undefined) result.text_min = result.text_gt
  delete result.detection_gt; delete result.detection_lt; delete result.detection_max
  delete result.text_gt; delete result.text_lt; delete result.text_max
  return result
}

// 中间输入可以暂时不完整；仅将有效条件发送给查询，保留上一次有效结果。
export function parseAnalysisFilter(draft: AnalysisQuery, box: string, ids: string, ocr: boolean): AnalysisQuery | undefined {
  const bounds = box.trim() ? box.split(',').map(Number) : undefined
  const numbers = ids.trim() ? ids.split(',').map(Number) : undefined
  const validBox = !bounds || box.split(',').every(s => s.trim()) && bounds.length === 4 && bounds.every(Number.isSafeInteger) && bounds[0] >= 0 && bounds[1] >= 0 && bounds[2] > bounds[0] && bounds[3] > bounds[1]
  const validIDs = !numbers || ids.split(',').every(s => s.trim()) && numbers.length <= (ocr ? 1000 : 1300) && new Set(numbers).size === numbers.length && numbers.every(n => Number.isSafeInteger(n) && n >= 0 && n < (ocr ? 1000 : 1300))
  const normalized = analysisMinimumFilter(draft)
  const validScores = [normalized.detection_min, normalized.text_min].every(n => n === undefined || Number.isFinite(n) && n >= 0 && n <= 1)
  if (!validBox || !validIDs || !validScores) return undefined
  const result: AnalysisQuery = { ...normalized, bbox: bounds as AnalysisQuery['bbox'], [ocr ? 'span_ids' : 'element_ids']: numbers }
  delete result.cursor; delete result.limit
  return result
}
