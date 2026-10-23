import type { AnalysisGateway, AnalysisMediaRequest, AnalysisImageMetadata } from '#common/contracts'

type Binary = { bytes: ArrayBuffer; type: string }
export function analysisRemoteGateway(send: (input: AnalysisMediaRequest) => Promise<unknown>): AnalysisGateway {
  const request = async <T,>(input: AnalysisMediaRequest, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted()
    const value = await send(input)
    signal?.throwIfAborted()
    return value as T
  }
  const binary = async (input: AnalysisMediaRequest, signal?: AbortSignal) => {
    const value = await request<Binary>(input, signal)
    return new Blob([value.bytes], { type: value.type })
  }
  return {
    validateAnalysisAction: (id, preview, signal) => request({ operation: 'action-context', id, preview }, signal),
    submitAnalysis: (input, signal) => request({ operation: 'submit', input }, signal),
    analysisFull: (id, signal) => request({ operation: 'full', id }, signal),
    renderAnalysisImage: async (id, query, signal) => {
      const value = await request<Binary & { metadata: AnalysisImageMetadata }>({ operation: 'render', id, query }, signal)
      return { blob: new Blob([value.bytes], { type: value.type }), metadata: value.metadata }
    },
    getAnalysis: (id, signal) => request({ operation: 'get', id }, signal),
    listAnalyses: (query, signal) => request({ operation: 'list', query }, signal),
    cancelAnalysis: id => request({ operation: 'cancel', id }),
    deleteAnalysis: id => request({ operation: 'delete', id }), clearAnalyses: () => request({ operation: 'clear' }),
    analysisElements: (id, query, signal) => request({ operation: 'elements', id, query }, signal),
    analysisElement: (id, item, offset, signal) => request({ operation: 'element', id, item, offset }, signal),
    analysisSpans: (id, query, signal) => request({ operation: 'spans', id, query }, signal),
    analysisSpan: (id, item, offset, signal) => request({ operation: 'span', id, item, offset }, signal),
    analysisGeometry: (id, signal) => request({ operation: 'geometry', id }, signal),
    analysisDiagnostics: (id, signal) => request({ operation: 'diagnostics', id }, signal),
    analysisImage: (id, image, signal) => binary({ operation: 'image', id, image }, signal),
    exportAnalysis: (id, signal) => binary({ operation: 'export', id }, signal),
    analysisStorage: signal => request({ operation: 'storage' }, signal),
  }
}

export async function handleAnalysisMedia(gateway: AnalysisGateway, request: AnalysisMediaRequest) {
  const binary = async (pending: Promise<Blob>) => {
    const blob = await pending
    if (blob.size > 32 * 1024 * 1024) throw new Error('analysis_result_limit')
    return { bytes: await blob.arrayBuffer(), type: blob.type }
  }
  switch (request.operation) {
    case 'action-context': return gateway.validateAnalysisAction(request.id, request.preview)
    case 'full': return gateway.analysisFull(request.id)
    case 'render': { const value = await gateway.renderAnalysisImage(request.id, request.query); return { ...await binary(Promise.resolve(value.blob)), metadata: value.metadata } }
    case 'submit': return gateway.submitAnalysis(request.input)
    case 'list': return gateway.listAnalyses(request.query)
    case 'storage': return gateway.analysisStorage()
    case 'clear': return gateway.clearAnalyses()
    case 'get': return gateway.getAnalysis(request.id)
    case 'cancel': return gateway.cancelAnalysis(request.id)
    case 'delete': return gateway.deleteAnalysis(request.id)
    case 'elements': return gateway.analysisElements(request.id, request.query)
    case 'element': return gateway.analysisElement(request.id, request.item, request.offset)
    case 'spans': return gateway.analysisSpans(request.id, request.query)
    case 'span': return gateway.analysisSpan(request.id, request.item, request.offset)
    case 'geometry': return gateway.analysisGeometry(request.id)
    case 'diagnostics': return gateway.analysisDiagnostics(request.id)
    case 'image': return binary(gateway.analysisImage(request.id, request.image))
    case 'export': return binary(gateway.exportAnalysis(request.id))
  }
}

// 组合显式绑定领域方法，避免展开类实例时遗漏原型方法。
export function bindAnalysisGateway(gateway: AnalysisGateway): AnalysisGateway {
  return {
    analysisFull: (...args) => gateway.analysisFull(...args), renderAnalysisImage: (...args) => gateway.renderAnalysisImage(...args),
    validateAnalysisAction: (...args) => gateway.validateAnalysisAction(...args),
    submitAnalysis: (...args) => gateway.submitAnalysis(...args), getAnalysis: (...args) => gateway.getAnalysis(...args),
    listAnalyses: (...args) => gateway.listAnalyses(...args), cancelAnalysis: (...args) => gateway.cancelAnalysis(...args),
    deleteAnalysis: (...args) => gateway.deleteAnalysis(...args), clearAnalyses: () => gateway.clearAnalyses(),
    analysisElements: (...args) => gateway.analysisElements(...args), analysisElement: (...args) => gateway.analysisElement(...args),
    analysisSpans: (...args) => gateway.analysisSpans(...args), analysisSpan: (...args) => gateway.analysisSpan(...args),
    analysisGeometry: (...args) => gateway.analysisGeometry(...args), analysisDiagnostics: (...args) => gateway.analysisDiagnostics(...args),
    analysisImage: (...args) => gateway.analysisImage(...args), exportAnalysis: (...args) => gateway.exportAnalysis(...args),
    analysisStorage: (...args) => gateway.analysisStorage(...args),
  }
}
