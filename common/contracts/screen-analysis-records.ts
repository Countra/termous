import type { ScreenAnalysisParameters } from './screen-analysis.ts'

export interface AnalysisElement {
  id: number; kind: 'region' | 'text'; source: 'detector' | 'detector+ocr' | 'ocr'
  bbox_xyxy: [number, number, number, number]; center_xy: [number, number]
  detection_confidence?: number; text_confidence?: number; text: string
}
export interface AnalysisText {
  element_id: number; text: string; text_confidence: number
  bbox_xyxy: [number, number, number, number]; center_xy: [number, number]; polygon_xy: [number, number][]
}
export interface AnalysisSummary {
  element_count: number; region_count: number; text_count: number; ocr_span_count: number
  truncated: boolean; truncation_reasons: ('detection_limit' | 'ocr_candidate_limit' | 'ocr_text_limit')[]
}
export interface AnalysisDiagnostics {
  device: string; models: { detector: string; ocr_detection: string; ocr_recognition: string }
  parameters: ScreenAnalysisParameters
  timings_ms: { detection: number; ocr: number; association: number; annotation: number; total: number }
  ocr_spans: AnalysisText[] | null
}
export interface AnalysisResult {
  schema_version: 2; image: AnalysisImage; summary: AnalysisSummary; elements: AnalysisElement[]
  diagnostics: AnalysisDiagnostics & { ocr_spans: AnalysisText[] }
}
export interface AnalysisImage { width: number; height: number; coordinate_space: 'original_pixels' }
export type AnalysisState = 'preparing' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'interrupted'
export interface AnalysisSnapshotMetadata {
  region: { x: number; y: number; width: number; height: number }
  width: number; height: number; desktop_width: number; desktop_height: number
  connection_generation: number; execution_generation: number; display_epoch: number; frame_sequence: number; captured_at: string
}
export interface AnalysisRecord {
  id: string; state: AnalysisState; stage: string; source: { kind: 'preview' | 'analysis' | 'attachment'; id: string; name?: string }
  creator: { origin: 'local' | 'mcp' | 'agent'; client_id?: string; name?: string }
  parameters: ScreenAnalysisParameters; parameter_source: 'settings' | 'request_override' | 'reanalysis'; settings_revision?: number
  session_id?: string; metadata?: AnalysisSnapshotMetadata; sha256?: string; image?: AnalysisImage
  created_at: string; finished_at?: string; expires_at: string; action_expires_at?: string; error?: string
  reused: boolean; reuse_allowed: boolean; duration_ms: number; inference_ms: number; computed_at?: string
  summary?: AnalysisSummary; confidence_distribution?: { detection: number[]; ocr: number[] }; schema_version: 2
  images?: { original?: string; annotated?: string }
}
export interface AnalysisFullRecord extends AnalysisRecord { result: AnalysisResult; inference_identity: AnalysisIdentity }
export interface AnalysisSubmit {
  request_id: string; source: { kind: 'preview' | 'analysis'; id: string }; parameters?: Partial<ScreenAnalysisParameters>; reuse?: boolean
}
export interface AnalysisQuery {
  q?: string; kind?: 'region' | 'text'; source?: AnalysisElement['source']; detection_min?: number; detection_max?: number
  text_min?: number; text_max?: number; bbox?: [number, number, number, number]; element_id?: number
  detection_gt?: number; detection_lt?: number; text_gt?: number; text_lt?: number; element_ids?: number[]; span_ids?: number[]
  sort?: 'spatial' | 'confidence_asc' | 'confidence_desc'; limit?: number; cursor?: string
}
export type AnalysisLabelMode = 'auto' | 'all' | 'none'
export interface AnalysisImageQuery extends Omit<AnalysisQuery, 'sort' | 'limit' | 'cursor'> {
  layer?: 'elements' | 'ocr'; crop?: [number, number, number, number]; max_side?: number
  label_mode?: AnalysisLabelMode
}
export interface AnalysisImageMetadata {
  analysis_id: string; layer: 'elements' | 'ocr'; original: AnalysisImage; crop: [number, number, number, number]
  width: number; height: number; matched_count: number; drawn_count: number; limited_by_inference: boolean
  label_mode?: AnalysisLabelMode; labeled_count?: number; unlabeled_count?: number
}
export interface AnalysisRenderedImage { blob: Blob; metadata: AnalysisImageMetadata }
export interface AnalysisRecordQuery {
  q?: string; state?: AnalysisState; source?: 'preview' | 'analysis' | 'attachment'; after?: string; before?: string; limit?: number; cursor?: string
}
export interface AnalysisPage<T> { items: T[]; total: number; next_cursor?: string; limited_by_inference: boolean }
export interface AnalysisTextPart { text: string; text_offset: number; text_next_offset?: number; text_length: number; text_truncated: boolean }
export interface AnalysisElementView extends AnalysisElement, AnalysisTextPart { matched_ocr_spans: number }
export interface AnalysisSpanView extends AnalysisTextPart {
  id: number; element_id: number; text_confidence: number; bbox_xyxy: [number, number, number, number]; center_xy: [number, number]; polygon_xy?: [number, number][]
}
export type AnalysisGeometry = Pick<AnalysisElement, 'id' | 'kind' | 'bbox_xyxy' | 'center_xy'>
  & { element_id?: number }
export type AnalysisLayer = 'elements' | 'ocr'
export const analysisPanelLimits = {
  history: { min: 220, max: 380, default: 252 },
  results: { min: 300, max: 520, default: 348 },
} as const
export interface AnalysisPanelPreferences { historyWidth: number; resultsWidth: number }
export type AnalysisGeometryQuery = Omit<AnalysisQuery, 'sort' | 'cursor' | 'limit'> & { layer?: AnalysisLayer }
export interface AnalysisPresentation {
  open: boolean; id?: string; layer: AnalysisLayer; filter: AnalysisQuery; selected?: number; history: boolean
  view?: { zoom: number | 'fit'; boxes: boolean; labelMode?: AnalysisLabelMode }
  panels?: AnalysisPanelPreferences; resultsVisible?: boolean
}
export interface AnalysisIdentity {
  instance_id: string; fingerprint: string; implementation: string; models: string; runtime: { [library: string]: string }
  device: string; precision: string; schema_version: 2
}
export interface AnalysisDiagnosticView { diagnostics: AnalysisDiagnostics; identity: AnalysisIdentity; computed_at: string }
export interface AnalysisStorageSettings { max_bytes: number; max_records: number; retention_days: number }
export interface AnalysisStorageUsage {
  records: number; content_bytes: number; pending_bytes: number; database_bytes: number; wal_bytes: number; free_page_bytes: number
  policy: AnalysisStorageSettings; cleanup_error?: string
}
export interface AnalysisGateway {
  validateAnalysisAction(id: string, preview: string, signal?: AbortSignal): Promise<void>
  submitAnalysis(input: AnalysisSubmit, signal?: AbortSignal): Promise<AnalysisRecord>
  getAnalysis(id: string, signal?: AbortSignal): Promise<AnalysisRecord>
  analysisFull(id: string, signal?: AbortSignal): Promise<AnalysisFullRecord>
  renderAnalysisImage(id: string, query: AnalysisImageQuery, signal?: AbortSignal): Promise<AnalysisRenderedImage>
  listAnalyses(query?: AnalysisRecordQuery, signal?: AbortSignal): Promise<AnalysisPage<AnalysisRecord>>
  cancelAnalysis(id: string): Promise<AnalysisRecord>
  deleteAnalysis(id: string): Promise<void>
  clearAnalyses(): Promise<void>
  analysisElements(id: string, query?: AnalysisQuery, signal?: AbortSignal): Promise<AnalysisPage<AnalysisElementView>>
  analysisElement(id: string, element: number, offset?: number, signal?: AbortSignal): Promise<AnalysisElementView>
  analysisSpans(id: string, query?: AnalysisQuery, signal?: AbortSignal): Promise<AnalysisPage<AnalysisSpanView>>
  analysisSpan(id: string, span: number, offset?: number, signal?: AbortSignal): Promise<AnalysisSpanView>
  analysisGeometry(id: string, signal?: AbortSignal, query?: AnalysisGeometryQuery): Promise<AnalysisGeometry[]>
  analysisDiagnostics(id: string, signal?: AbortSignal): Promise<AnalysisDiagnosticView>
  analysisImage(id: string, kind: 'original' | 'annotated', signal?: AbortSignal): Promise<Blob>
  exportAnalysis(id: string, signal?: AbortSignal): Promise<Blob>
  analysisStorage(signal?: AbortSignal): Promise<AnalysisStorageUsage>
}
