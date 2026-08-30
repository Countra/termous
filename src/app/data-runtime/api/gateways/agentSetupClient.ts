import type { AppConfig } from '#common/contracts'
import type {
  AgentModelCreateInput,
  AgentModelListQuery,
  AgentModelProviderInput,
  AgentModelProviderUpdateInput,
  AgentModelUpdateInput,
  AgentReasoningLevel,
} from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import {
  decodeAgentMcpPolicy,
  decodeAgentModel,
  decodeAgentModelCreateResult,
  decodeAgentModelPage,
  decodeAgentModelProvider,
  decodeAgentModelProviderPage,
  decodeAgentModelTestResult,
  decodeAgentProviderTestResult,
  decodeAgentReadiness,
  decodeAgentSettings,
  decodeAgentSetupResult,
} from '#features/agent-setup'
import { TermousApiTransport } from '#shared/api'

const agentPath = '/api/v1/agent'
const modelProbeTimeoutMs = 25_000

export class AgentSetupClient extends TermousApiTransport implements AgentSetupGateway {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  settings(signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/settings`, { signal }).then(decodeAgentSettings)
  }

  updateSettings(input: {
    default_model_id: string
    default_reasoning_level: AgentReasoningLevel
    global_context_window_tokens: number
    global_max_output_tokens: number
    show_turn_token_usage: boolean
    expected_revision: number
  }, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/settings`, { method: 'PATCH', body: input, signal }).then(decodeAgentSettings)
  }

  readiness(signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/readiness`, { signal }).then(decodeAgentReadiness)
  }

  setup(signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/setup`, { method: 'POST', body: {}, signal }).then(decodeAgentSetupResult)
  }

  updateMcpPolicy(input: {
    approval_bypass: boolean
    sync_scopes: boolean
    expected_revision: number
  }, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/mcp-policy`, { method: 'PATCH', body: input, signal }).then(decodeAgentMcpPolicy)
  }

  modelProviders(cursor?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: '16' })
    if (cursor) query.set('cursor', cursor)
    return this.request<unknown>(`${agentPath}/model-providers?${query.toString()}`, { signal }).then(decodeAgentModelProviderPage)
  }

  createModelProvider(input: AgentModelProviderInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-providers`, { method: 'POST', body: input, signal }).then(decodeAgentModelProvider)
  }

  updateModelProvider(id: string, input: AgentModelProviderUpdateInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: input, signal }).then(decodeAgentModelProvider)
  }

  deleteModelProvider(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<void>(`${agentPath}/model-providers/${encodeURIComponent(id)}`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    })
  }

  testModelProvider(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-providers/${encodeURIComponent(id)}/test`, {
      method: 'POST', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentProviderTestResult)
  }

  refreshProviderModels(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-providers/${encodeURIComponent(id)}/models/refresh`, { method: 'POST', body: { expected_revision: expectedRevision }, signal }).then(decodeAgentModelProvider)
  }

  models(filter: AgentModelListQuery = {}, cursor?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: '100' })
    if (filter.provider_id) query.set('provider_id', filter.provider_id)
    if (filter.state) query.set('state', filter.state)
    if (filter.source) query.set('source', filter.source)
    if (cursor) query.set('cursor', cursor)
    return this.request<unknown>(`${agentPath}/models?${query.toString()}`, { signal }).then(decodeAgentModelPage)
  }

  model(id: string, signal?: AbortSignal) { return this.request<unknown>(`${agentPath}/models/${encodeURIComponent(id)}`, { signal }).then(decodeAgentModel) }
  createModel(providerId: string, input: AgentModelCreateInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-providers/${encodeURIComponent(providerId)}/models`, {
      method: 'POST', body: input, signal,
    }).then(decodeAgentModelCreateResult)
  }
  updateModel(id: string, input: AgentModelUpdateInput, signal?: AbortSignal) { return this.request<unknown>(`${agentPath}/models/${encodeURIComponent(id)}`, { method: 'PATCH', body: input, signal }).then(decodeAgentModel) }
  removeModel(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<void>(`${agentPath}/models/${encodeURIComponent(id)}`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    })
  }
  restoreModel(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/models/${encodeURIComponent(id)}/restore`, {
      method: 'POST', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentModel)
  }
  testModel(id: string, expectedRevision: number, signal?: AbortSignal) { return this.request<unknown>(`${agentPath}/models/${encodeURIComponent(id)}/test`, { method: 'POST', body: { expected_revision: expectedRevision, confirm_potential_cost: true }, signal, timeoutMs: modelProbeTimeoutMs }).then(decodeAgentModelTestResult) }
}
