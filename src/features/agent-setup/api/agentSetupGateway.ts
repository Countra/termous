import type {
  AgentMcpPolicy,
  AgentModelProfile,
  AgentModelProfileInput,
  AgentModelProfilePage,
  AgentModelProfileUpdateInput,
  AgentModelTestResult,
  AgentReadiness,
  AgentReasoningLevel,
  AgentSettings,
} from '#entities/agent'

export interface AgentSetupGateway {
  settings(signal?: AbortSignal): Promise<AgentSettings>
  updateSettings(input: {
    default_model_profile_id: string
    default_reasoning_level: AgentReasoningLevel
    expected_revision: number
  }, signal?: AbortSignal): Promise<AgentSettings>
  readiness(signal?: AbortSignal): Promise<AgentReadiness>
  setup(signal?: AbortSignal): Promise<AgentReadiness>
  updateMcpPolicy(input: {
    approval_bypass: boolean
    sync_scopes: boolean
    expected_revision: number
  }, signal?: AbortSignal): Promise<AgentMcpPolicy>
  modelProfiles(cursor?: string, signal?: AbortSignal): Promise<AgentModelProfilePage>
  createModelProfile(input: AgentModelProfileInput, signal?: AbortSignal): Promise<AgentModelProfile>
  updateModelProfile(id: string, input: AgentModelProfileUpdateInput, signal?: AbortSignal): Promise<AgentModelProfile>
  deleteModelProfile(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  testModelProfile(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentModelTestResult>
  replaceModelApiKey(id: string, apiKey: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentModelProfile>
  deleteModelApiKey(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentModelProfile>
}
