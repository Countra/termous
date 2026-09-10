import type { StreamFn } from '@earendil-works/pi-agent-core'
import type { Model, SimpleStreamOptions, ThinkingLevelMap } from '@earendil-works/pi-ai'
import { streamSimple as streamOpenAICompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as streamOpenAIResponses } from '@earendil-works/pi-ai/api/openai-responses'
import type { RuntimeModelSnapshot } from './workerCoreClient.ts'

const unauthenticatedAPIKeySentinel = 'termous-local-no-auth'
const providerRequestTimeoutMs = 10 * 60_000
const legacyChatMaxTokensProviderDomains = [
  'chutes.ai',
  'deepseek.com',
  'api.moonshot.cn',
  'gateway.ai.cloudflare.com',
  'api.together.ai',
  'api.together.xyz',
  'integrate.api.nvidia.com',
  'api.ant-ling.com',
  'api.z.ai',
  'open.bigmodel.cn',
] as const

export type RuntimeModel =
  | Model<'openai-responses'>
  | Model<'openai-completions'>

export function createProviderModel(snapshot: RuntimeModelSnapshot): RuntimeModel {
  const api = snapshot.api_mode === 'responses'
    ? 'openai-responses'
    : 'openai-completions'
  const input: Array<'text' | 'image'> = snapshot.supports_images
    ? ['text', 'image']
    : ['text']
  const common = {
    id: snapshot.model_id,
    name: snapshot.model_id,
    provider: 'termous-openai-compatible',
    baseUrl: validateProviderBaseURL(snapshot.base_url).toString().replace(/\/$/, ''),
    reasoning: snapshot.reasoning_control === 'openai_effort',
    thinkingLevelMap: runtimeThinkingLevelMap(snapshot.supported_reasoning_levels),
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: snapshot.context_window_tokens,
    maxTokens: snapshot.max_output_tokens,
  }
  if (api === 'openai-responses') {
    return {
      ...common,
      api,
      compat: {
        supportsDeveloperRole: false,
        supportsStrictMode: false,
        supportsLongCacheRetention: false,
      },
    }
  }
  return {
    ...common,
    api,
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: snapshot.reasoning_control === 'openai_effort',
      maxTokensField: chatMaxTokensField(common.baseUrl),
      supportsStrictMode: false,
      supportsLongCacheRetention: false,
      sendSessionAffinityHeaders: false,
    },
  }
}

function runtimeThinkingLevelMap(
  supportedLevels: RuntimeModelSnapshot['supported_reasoning_levels'],
): ThinkingLevelMap {
  const supported = new Set(supportedLevels)
  return {
    off: supported.has('off') ? 'none' : null,
    minimal: supported.has('minimal') ? 'minimal' : null,
    low: supported.has('low') ? 'low' : null,
    medium: supported.has('medium') ? 'medium' : null,
    high: supported.has('high') ? 'high' : null,
    xhigh: supported.has('xhigh') ? 'xhigh' : null,
    max: supported.has('max') ? 'max' : null,
  }
}

export function chatMaxTokensField(baseURL: string): 'max_tokens' | 'max_completion_tokens' {
  const hostname = validateProviderBaseURL(baseURL).hostname.toLowerCase().replace(/\.$/u, '')
  const legacy = legacyChatMaxTokensProviderDomains.some((domain) =>
    hostname === domain || hostname.endsWith(`.${domain}`))
  return legacy ? 'max_tokens' : 'max_completion_tokens'
}

export function createRestrictedProviderFetch(
  baseURL: string,
  removeAuthorization: boolean,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  const base = validateProviderBaseURL(baseURL)
  const pathPrefix = base.pathname.replace(/\/$/, '')
  return async (input, init) => {
    const target = requestURL(input)
    if (target.origin !== base.origin
      || target.username
      || target.password
      || target.hash
      || !pathWithinPrefix(target.pathname, pathPrefix)) {
      throw new Error('AGENT_MODEL_ENDPOINT_VIOLATION')
    }
    const headers = mergedRequestHeaders(input, init?.headers)
    if (removeAuthorization) {
      headers.delete('authorization')
    }
    return await fetchImplementation(input, {
      ...init,
      headers,
      redirect: 'manual',
    })
  }
}

export function createRuntimeStreamFunction(
  apiKey: string | undefined,
  providerFetch: typeof globalThis.fetch,
  timeoutMs = providerRequestTimeoutMs,
): StreamFn {
  return (model, context, options) => {
    const sharedOptions = createRuntimeStreamOptions(apiKey, providerFetch, options, timeoutMs)
    if (model.api === 'openai-responses') {
      return streamOpenAIResponses(
        model as Model<'openai-responses'>,
        context,
        sharedOptions,
      )
    }
    if (model.api === 'openai-completions') {
      return streamOpenAICompletions(
        model as Model<'openai-completions'>,
        context,
        sharedOptions,
      )
    }
    throw new Error('AGENT_MODEL_API_UNSUPPORTED')
  }
}

export function createRuntimeStreamOptions(
  apiKey: string | undefined,
  providerFetch: typeof globalThis.fetch,
  options?: SimpleStreamOptions,
  timeoutMs = providerRequestTimeoutMs,
) {
  return {
    ...options,
    apiKey: apiKey || unauthenticatedAPIKeySentinel,
    fetch: providerFetch,
    maxRetries: 0,
    timeoutMs,
    cacheRetention: 'none' as const,
  }
}

function validateProviderBaseURL(value: string) {
  const url = new URL(value)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || !url.host
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new Error('AGENT_MODEL_ENDPOINT_INVALID')
  }
  return url
}

function pathWithinPrefix(pathname: string, prefix: string) {
  return prefix === '' || prefix === '/'
    ? pathname.startsWith('/')
    : pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function requestURL(input: RequestInfo | URL) {
  if (input instanceof URL) {
    return input
  }
  if (typeof input === 'string') {
    return new URL(input)
  }
  return new URL(input.url)
}

function mergedRequestHeaders(input: RequestInfo | URL, overrides?: HeadersInit) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (overrides !== undefined) {
    for (const [name, value] of new Headers(overrides)) {
      headers.set(name, value)
    }
  }
  return headers
}
