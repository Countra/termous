import type { McpOAuthState } from '@earendil-works/pi-mcp/oauth'

export function validateOAuthURL(value: string | URL): URL {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.hash || url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('INTEGRATION_OAUTH_ENDPOINT_INVALID')
  }
  return url
}

// OAuth 发现不携带 MCP 凭据；令牌和注册请求只能发往已验证发现文档中的准确端点。
export function oauthFetch(state: () => McpOAuthState | undefined, lifetime: AbortSignal, implementation: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const url = validateOAuthURL(input instanceof Request ? input.url : input)
    const method = init?.method?.toUpperCase() ?? 'GET'
    const headers = new Headers(init?.headers)
    if (method === 'GET') {
      if (headers.has('authorization') || headers.has('cookie') || init?.body) throw new Error('INTEGRATION_OAUTH_CREDENTIAL_BOUNDARY')
    } else if (method === 'POST') {
      const discovery = state()?.discovery
      if (!discovery) throw new Error('INTEGRATION_OAUTH_DISCOVERY_REQUIRED')
      const endpoints = [
        discovery.authorizationServerMetadata?.token_endpoint ?? new URL('/token', discovery.authorizationServerUrl).href,
        discovery.authorizationServerMetadata?.registration_endpoint ?? new URL('/register', discovery.authorizationServerUrl).href,
      ]
      if (!endpoints.some(endpoint => validateOAuthURL(endpoint).href === url.href)) throw new Error('INTEGRATION_OAUTH_CREDENTIAL_BOUNDARY')
    } else throw new Error('INTEGRATION_OAUTH_METHOD_INVALID')
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])])
    const response = await implementation(url, { ...init, headers, signal, redirect: 'manual', credentials: 'omit' })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error('INTEGRATION_REDIRECT_REJECTED')
    }
    if (!response.body) return response
    let bytes = 0
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > 1024 * 1024) controller.error(new Error('INTEGRATION_OAUTH_RESPONSE_TOO_LARGE'))
        else controller.enqueue(chunk)
      },
    }))
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
