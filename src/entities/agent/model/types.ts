export const agentApiModes = ['responses', 'chat_completions'] as const
export type AgentApiMode = (typeof agentApiModes)[number]

export const agentReasoningLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type AgentReasoningLevel = (typeof agentReasoningLevels)[number]

export const agentReadinessStates = ['ready', 'needs_setup', 'needs_repair', 'blocked'] as const
export type AgentReadinessState = (typeof agentReadinessStates)[number]

export const agentReadinessComponentStates = ['ready', 'missing', 'outdated', 'unavailable'] as const
export type AgentReadinessComponentState = (typeof agentReadinessComponentStates)[number]

export interface AgentSettings {
  default_model_profile_id?: string
  default_reasoning_level: AgentReasoningLevel
  revision: number
  created_at: string
  updated_at: string
}

export interface AgentReadinessComponent {
  status: AgentReadinessComponentState
  message: string
}

export interface AgentMcpPolicy {
  client_id: string
  approval_bypass: boolean
  scope_count: number
  required_scope_count: number
  scope_sync_required: boolean
  revision: number
}

export interface AgentReadiness {
  status: AgentReadinessState
  mcp_runtime: AgentReadinessComponent
  mcp_client: AgentReadinessComponent
  skills_bundle: AgentReadinessComponent
  default_model: AgentReadinessComponent
  mcp_policy?: AgentMcpPolicy
  settings: AgentSettings
}

export interface AgentModelProfile {
  id: string
  name: string
  api_mode: AgentApiMode
  base_url: string
  model_id: string
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
  supports_reasoning: boolean
  api_key_configured: boolean
  revision: number
  created_at: string
  updated_at: string
}

export interface AgentModelProfilePage {
  items: AgentModelProfile[]
  next_cursor?: string
}

export interface AgentModelProfileInput {
  name: string
  api_mode: AgentApiMode
  base_url: string
  model_id: string
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
  supports_reasoning: boolean
  confirm_insecure_http: boolean
}

export interface AgentModelProfileUpdateInput extends AgentModelProfileInput {
  expected_revision: number
}

export interface AgentModelTestResult {
  status: 'ready' | 'failed'
  latency_ms: number
  model_id: string
  message: string
}
