import type { McpTransport, McpTransportSendOptions, JsonRpcMessage } from '@earendil-works/pi-mcp'

export const integrationMessageLimit = 16 * 1024 * 1024

export class IntegrationHTTPBoundary {
  private readonly signals = new Map<string | number, AbortSignal>()

  private readonly endpoint: string
  private readonly implementation: typeof fetch
  constructor(endpoint: string, implementation: typeof fetch = globalThis.fetch) {
    this.endpoint = endpoint
    this.implementation = implementation
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const endpoint = new URL(this.endpoint)
    if (url.href !== endpoint.href || url.username || url.password || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('INTEGRATION_ENDPOINT_VIOLATION')
    let signal = init?.signal
    if (typeof init?.body === 'string') {
      const message = JSON.parse(init.body) as { id?: string | number }
      const requestSignal = message.id === undefined ? undefined : this.signals.get(message.id)
      if (requestSignal) signal = signal ? AbortSignal.any([signal, requestSignal]) : requestSignal
    }
    signal?.throwIfAborted()
    const response = await this.implementation(input, { ...init, signal, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('INTEGRATION_REDIRECT_REJECTED') }
    // SSE 按协议事件限长；普通 JSON 响应需要额外限制整个流，不能直接依赖 response.json()。
    if (response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) return response
    const length = Number(response.headers.get('content-length'))
    if (length > integrationMessageLimit) { await response.body?.cancel(); throw new Error('INTEGRATION_MESSAGE_TOO_LARGE') }
    if (!response.body) return response
    let bytes = 0
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > integrationMessageLimit) controller.error(new Error('INTEGRATION_MESSAGE_TOO_LARGE'))
        else controller.enqueue(chunk)
      },
    }))
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  wrap(transport: McpTransport): McpTransport {
    return {
      start: () => transport.start(), close: () => transport.close(),
      onMessage: listener => transport.onMessage(listener), onError: listener => transport.onError(listener), onClose: listener => transport.onClose(listener),
      ...(transport.setProtocolVersion ? { setProtocolVersion: version => transport.setProtocolVersion!(version) } : {}),
      send: async (message: JsonRpcMessage, options?: McpTransportSendOptions) => {
        const id = 'id' in message ? message.id : undefined
        if (id !== undefined && options?.signal) this.signals.set(id, options.signal)
        try { await transport.send(message, options) }
        finally { if (id !== undefined) this.signals.delete(id) }
      },
    }
  }
}
