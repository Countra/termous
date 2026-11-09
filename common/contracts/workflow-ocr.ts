export interface WorkflowOCRParameters { text_confidence: number; ocr_max_side: number }
export interface WorkflowOCRQuery extends WorkflowOCRParameters {
  text?: string
  match?: 'exact' | 'contains' | 'regex'
  case_sensitive?: boolean
  normalize_whitespace?: boolean
  region?: { x: number; y: number; width: number; height: number }
  reference_width?: number
  reference_height?: number
}

export function isWorkflowOCRQuery(value: unknown): value is WorkflowOCRQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if (Object.keys(v).some(key => !['text', 'match', 'case_sensitive', 'normalize_whitespace', 'text_confidence', 'ocr_max_side', 'region', 'reference_width', 'reference_height'].includes(key))) return false
  if (typeof v.text_confidence !== 'number' || !Number.isFinite(v.text_confidence) || v.text_confidence < 0 || v.text_confidence > 1) return false
  if (!Number.isInteger(v.ocr_max_side) || Number(v.ocr_max_side) < 640 || Number(v.ocr_max_side) > 1920 || Number(v.ocr_max_side) % 32 !== 0) return false
  if (v.text !== undefined && (typeof v.text !== 'string' || [...v.text].length > 1024)) return false
  if (v.match !== undefined && !['exact', 'contains', 'regex'].includes(String(v.match))) return false
  if (['case_sensitive', 'normalize_whitespace'].some(key => v[key] !== undefined && typeof v[key] !== 'boolean')) return false
  if (['reference_width', 'reference_height'].some(key => v[key] !== undefined && (!Number.isSafeInteger(v[key]) || Number(v[key]) < 0 || Number(v[key]) > 4294967295))) return false
  if (v.region !== undefined) {
    if (!v.region || typeof v.region !== 'object' || Array.isArray(v.region)) return false
    const r = v.region as Record<string, unknown>
    if (Object.keys(r).length !== 4 || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(r[key]) && Number(r[key]) >= (key === 'x' || key === 'y' ? 0 : 1))) return false
    if (![v.reference_width, v.reference_height].every(n => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= 16384)) return false
    if (Number(r.x) + Number(r.width) > Number(v.reference_width) || Number(r.y) + Number(r.height) > Number(v.reference_height)) return false
  }
  return true
}
