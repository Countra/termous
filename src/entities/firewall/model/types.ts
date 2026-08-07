export type FirewallProvider = 'unsupported' | 'iptables' | 'nftables'

export type FirewallCapabilityStatus = 'ready' | 'unsupported' | 'permission_denied'

export type FirewallPrivilegeMode = 'none' | 'root' | 'sudo'

export type FirewallRuleDirection = 'inbound'

export type FirewallRuleFamily = 'ipv4' | 'ipv6'

export type FirewallRuleAction = 'allow' | 'drop' | 'reject'

export type FirewallRuleProtocol = 'any' | 'tcp' | 'udp' | 'icmp'

export interface FirewallProviderInfo {
  provider: FirewallProvider
  present: boolean
  version?: string
  backend?: string
  message?: string
}

export interface FirewallProviderOption {
  provider: FirewallProvider
  status: FirewallCapabilityStatus
  present: boolean
  version?: string
  backend?: string
  privilege: FirewallPrivilegeMode
  supports_apply: boolean
  supports_save: boolean
  supports_counters: boolean
  message?: string
  recommended: boolean
}

export interface FirewallProviderList {
  providers: FirewallProviderOption[]
  default_provider: FirewallProvider
  privilege: FirewallPrivilegeMode
}

export interface FirewallCapability {
  status: FirewallCapabilityStatus
  provider: FirewallProvider
  provider_version?: string
  iptables_backend?: string
  privilege: FirewallPrivilegeMode
  supports_apply: boolean
  supports_save: boolean
  supports_counters: boolean
  message?: string
  detected_providers: FirewallProviderInfo[]
  unsupported_reasons?: string[]
}

export interface FirewallPortRange {
  from: number
  to: number
}

export interface FirewallRule {
  id: string
  provider: FirewallProvider
  direction: FirewallRuleDirection
  family: FirewallRuleFamily
  action: FirewallRuleAction
  protocol: FirewallRuleProtocol
  source?: string
  ports?: FirewallPortRange[]
  description?: string
  enabled: boolean
  managed: boolean
  editable: boolean
  readonly_reason?: string
  source_provider?: FirewallProvider
  edit_provider?: FirewallProvider
  cross_provider?: boolean
  counters_available?: boolean
  hit_count?: number
  byte_count?: number
  remote_present?: boolean
  disabled_local?: boolean
  source_kind?: 'remote' | 'local_disabled'
  signature?: string
  raw_ref?: string
  chain?: string
  position?: number
}

export interface FirewallSnapshot {
  session_id?: string
  capability: FirewallCapability
  rules: FirewallRule[]
  unsupported_rules?: FirewallRule[]
  snapshot_version: string
  synced_at: string
  warnings?: string[]
  raw_snapshot_digest?: string
}

export interface FirewallRuleInput {
  id?: string
  raw_ref?: string
  direction: FirewallRuleDirection
  family: FirewallRuleFamily
  action: FirewallRuleAction
  protocol: FirewallRuleProtocol
  source: string
  ports: FirewallPortRange[]
  description: string
  enabled: boolean
}

export interface FirewallDesiredState {
  snapshot_version: string
  rules: FirewallRuleInput[]
  confirm_risk: boolean
}

export interface FirewallPlanChange {
  type: 'create' | 'update' | 'delete'
  rule_id: string
  before?: FirewallRule
  after?: FirewallRule
}

export interface FirewallPlan {
  provider: FirewallProvider
  snapshot_version: string
  changes: FirewallPlanChange[]
  risk_warnings?: string[]
  allowed: boolean
  message?: string
}

export interface FirewallApplyResult {
  snapshot: FirewallSnapshot
  plan: FirewallPlan
  applied: boolean
  message?: string
}

export type FirewallPersistenceStatusKind =
  | 'unsupported'
  | 'ready'
  | 'missing_tools'
  | 'permission_denied'
  | 'file_saved'
  | 'service_enabled'
  | 'partial'

export interface FirewallInstallCommand {
  id: string
  title: string
  command: string
  risk: 'low' | 'medium'
}

export interface FirewallInstallPlan {
  provider: FirewallProvider
  package_manager?: string
  commands: FirewallInstallCommand[]
  missing_tools?: string[]
  requires_root: boolean
  warnings?: string[]
  confirmation_required: boolean
}

export interface FirewallPersistenceStatus {
  provider: FirewallProvider
  supported: boolean
  status: FirewallPersistenceStatusKind
  home_dir?: string
  rules_path?: string
  metadata_path?: string
  service_name?: string
  service_installed: boolean
  service_enabled: boolean
  systemd_available: boolean
  missing_tools?: string[]
  package_manager?: string
  install_available: boolean
  install_plan?: FirewallInstallPlan
  last_saved_at?: string
  message?: string
  warnings?: string[]
}

export interface FirewallSaveResult {
  provider: FirewallProvider
  saved: boolean
  status?: FirewallPersistenceStatusKind
  rules_path?: string
  service_name?: string
  service_enabled: boolean
  requires_install: boolean
  install_plan?: FirewallInstallPlan
  message: string
  warnings?: string[]
}

export interface FirewallPersistenceInstallResult {
  provider: FirewallProvider
  success: boolean
  status: FirewallPersistenceStatus
  message: string
}
