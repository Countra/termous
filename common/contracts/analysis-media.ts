import type { AnalysisQuery, AnalysisRecordQuery, AnalysisSubmit } from './screen-analysis-records.ts'
import { analysisParameterBounds, validAnalysisNumber, type AnalysisNumberParameter } from './screen-analysis.ts'

export type AnalysisMediaRequest =
  | { operation: 'action-context'; id: string; preview: string }
  | { operation: 'submit'; input: AnalysisSubmit }
  | { operation: 'list'; query?: AnalysisRecordQuery }
  | { operation: 'storage' | 'clear' }
  | { operation: 'get' | 'cancel' | 'delete' | 'geometry' | 'diagnostics' | 'export'; id: string }
  | { operation: 'elements' | 'spans'; id: string; query?: AnalysisQuery }
  | { operation: 'element' | 'span'; id: string; item: number; offset?: number }
  | { operation: 'image'; id: string; image: 'original' | 'annotated' }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const fields = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 200
function query(value: unknown, history: boolean) {
  if (value === undefined) return true
  if (!object(value)) return false
  const strings = history ? ['q', 'state', 'source', 'after', 'before', 'cursor'] : ['q', 'kind', 'source', 'sort', 'cursor']
  const numbers = history ? ['limit'] : ['limit', 'element_id', 'detection_min', 'detection_max', 'text_min', 'text_max']
  return Object.entries(value).every(([key, item]) => item === undefined || strings.includes(key) && typeof item === 'string' && item.length <= 2048
    || numbers.includes(key) && typeof item === 'number' && Number.isFinite(item)
    || !history && key === 'bbox' && Array.isArray(item) && item.length === 4 && item.every(Number.isSafeInteger))
}
export function isAnalysisMediaRequest(value: unknown): value is AnalysisMediaRequest {
  if (!object(value)) return false
  switch (value.operation) {
    case 'action-context': return fields(value, ['operation', 'id', 'preview']) && id(value.id) && id(value.preview)
    case 'submit': {
      if (!fields(value, ['operation', 'input']) || !object(value.input)) return false
      const input = value.input
      if (!fields(input, ['request_id', 'source', 'parameters', 'reuse']) || !id(input.request_id) || !object(input.source)
        || !fields(input.source, ['kind', 'id']) || !id(input.source.id) || !['preview', 'analysis'].includes(String(input.source.kind))
        || input.reuse !== undefined && typeof input.reuse !== 'boolean') return false
      if (input.parameters === undefined) return true
      return input.source.kind === 'analysis' && object(input.parameters) && Object.entries(input.parameters).every(([key, item]) =>
        key === 'ocr_enabled' ? typeof item === 'boolean' : key in analysisParameterBounds && validAnalysisNumber(key as AnalysisNumberParameter, item))
    }
    case 'list': return fields(value, ['operation', 'query']) && query(value.query, true)
    case 'storage': case 'clear': return fields(value, ['operation'])
    case 'get': case 'cancel': case 'delete': case 'geometry': case 'diagnostics': case 'export': return fields(value, ['operation', 'id']) && id(value.id)
    case 'elements': case 'spans': return fields(value, ['operation', 'id', 'query']) && id(value.id) && query(value.query, false)
    case 'element': case 'span': return fields(value, ['operation', 'id', 'item', 'offset']) && id(value.id)
      && Number.isSafeInteger(value.item) && Number(value.item) >= 0 && Number(value.item) < 1300
      && (value.offset === undefined || Number.isSafeInteger(value.offset) && Number(value.offset) >= 0)
    case 'image': return fields(value, ['operation', 'id', 'image']) && id(value.id) && ['original', 'annotated'].includes(String(value.image))
    default: return false
  }
}
