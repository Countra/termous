export interface ScreenAnalysisParameters {
  confidence: number
  image_size: number
  ocr_enabled: boolean
  text_confidence: number
  nms_iou: number
  max_detections: number
  ocr_max_side: number
}

export const screenAnalysisDefaults: Readonly<ScreenAnalysisParameters> = Object.freeze({
  confidence: 0.05, image_size: 1280, ocr_enabled: true, text_confidence: 0.5,
  nms_iou: 0.45, max_detections: 300, ocr_max_side: 1600,
})
export type AnalysisNumberParameter = Exclude<keyof ScreenAnalysisParameters, 'ocr_enabled'>
export const analysisParameterBounds = {
  confidence: { min: 0, max: 1, step: 0.01 },
  image_size: { min: 320, max: 1920, step: 32 },
  text_confidence: { min: 0, max: 1, step: 0.01 },
  nms_iou: { min: 0, max: 1, step: 0.01 },
  max_detections: { min: 1, max: 300, step: 1 },
  ocr_max_side: { min: 640, max: 1920, step: 32 },
} as const

export function validAnalysisNumber(key: AnalysisNumberParameter, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const bounds = analysisParameterBounds[key]
  if (value < bounds.min || value > bounds.max || key === 'confidence' && value === 0) return false
  if (key === 'image_size' || key === 'ocr_max_side') return Number.isInteger(value) && value % 32 === 0
  return key !== 'max_detections' || Number.isInteger(value)
}
export function isScreenAnalysisParameters(value: unknown): value is ScreenAnalysisParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const fields = value as Record<string, unknown>
  return Object.keys(fields).length === 7 && typeof fields.ocr_enabled === 'boolean'
    && (Object.keys(analysisParameterBounds) as AnalysisNumberParameter[]).every(key => validAnalysisNumber(key, fields[key]))
}
