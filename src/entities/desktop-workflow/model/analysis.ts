import type { DesktopSnapshotMetadata } from '#entities/remote-desktop'

export interface AnalysisText {
  text: string; text_confidence: number; bbox_xyxy: [number, number, number, number]
  bbox_normalized: [number, number, number, number]; center_xy: [number, number]; polygon_xy: [number, number][]
}
export interface AnalysisElement {
  id: number; type: 'interactive_region' | 'text'; source: 'yolo' | 'yolo+ocr' | 'ocr'
  bbox_xyxy: [number, number, number, number]; bbox_normalized: [number, number, number, number]
  center_xy: [number, number]; confidence?: number; text: string; text_spans?: AnalysisText[]
  text_confidence?: number; polygon_xy?: [number, number][]
}
export interface ScreenAnalysis {
  id: string; session_id: string; sha256: string; expires_at: string; metadata: DesktopSnapshotMetadata
  result: {
    schema_version: number; model: string; device: string; image: { width: number; height: number }
    parameters: Record<string, number>; detection_ms: number; render_ms: number; total_ms: number
    ocr: { count: number; inference_ms: number }; count: number; truncated: boolean; elements: AnalysisElement[]
  }
}
