import { vi } from 'vitest'
import type { Step } from '#entities/desktop-workflow'
import { screenAnalysisDefaults, type AnalysisRecord, type AnalysisElementView } from '#common/contracts'
import type { WorkflowMediaGateway } from '../../model/workspace/types'

const metadata = { width: 800, height: 400, desktop_width: 800, desktop_height: 400, connection_generation: 1, execution_generation: 1, display_epoch: 1, frame_sequence: 1, captured_at: '', region: { x: 0, y: 0, width: 800, height: 400 } }
export const element: AnalysisElementView = { id: 0, kind: 'region', source: 'detector+ocr', text: 'Connect', detection_confidence: .9,
  bbox_xyxy: [10, 20, 110, 60], center_xy: [60, 40], text_offset: 0, text_length: 7, text_truncated: false, matched_ocr_spans: 1 }
export const result = (): AnalysisRecord => ({ id: 'analysis', state: 'succeeded', stage: 'complete', creator: { origin: 'local' }, source: { kind: 'preview', id: 'preview' },
  parameters: { ...screenAnalysisDefaults }, parameter_source: 'settings', session_id: 'session', settings_revision: 1, sha256: 'digest', metadata,
  created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), action_expires_at: new Date(Date.now() + 300000).toISOString(),
  reused: false, reuse_allowed: true, duration_ms: 10, inference_ms: 5, schema_version: 2, image: { width: 800, height: 400, coordinate_space: 'original_pixels' },
  summary: { element_count: 1, region_count: 1, text_count: 0, ocr_span_count: 1, truncated: false, truncation_reasons: [] } })
export function setup() {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screen'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const gateway: WorkflowMediaGateway = {
    ocrDefaults: vi.fn().mockResolvedValue({text_confidence:.5,ocr_max_side:1600}), previewOCR: vi.fn(), ocrReport: vi.fn(), openPreview: vi.fn().mockResolvedValue({ id: 'preview' }), closePreview: vi.fn().mockResolvedValue(undefined), capture: vi.fn().mockResolvedValue({ metadata, blob: new Blob(['original']) }),
    analysisFull: vi.fn(), renderAnalysisImage: vi.fn(), submitAnalysis: vi.fn().mockResolvedValue({ ...result(), state: 'queued' }), getAnalysis: vi.fn().mockResolvedValue(result()),
    analysisImage: vi.fn().mockResolvedValue(new Blob(['analyzed-original'])), deleteAnalysis: vi.fn(), cancelAnalysis: vi.fn().mockResolvedValue({ ...result(), state: 'cancelling' }),
    match: vi.fn(), asset: vi.fn(), upload: vi.fn(), listAnalyses: vi.fn(), clearAnalyses: vi.fn(), analysisStorage: vi.fn(),
    analysisElements: vi.fn().mockResolvedValue({ items: [element], total: 1, limited_by_inference: false }),
    analysisElement: vi.fn().mockResolvedValue(element), analysisSpans: vi.fn().mockResolvedValue({ items: [], total: 0 }), analysisSpan: vi.fn(),
    analysisGeometry: vi.fn().mockResolvedValue([element]), analysisDiagnostics: vi.fn(), exportAnalysis: vi.fn().mockResolvedValue(new Blob(['{}'])),
    validateAnalysisAction: vi.fn().mockResolvedValue(undefined),
  }
  const step: Step = { id: 'click', kind: 'pointer.click', name: '', action: {}, target: { kind: 'point', x: 0, y: 0 } }
  const props = { gateway, step, target: { mode: 'session' as const, id: 'session', connectionGeneration: 1 }, onTargetChange: vi.fn(), onChange: vi.fn(),
    sessions: [{ id: 'session', host_name: 'win-4090', profile_name: 'default', protocol: 'vnc' as const, connection_generation: 1, status: 'streaming' as const }] }
  return { gateway, props }
}
