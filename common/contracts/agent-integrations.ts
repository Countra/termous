export interface MCPIntegrationConfig {
  mode?: 'managed_npm' | 'external'
	dependency_id?: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  auth?: 'none' | 'headers' | 'oauth' | ''
  environment_keys?: string[]
  header_keys?: string[]
}

export interface MCPDependencyLaunch { command: string; args: string[] }
export interface MCPDependency {
  activation_requested?: boolean
  cancel_requested?: boolean
  operation?: 'install' | 'repair'
  root?: string
  diagnostic?: import('./local-integrations.ts').IntegrationDiagnostic
  id: string
  source_id: string
  revision: number
  state: 'resolving' | 'preview' | 'preparing' | 'verifying' | 'ready' | 'failed' | 'cancelled' | 'uncertain'
  package: { name: string; version: string; integrity: string; entry: string; arguments: string[] }
  runtime: { node: string; npm: string; identity: string }
  task_id?: string
  error?: string
  launch?: MCPDependencyLaunch
}
export interface MCPDependencyOutput {
  stdout: MCPDependencyOutputStream
  stderr: MCPDependencyOutputStream
}
export interface MCPDependencyOutputStream {
  text: string
  next_offset: number
  truncated: boolean
  tail?: { offset: number; text: string }
}

export interface ImportedSkillFile {
  path: string
  mime_type: string
  object: { sha256: string; size_bytes: number }
}

export interface ImportedSkillManifest {
  version: string
  name: string
  description: string
  allow_implicit: boolean
  metadata?: Record<string, unknown>
  files: ImportedSkillFile[]
}

export interface AgentIntegrationSource {
  startup_confirmed?: boolean
  auth_state?: 'required' | 'authorized' | ''
  skill_selected?: boolean
  id: string
  kind: 'mcp' | 'skill'
  name: string
  enabled: boolean
  revision: number
  mcp?: MCPIntegrationConfig
  skill?: ImportedSkillManifest
  secret_configured: boolean
  created_at: string
  updated_at: string
}

export interface IntegrationSkillRead {
  image_ref?: import('./content-resources.ts').ImageResourceReference
  resource?: IntegrationContentReference
  path: string
  mime_type: string
  sha256: string
  size_bytes: number
  offset: number
  next_offset: number
  done: boolean
  text?: string
  data?: string
  files?: ImportedSkillFile[]
  missing_dependencies?: string[]
}

export interface MCPIntegrationInput {
  name: string
  mcp: MCPIntegrationConfig
  secret?: { environment?: Record<string, string>; headers?: Record<string, string> }
  expected_revision: number
}

export interface SkillImportPreview {
  token: string
  manifest: ImportedSkillManifest
  warnings: string[]
}

export interface IntegrationToolSummary {
  source_id: string
  source_revision: number
  name: string
  title?: string
  description?: string
  contract_hash: string
  unavailable_reason?: string
}

export interface IntegrationCallReceipt {
  generation?: number
  result?: IntegrationToolResult
  id: string
  state: 'prepared' | 'dispatched' | 'completed' | 'uncertain' | 'denied' | 'not_dispatched'
  may_dispatch: boolean
}

export interface IntegrationContentReference {
  id: string
  mime_type: string
  object: { sha256: string; size_bytes: number }
}
export interface IntegrationToolResult {
  content: Array<{ type: 'text'; text: string; resource_image?: import('./content-resources.ts').ImageResourceReference }>
  isError?: boolean
  operation?: string
  connection_generation?: string
}

export interface IntegrationConnectionStatus {
  status_revision?: number
  started_at?: string
  updated_at?: string
  source: string
  revision: number
  state: 'queued' | 'starting' | 'handshaking' | 'listing' | 'connected' | 'disconnected' | 'failed' | 'closing' | 'auth_required'
  session_id?: string
  diagnostic?: import('./local-integrations.ts').IntegrationDiagnostic
  active: number
  queued: number
}
