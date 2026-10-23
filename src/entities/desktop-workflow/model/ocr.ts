import type { WorkflowOCRParameters, WorkflowOCRQuery } from '#common/contracts'
import type { DesktopSnapshotMetadata } from '#entities/remote-desktop'

export type OCRParameters = WorkflowOCRParameters
export type OCRQuery = WorkflowOCRQuery
export interface OCRTarget extends OCRQuery {
  occurrence?: number
  anchor?: 'top_left' | 'top' | 'top_right' | 'left' | 'center' | 'right' | 'bottom_left' | 'bottom' | 'bottom_right'
  offset: { x: number; y: number }
}
export interface OCRSpan {
  id: number; text: string; confidence: number; bbox_xyxy: [number, number, number, number]
  center_xy: [number, number]; matched: boolean; selected?: boolean
}
export interface OCRObservationSummary {
  role: string; width: number; height: number; parameters: OCRParameters
  recognized_count: number; matched_count: number; selected_ids: number[]
  truncated: boolean; truncation_reasons: string[]; duration_ms: number; device: string; fingerprint: string
}
export interface OCRObservation extends OCRObservationSummary { spans: OCRSpan[] }
export interface OCRStepSummary {
  samples: number; observations: OCRObservationSummary[]; available: boolean
  cleared?: boolean; redacted?: boolean; report_truncated: boolean
}
export interface OCRReportPage {
  summary: OCRStepSummary; items: (OCRSpan & { role: string })[]; total: number; offset: number; limit: number
}
export interface OCRPreview { capture: { metadata: DesktopSnapshotMetadata }; observation: OCRObservation; image: Blob }
