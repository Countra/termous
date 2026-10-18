import type { AgentApiMode, AgentModelProvider, AgentModelProviderInput } from '#entities/agent'

export interface ProviderDraft {
  name: string
  apiMode: AgentApiMode
  baseUrl: string
  enabled: boolean
  apiKey: string
  removeApiKey: boolean
}

export function createDraft(provider?: AgentModelProvider): ProviderDraft {
  return provider ? {
    name: provider.name,
    apiMode: provider.api_mode,
    baseUrl: provider.base_url,
    enabled: provider.enabled,
    apiKey: '',
    removeApiKey: false,
  } : {
    name: '',
    apiMode: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    apiKey: '',
    removeApiKey: false,
  }
}

export function isDraftDirty(draft: ProviderDraft, provider?: AgentModelProvider) {
  if (!provider) {
    return Boolean(draft.name || draft.apiKey)
      || draft.apiMode !== 'responses'
      || draft.baseUrl !== 'https://api.openai.com/v1'
      || !draft.enabled
  }
  return draft.name !== provider.name
    || draft.apiMode !== provider.api_mode
    || draft.baseUrl !== provider.base_url
    || draft.enabled !== provider.enabled
    || Boolean(draft.apiKey.trim())
    || draft.removeApiKey
}

export function toInput(draft: ProviderDraft, confirmInsecureHttp: boolean): AgentModelProviderInput {
  const input: AgentModelProviderInput = {
    name: draft.name.trim(),
    api_mode: draft.apiMode,
    base_url: draft.baseUrl.trim(),
    enabled: draft.enabled,
    confirm_insecure_http: confirmInsecureHttp,
  }
  if (draft.apiKey.trim()) input.api_key = draft.apiKey
  if (draft.removeApiKey) input.remove_api_key = true
  return input
}

export function validateDraft(draft: ProviderDraft, t: (key: string) => string) {
  const name = draft.name.trim()
  if (!name) return t('settings.agent.validation.providerName')
  if (utf8Bytes(name) > 80) return t('settings.agent.validation.nameTooLarge')
  if (utf8Bytes(draft.apiKey) > 16 * 1024) return t('settings.agent.apiKey.tooLarge')
  if (utf8Bytes(draft.baseUrl.trim()) > 2048) return t('settings.agent.validation.baseUrlTooLarge')
  try {
    const url = new URL(draft.baseUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) {
      return t('settings.agent.validation.baseUrl')
    }
  } catch {
    return t('settings.agent.validation.baseUrl')
  }
  return null
}

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export function isInsecureHttp(value: string) {
  try {
    return new URL(value.trim()).protocol === 'http:'
  } catch {
    return false
  }
}
