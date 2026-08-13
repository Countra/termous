import type {
  FirewallApplyResult,
  FirewallCapability,
  FirewallDesiredState,
  FirewallInstallPlan,
  FirewallPersistenceInstallResult,
  FirewallPersistenceStatus,
  FirewallPlan,
  FirewallProvider,
  FirewallProviderList,
  FirewallSaveResult,
  FirewallSnapshot,
} from '#entities/firewall'

interface FirewallRequestOptions {
  signal?: AbortSignal
}

export interface FirewallGateway {
  sessionFirewallProviders(sessionId: string, options?: FirewallRequestOptions): Promise<FirewallProviderList>
  sessionFirewallCapability(
    sessionId: string,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallCapability>
  sessionFirewallSnapshot(
    sessionId: string,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallSnapshot>
  previewSessionFirewall(
    sessionId: string,
    desired: FirewallDesiredState,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallPlan>
  applySessionFirewall(
    sessionId: string,
    desired: FirewallDesiredState,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallApplyResult>
  saveSessionFirewall(
    sessionId: string,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallSaveResult>
  sessionFirewallPersistenceStatus(
    sessionId: string,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallPersistenceStatus>
  sessionFirewallPersistenceInstallPlan(
    sessionId: string,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallInstallPlan>
  installSessionFirewallPersistence(
    sessionId: string,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallPersistenceInstallResult>
  saveSessionFirewallPersistence(
    sessionId: string,
    provider?: FirewallProvider,
    options?: FirewallRequestOptions,
  ): Promise<FirewallSaveResult>
}

export interface FirewallSessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
}

export interface FirewallHostContext {
  platform?: string
}
