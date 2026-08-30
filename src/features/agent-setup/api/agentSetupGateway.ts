import type {
  AgentMcpPolicy,
  AgentModel,
  AgentModelCreateInput,
  AgentModelCreateResult,
  AgentModelListQuery,
  AgentModelPage,
  AgentModelProvider,
  AgentModelProviderInput,
  AgentModelProviderPage,
  AgentModelProviderUpdateInput,
  AgentModelTestResult,
  AgentModelUpdateInput,
  AgentProviderTestResult,
  AgentReadiness,
  AgentReasoningLevel,
  AgentSettings,
} from '#entities/agent'

export interface AgentSetupGateway {
  settings(signal?: AbortSignal): Promise<AgentSettings>
  updateSettings(input: {
    default_model_id: string
    default_reasoning_level: AgentReasoningLevel
    global_context_window_tokens: number
    global_max_output_tokens: number
    show_turn_token_usage: boolean
    expected_revision: number
  }, signal?: AbortSignal): Promise<AgentSettings>
  readiness(signal?: AbortSignal): Promise<AgentReadiness>
  setup(signal?: AbortSignal): Promise<AgentReadiness>
  updateMcpPolicy(input: {
    approval_bypass: boolean
    sync_scopes: boolean
    expected_revision: number
  }, signal?: AbortSignal): Promise<AgentMcpPolicy>
  modelProviders(cursor?: string, signal?: AbortSignal): Promise<AgentModelProviderPage>
  createModelProvider(input: AgentModelProviderInput, signal?: AbortSignal): Promise<AgentModelProvider>
  updateModelProvider(id: string, input: AgentModelProviderUpdateInput, signal?: AbortSignal): Promise<AgentModelProvider>
  deleteModelProvider(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  testModelProvider(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentProviderTestResult>
  refreshProviderModels(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentModelProvider>
  models(query?: AgentModelListQuery, cursor?: string, signal?: AbortSignal): Promise<AgentModelPage>
  model(id: string, signal?: AbortSignal): Promise<AgentModel>
  createModel(providerId: string, input: AgentModelCreateInput, signal?: AbortSignal): Promise<AgentModelCreateResult>
  updateModel(id: string, input: AgentModelUpdateInput, signal?: AbortSignal): Promise<AgentModel>
  removeModel(id: string, expectedRevision: number, signal?: AbortSignal): Promise<void>
  restoreModel(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentModel>
  testModel(id: string, expectedRevision: number, signal?: AbortSignal): Promise<AgentModelTestResult>
}
