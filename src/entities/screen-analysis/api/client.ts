import { TermousApiError, TermousApiTransport } from '#shared/api'
import type { AnalysisGateway, AnalysisSubmit, AnalysisRecord, AnalysisRecordQuery, AnalysisPage, AnalysisQuery,
  AnalysisElementView, AnalysisSpanView, AnalysisGeometry, AnalysisDiagnosticView, AnalysisStorageUsage, AnalysisFullRecord, AnalysisImageQuery, AnalysisImageMetadata } from '#common/contracts'

import { parseAnalysisImageMetadata } from './image-metadata'

const root = '/api/v1/screen-analyses'
const path = (id: string) => `${root}/${encodeURIComponent(id)}`
const search = (value: AnalysisQuery | AnalysisRecordQuery | AnalysisImageQuery = {}) => {
  const query = new URLSearchParams()
  for (const [key, item] of Object.entries(value)) if (item !== undefined && item !== '') query.set(key, Array.isArray(item) ? item.join(',') : String(item))
  return query.size ? `?${query}` : ''
}
export class ScreenAnalysisClient extends TermousApiTransport implements AnalysisGateway {
  validateAnalysisAction(id: string, preview: string, signal?: AbortSignal) { return this.request<void>(`${path(id)}/action-context?preview_id=${encodeURIComponent(preview)}`, { signal }) }
  async submitAnalysis(input: AnalysisSubmit, signal?: AbortSignal) {
    return this.check(await this.request<AnalysisRecord>(root, { method: 'POST', body: input, signal }))
  }
  async analysisFull(id: string, signal?: AbortSignal) {
    const value = await this.request<AnalysisFullRecord>(`${path(id)}?response_detail=full`, { signal })
    this.check(value)
    if (value.result?.schema_version !== 2 || !value.inference_identity) throw new TermousApiError('画面分析完整结果无效', 'analysis_invalid_response', 502)
    return value
  }
  async renderAnalysisImage(id: string, query: AnalysisImageQuery, signal?: AbortSignal) {
    let metadata: AnalysisImageMetadata | undefined
    const blob = await this.requestBlob(`${path(id)}/images/annotated${search({ ...query, layer: query.layer ?? 'elements' })}`, { signal, timeoutMs: 20_000,
      onHeaders: headers => { metadata = parseAnalysisImageMetadata(headers.get('X-Termous-Analysis-Image'), id) } })
    if (!metadata) throw new TermousApiError('画面分析图片元数据缺失', 'analysis_invalid_response', 502)
    return { blob, metadata }
  }
  async getAnalysis(id: string, signal?: AbortSignal) { return this.check(await this.request<AnalysisRecord>(path(id), { signal })) }
  async listAnalyses(query?: AnalysisRecordQuery, signal?: AbortSignal) {
    const page = await this.request<AnalysisPage<AnalysisRecord>>(root + search(query), { signal })
    page.items.forEach(record => this.check(record))
    return page
  }
  async cancelAnalysis(id: string) { return this.check(await this.request<AnalysisRecord>(`${path(id)}/cancel`, { method: 'POST' })) }
  deleteAnalysis(id: string) { return this.request<void>(path(id), { method: 'DELETE' }) }
  clearAnalyses() { return this.request<void>(root, { method: 'DELETE' }) }
  analysisElements(id: string, query?: AnalysisQuery, signal?: AbortSignal) { return this.request<AnalysisPage<AnalysisElementView>>(`${path(id)}/elements${search(query)}`, { signal }) }
  analysisElement(id: string, element: number, offset = 0, signal?: AbortSignal) { return this.request<AnalysisElementView>(`${path(id)}/elements/${element}?text_offset=${offset}`, { signal }) }
  analysisSpans(id: string, query?: AnalysisQuery, signal?: AbortSignal) { return this.request<AnalysisPage<AnalysisSpanView>>(`${path(id)}/ocr-spans${search(query)}`, { signal }) }
  analysisSpan(id: string, span: number, offset = 0, signal?: AbortSignal) { return this.request<AnalysisSpanView>(`${path(id)}/ocr-spans/${span}?text_offset=${offset}`, { signal }) }
  analysisGeometry(id: string, signal?: AbortSignal) { return this.request<AnalysisGeometry[]>(`${path(id)}/geometry`, { signal }) }
  analysisDiagnostics(id: string, signal?: AbortSignal) { return this.request<AnalysisDiagnosticView>(`${path(id)}/diagnostics`, { signal }) }
  analysisImage(id: string, kind: 'original' | 'annotated', signal?: AbortSignal) { return this.requestBlob(`${path(id)}/images/${kind}`, { signal }) }
  exportAnalysis(id: string, signal?: AbortSignal) { return this.requestBlob(`${path(id)}/export`, { signal }) }
  analysisStorage(signal?: AbortSignal) { return this.request<AnalysisStorageUsage>(`${root}/storage`, { signal }) }
  private check(record: AnalysisRecord) {
    if (record.schema_version !== 2) throw new TermousApiError('画面分析协议版本不匹配，请同步更新 Core、Python 和 Web', 'analysis_version_mismatch', 502)
    return record
  }
}
