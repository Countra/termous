import { describe, expect, it } from 'vitest'
import {
  AgentSetupProtocolError,
  decodeAgentModel,
  decodeAgentModelPage,
  decodeAgentModelProvider,
  decodeAgentModelProviderPage,
  decodeAgentModelTestResult,
  decodeAgentReadiness,
  decodeAgentSettings,
} from './agentSetupProtocol.ts'

describe('Agent setup protocol', () => {
  it('严格解析缺省默认模型、准备状态和 MCP 策略', () => {
    const readiness = decodeAgentReadiness(readinessFixture())
    expect(readiness.settings.default_model_id).toBeUndefined()
    expect(readiness.settings.show_turn_token_usage).toBe(true)
    expect(readiness.mcp_policy).toMatchObject({
      approval_bypass: false, scope_count: 29, required_scope_count: 29, revision: 2,
    })
  })

  it('拒绝零 revision、非法时间和越界 UTF-8 字段', () => {
    expect(() => decodeAgentSettings({ ...settingsFixture(), revision: 0 })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentSettings({ ...settingsFixture(), updated_at: 'not-a-time' })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentSettings({ ...settingsFixture(), show_turn_token_usage: 'yes' })).toThrow(AgentSetupProtocolError)
    const missingTurnUsageSetting: Record<string, unknown> = { ...settingsFixture() }
    delete missingTurnUsageSetting.show_turn_token_usage
    expect(() => decodeAgentSettings(missingTurnUsageSetting)).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModelProvider({ ...providerFixture(), name: '模'.repeat(27) })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModel({ ...modelFixture(), display_name: '模'.repeat(67) })).toThrow(AgentSetupProtocolError)
  })

  it('拒绝 Provider 与模型文本中的 ASCII 控制字符', () => {
    expect(() => decodeAgentModelProvider({ ...providerFixture(), name: 'Local\nProvider' })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModel({ ...modelFixture(), remote_model_id: 'gpt\u0000test' })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModel({ ...modelFixture(), display_name: 'GPT\tTest' })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModel({ ...modelFixture(), owned_by: 'owner\u007f' })).toThrow(AgentSetupProtocolError)
  })

  it('严格限制 Provider 与模型分页大小和重复 ID', () => {
    expect(decodeAgentModelProviderPage({ items: Array.from({ length: 16 }, (_, index) => ({ ...providerFixture(), id: `apv-${index}` })) }).items).toHaveLength(16)
    expect(() => decodeAgentModelProviderPage({ items: Array.from({ length: 17 }, (_, index) => ({ ...providerFixture(), id: `apv-${index}` })) })).toThrow(AgentSetupProtocolError)
    expect(decodeAgentModelPage({ items: Array.from({ length: 100 }, (_, index) => ({ ...modelFixture(), id: `apm-${index}`, remote_model_id: `model-${index}` })) }).items).toHaveLength(100)
    expect(() => decodeAgentModelPage({ items: [{ ...modelFixture() }, { ...modelFixture() }] })).toThrow(AgentSetupProtocolError)
  })

  it('拒绝包含凭据、查询参数或片段的 Provider 地址', () => {
    for (const baseUrl of [
      'https://user:secret@example.test/v1',
      'https://example.test/v1?token=secret',
      'https://example.test/v1#fragment',
    ]) {
      expect(() => decodeAgentModelProvider({ ...providerFixture(), base_url: baseUrl })).toThrow(AgentSetupProtocolError)
    }
  })

  it('只接受稳定的模型测试状态', () => {
    expect(decodeAgentModelTestResult({ status: 'ready', latency_ms: 42, model_id: 'gpt-test', message: '' }).status).toBe('ready')
    expect(() => decodeAgentModelTestResult({ status: 'unknown', latency_ms: 42, model_id: 'gpt-test', message: '' })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModelTestResult({ status: 'ready', latency_ms: 42, model_id: 'gpt\nsecret', message: '' })).toThrow(AgentSetupProtocolError)
  })

  it('允许 openai_effort 明确声明不含关闭项的推理档位', () => {
    expect(decodeAgentModel({
      ...modelFixture(),
      reasoning_control: 'openai_effort',
      supported_reasoning_levels: ['low', 'high'],
      default_reasoning_level: 'off',
      effective_default_reasoning_level: 'low',
      supports_reasoning: true,
    }).supported_reasoning_levels).toEqual(['low', 'high'])

    expect(() => decodeAgentModel({
      ...modelFixture(),
      reasoning_control: 'none',
      supported_reasoning_levels: ['off', 'low'],
      supports_reasoning: false,
    })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModel({
      ...modelFixture(),
      reasoning_control: 'openai_effort',
      supported_reasoning_levels: ['off'],
      supports_reasoning: true,
    })).toThrow(AgentSetupProtocolError)
  })
})

function settingsFixture() {
  return {
    default_reasoning_level: 'off', global_context_window_tokens: 16_384,
    global_max_output_tokens: 4_096, show_turn_token_usage: true, revision: 1,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}

function readinessFixture() {
  return {
    status: 'needs_setup',
    mcp_runtime: { status: 'ready', message: 'ready' },
    mcp_client: { status: 'ready', message: 'ready' },
    skills_bundle: { status: 'ready', message: 'ready' },
    default_model: { status: 'missing', message: 'missing' },
    mcp_policy: {
      client_id: 'mcp-client-1', approval_bypass: false, scope_count: 29,
      required_scope_count: 29, scope_sync_required: false, revision: 2,
    },
    settings: settingsFixture(),
  }
}

function providerFixture() {
  return {
    id: 'apv-1', name: 'Local provider', api_mode: 'responses', base_url: 'https://example.test/v1',
    enabled: true, api_key_configured: false, refresh_status: 'ready', revision: 1,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}

function modelFixture() {
  return {
    id: 'apm-1', provider_id: 'apv-1', remote_model_id: 'gpt-test', display_name: 'GPT Test',
    availability: 'available', source: 'sync', parameter_mode: 'custom',
    context_window_tokens: 8192, max_output_tokens: 1024, default_reasoning_level: 'off',
    reasoning_control: 'openai_effort', supported_reasoning_levels: ['off', 'minimal', 'low', 'medium', 'high'],
    supports_images: false, supports_reasoning: true, capabilities_confirmed: false,
    effective_context_window_tokens: 8192, effective_max_output_tokens: 1024,
    effective_default_reasoning_level: 'off',
    first_seen_at: '2026-08-28T00:00:00Z', last_seen_at: '2026-08-28T00:00:00Z', revision: 1,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}
