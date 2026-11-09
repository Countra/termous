export interface LocalNetworkSettings {
  enabled: boolean
  url: string
  bypass: string[]
}

export interface MCPIntegrationSettings {
  install_root: string
  install_timeout_seconds: number
  startup_timeout_seconds: number
}

export interface IntegrationConfiguration {
  network: LocalNetworkSettings
  settings: MCPIntegrationSettings
}

export interface IntegrationDiagnostic {
  code: string
  phase: string
  message: string
  elapsed_ms?: number
  timeout_ms?: number
  exit_code?: number
  diagnostic_id?: string
  detail?: string
}
