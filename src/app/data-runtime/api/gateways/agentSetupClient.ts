import type { AppConfig } from '#common/contracts'
import type { AgentModelProfileInput, AgentModelProfileUpdateInput, AgentReasoningLevel } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import {
  decodeAgentMcpPolicy,
  decodeAgentModelProfile,
  decodeAgentModelProfilePage,
  decodeAgentModelTestResult,
  decodeAgentReadiness,
  decodeAgentSettings,
  decodeAgentSetupResult,
} from '#features/agent-setup'
import { TermousApiTransport } from '#shared/api'

const agentPath = '/api/v1/agent'

export class AgentSetupClient extends TermousApiTransport implements AgentSetupGateway {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  settings(signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/settings`, { signal }).then(decodeAgentSettings)
  }

  updateSettings(input: {
    default_model_profile_id: string
    default_reasoning_level: AgentReasoningLevel
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

  modelProfiles(cursor?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: '32' })
    if (cursor) query.set('cursor', cursor)
    return this.request<unknown>(`${agentPath}/model-profiles?${query.toString()}`, { signal }).then(decodeAgentModelProfilePage)
  }

  createModelProfile(input: AgentModelProfileInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-profiles`, { method: 'POST', body: input, signal }).then(decodeAgentModelProfile)
  }

  updateModelProfile(id: string, input: AgentModelProfileUpdateInput, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: input, signal }).then(decodeAgentModelProfile)
  }

  deleteModelProfile(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<void>(`${agentPath}/model-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    })
  }

  testModelProfile(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-profiles/${encodeURIComponent(id)}/test`, {
      method: 'POST', body: { expected_revision: expectedRevision, confirm_potential_cost: true }, signal,
    }).then(decodeAgentModelTestResult)
  }

  replaceModelApiKey(id: string, apiKey: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-profiles/${encodeURIComponent(id)}/api-key`, {
      method: 'PUT', body: { api_key: apiKey, expected_revision: expectedRevision }, signal,
    }).then(decodeAgentModelProfile)
  }

  deleteModelApiKey(id: string, expectedRevision: number, signal?: AbortSignal) {
    return this.request<unknown>(`${agentPath}/model-profiles/${encodeURIComponent(id)}/api-key`, {
      method: 'DELETE', body: { expected_revision: expectedRevision }, signal,
    }).then(decodeAgentModelProfile)
  }
}
