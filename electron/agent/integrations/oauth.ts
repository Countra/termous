import type { AuthProvider } from '@earendil-works/pi-mcp'
import { adaptOAuthProvider, authorizeMcp, McpOAuthProvider, OAuthCallbackServer, type McpOAuthState } from '@earendil-works/pi-mcp/oauth'
import type { IntegrationCorePort, IntegrationHostConfig } from '../contracts/integrations.ts'
import { integrationNetwork } from './network.ts'
import { oauthFetch, validateOAuthURL } from './oauthBoundary.ts'

interface OAuthEntry { auth: AuthProvider; abort: AbortController }

export class IntegrationOAuth {
  private readonly entries = new Map<string, OAuthEntry>()
  private readonly core: Pick<IntegrationCorePort,'beginOAuth' | 'saveOAuth'>
  private readonly fetchImplementation?: typeof fetch
  private readonly report?: (code: string) => void

  constructor(core: Pick<IntegrationCorePort,'beginOAuth' | 'saveOAuth'>, fetchImplementation?: typeof fetch, report?: (code: string) => void) { this.core = core; this.fetchImplementation = fetchImplementation; this.report = report }

  provider(config: IntegrationHostConfig): AuthProvider {
    const key = `${config.source.id}:${config.source.revision}:${JSON.stringify(config.configuration?.network)}`
    const existing = this.entries.get(key)
    if (existing) return existing.auth
    this.invalidate(config.source.id)
    if (this.entries.size >= 128) throw new Error('INTEGRATION_AUTH_CAPACITY')
    const abort = new AbortController()
    const { provider, fetch } = this.create(config, 'http://127.0.0.1/', abort.signal, async () => { throw new Error('INTEGRATION_AUTH_REQUIRED') })
    const adapter = adaptOAuthProvider(provider)
    const auth: AuthProvider = {
      token: () => { abort.signal.throwIfAborted(); return adapter.token() },
      onUnauthorized: async context => {
        // 扩大 scope 必须由用户重新登录；普通调用不打开浏览器。
        if (context.response.status === 403) throw new Error('INTEGRATION_AUTH_REQUIRED')
        await adapter.onUnauthorized?.({ ...context, fetch })
      },
    }
    this.entries.set(key, { auth, abort })
    return auth
  }

  async login(source: string, revision: number, open: (url: string) => Promise<void>, signal?: AbortSignal) {
    this.invalidate(source)
    const config = await this.core.beginOAuth(source, revision, signal)
    const abort = new AbortController()
    const combined = AbortSignal.any([abort.signal, AbortSignal.timeout(5 * 60_000), ...(signal ? [signal] : [])])
    const callback = await OAuthCallbackServer.listen({ host: '127.0.0.1', port: 0, path: '/termous/oauth/callback', timeoutMs: 5 * 60_000 })
    const stop = () => { void callback.close() }
    combined.addEventListener('abort', stop, { once: true })
    let returned: ReturnType<OAuthCallbackServer['waitForCallback']> | undefined
    try {
      combined.throwIfAborted()
      const { provider, fetch } = this.create(config, callback.redirectUrl, combined, async url => {
        const state = url.searchParams.get('state')
        if (!state) throw new Error('INTEGRATION_OAUTH_STATE_MISSING')
        returned = callback.waitForCallback(state)
        // 在浏览器打开期间也接管拒绝，避免取消产生未处理 rejection。
        void returned.catch(() => undefined)
        await open(url.href)
      })
      const options = { serverUrl: config.source.mcp!.url!, fetch, signal: combined }
      const result = await authorizeMcp(provider, { ...options, skipRefresh: true })
      if (result === 'REDIRECT') {
        if (!returned) throw new Error('INTEGRATION_OAUTH_CALLBACK_MISSING')
        const response = await returned
        await authorizeMcp(provider, { ...options, authorizationCode: response.code, iss: response.iss })
      }
      return { revision: config.source.revision }
    } finally { combined.removeEventListener('abort', stop); abort.abort(); await callback.close() }
  }

  invalidate(source: string) {
    for (const [key, entry] of this.entries) if (key.startsWith(`${source}:`)) { entry.abort.abort(); this.entries.delete(key) }
  }
  close() { for (const entry of this.entries.values()) entry.abort.abort(); this.entries.clear() }

  private create(config: IntegrationHostConfig, redirectUrl: string, signal: AbortSignal, redirect: (url: URL) => Promise<void>) {
    const serverUrl = validateOAuthURL(config.source.mcp!.url!).href
    let state = config.secret.oauth as McpOAuthState | undefined
    const network = integrationNetwork(config.configuration?.network, this.fetchImplementation)
    const close = () => { void network.close().catch(() => { this.report?.('INTEGRATION_OAUTH_NETWORK_CLOSE_FAILED') }) }
    signal.addEventListener('abort', close, { once: true })
    if (signal.aborted) close()
    const fetch = oauthFetch(() => state, signal, network.fetch)
    const provider = new McpOAuthProvider({ serverUrl, redirectUrl, clientMetadata: { client_name: 'Termous', application_type: 'native' },
      store: {
        load: () => state,
        save: async next => { await this.core.saveOAuth(config.source.id, config.source.revision, next, signal); state = next },
      },
      onRedirect: async url => {
        validateOAuthURL(url)
        const discovery = state?.discovery
        if (!discovery) throw new Error('INTEGRATION_OAUTH_DISCOVERY_REQUIRED')
        const endpoint = validateOAuthURL(discovery.authorizationServerMetadata?.authorization_endpoint ?? new URL('/authorize', discovery.authorizationServerUrl))
        if (endpoint.origin !== url.origin || endpoint.pathname !== url.pathname) throw new Error('INTEGRATION_OAUTH_ENDPOINT_INVALID')
        await redirect(url)
      },
    })
    return { provider, fetch }
  }
}
