import { screenAnalysisDefaults, type AnalysisElementView, type AnalysisGateway, type AnalysisRecord } from '#common/contracts'

// 只为界面验收提供合成记录，不读取用户截图、数据库或远程桌面。
const elements: AnalysisElementView[] = [
  { id: 0, kind: 'region', source: 'detector+ocr', text: '连接 Connect', text_offset: 0, text_length: 10, text_truncated: false, matched_ocr_spans: 1, bbox_xyxy: [80, 60, 240, 120], center_xy: [159, 89], detection_confidence: .86 },
  { id: 1, kind: 'text', source: 'ocr', text: '工作站已就绪', text_offset: 0, text_length: 6, text_truncated: false, matched_ocr_spans: 1, bbox_xyxy: [80, 160, 330, 200], center_xy: [204, 179], text_confidence: .94 },
]
const record: AnalysisRecord = { id: 'analysis_fixture', source: { kind: 'preview', id: 'closed', name: '本地工作站' }, state: 'succeeded', stage: 'complete',
  parameters: screenAnalysisDefaults, parameter_source: 'settings', schema_version: 2, settings_revision: 1, sha256: 'a'.repeat(64),
  created_at: new Date().toISOString(), finished_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  reused: true, reuse_allowed: true, duration_ms: 4.2, inference_ms: 2342,
  image: { width: 640, height: 360, coordinate_space: 'original_pixels' },
  confidence_distribution: { detection: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0], ocr: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1] },
  summary: { element_count: 2, region_count: 1, text_count: 1, ocr_span_count: 2, truncated: false, truncation_reasons: [] } }
const page = <T>(items: T[]) => ({ items, total: items.length, limited_by_inference: false })
const unsupported = async (): Promise<never> => { throw new Error('合成界面不执行持久操作') }
const image = async () => {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#20262d'; ctx.fillRect(0, 0, 640, 360)
  ctx.fillStyle = '#394b5c'; ctx.fillRect(80, 60, 160, 60); ctx.fillStyle = '#ffffff'; ctx.font = '20px sans-serif'
  ctx.fillText('连接 Connect', 96, 98); ctx.fillText('工作站已就绪', 80, 190)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG 生成失败')), 'image/png'))
}
export const analysisFixture: AnalysisGateway = {
  submitAnalysis: unsupported, cancelAnalysis: unsupported, deleteAnalysis: unsupported, clearAnalyses: unsupported, validateAnalysisAction: unsupported,
  listAnalyses: async () => page([record]), getAnalysis: async () => record,
  analysisElements: async (_id, query = {}) => page(elements.filter(item => (!query.kind || item.kind === query.kind) && (!query.q || item.text.includes(query.q)))),
  analysisElement: async (_id, index) => elements[index],
  analysisSpans: async (_id, query = {}) => page(elements.filter(item => query.element_id === undefined || item.id === query.element_id).map(item => ({ ...item, element_id: item.id, text_confidence: item.id === 0 ? .87 : .94 }))),
  analysisSpan: unsupported, analysisGeometry: async () => elements.map(({ id, kind, bbox_xyxy, center_xy }) => ({ id, kind, bbox_xyxy, center_xy })),
  analysisImage: image, exportAnalysis: unsupported, analysisStorage: unsupported,
  analysisDiagnostics: async () => ({ computed_at: record.created_at, identity: { instance_id: 'fixture', fingerprint: 'a'.repeat(64), implementation: 'b'.repeat(64), models: 'c'.repeat(64), device: 'cpu', precision: 'fp32', schema_version: 2, runtime: { torch: '2.11.0' } },
    diagnostics: { parameters: screenAnalysisDefaults, device: 'cpu', models: { detector: 'icon_detect', ocr_detection: 'PP-OCRv6_small_det', ocr_recognition: 'PP-OCRv6_small_rec' }, timings_ms: { detection: 2100, ocr: 230, association: 1, annotation: 11, total: 2342 }, ocr_spans: [] } }),
}
