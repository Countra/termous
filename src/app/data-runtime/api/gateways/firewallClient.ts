import type { AppConfig } from '#common/contracts';
import type { FirewallApplyResult, FirewallCapability, FirewallDesiredState, FirewallInstallPlan, FirewallPersistenceInstallResult, FirewallPersistenceStatus, FirewallPlan, FirewallProvider, FirewallProviderList, FirewallSaveResult, FirewallSnapshot } from '#entities/firewall';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class FirewallClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

sessionFirewallProviders(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallProviderList>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/providers`, {
      signal: options.signal,
    }).then(normalizeFirewallProviderList)
  }

sessionFirewallCapability(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallCapability>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/capability${firewallProviderQuery(provider)}`, {
      signal: options.signal,
    }).then(normalizeFirewallCapability)
  }

sessionFirewallSnapshot(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallSnapshot>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/snapshot${firewallProviderQuery(provider)}`, {
      signal: options.signal,
    }).then(normalizeFirewallSnapshot)
  }

previewSessionFirewall(id: string, desired: FirewallDesiredState, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallPlan>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/preview${firewallProviderQuery(provider)}`, {
      method: 'POST',
      body: desired,
      signal: options.signal,
    })
  }

applySessionFirewall(id: string, desired: FirewallDesiredState, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallApplyResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/apply${firewallProviderQuery(provider)}`, {
      method: 'POST',
      body: desired,
      signal: options.signal,
    }).then(normalizeFirewallApplyResult)
  }

saveSessionFirewall(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallSaveResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/save${firewallProviderQuery(provider)}`, {
      method: 'POST',
      timeoutMs: 60_000,
      signal: options.signal,
    })
  }

sessionFirewallPersistenceStatus(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallPersistenceStatus>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/status${firewallProviderQuery(provider)}`, {
      timeoutMs: 20_000,
      signal: options.signal,
    })
  }

sessionFirewallPersistenceInstallPlan(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallInstallPlan>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/install-plan${firewallProviderQuery(provider)}`, {
      method: 'POST',
      timeoutMs: 20_000,
      signal: options.signal,
    })
  }

installSessionFirewallPersistence(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallPersistenceInstallResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/install${firewallProviderQuery(provider)}`, {
      method: 'POST',
      body: { confirmed: true },
      timeoutMs: 190_000,
      signal: options.signal,
    })
  }

saveSessionFirewallPersistence(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallSaveResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/save${firewallProviderQuery(provider)}`, {
      method: 'POST',
      timeoutMs: 60_000,
      signal: options.signal,
    })
  }
}

function firewallProviderQuery(provider?: FirewallProvider) {
  if (!provider || provider === 'unsupported') {
    return ''
  }
  return `?${new URLSearchParams({ provider }).toString()}`
}

function normalizeFirewallProviderList(list: FirewallProviderList): FirewallProviderList {
  return {
    ...list,
    providers: normalizeArray(list.providers),
  }
}

function normalizeFirewallCapability(capability: FirewallCapability): FirewallCapability {
  return {
    ...capability,
    detected_providers: normalizeArray(capability.detected_providers),
    unsupported_reasons: normalizeArray(capability.unsupported_reasons),
  }
}

function normalizeFirewallSnapshot(snapshot: FirewallSnapshot): FirewallSnapshot {
  return {
    ...snapshot,
    capability: normalizeFirewallCapability(snapshot.capability),
    rules: normalizeArray(snapshot.rules),
    unsupported_rules: normalizeArray(snapshot.unsupported_rules),
    warnings: normalizeArray(snapshot.warnings),
  }
}

function normalizeFirewallApplyResult(result: FirewallApplyResult): FirewallApplyResult {
  return {
    ...result,
    snapshot: normalizeFirewallSnapshot(result.snapshot),
  }
}
