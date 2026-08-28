import { describe, expect, it } from 'vitest'
import {
  AgentSetupProtocolError,
  decodeAgentModelProfile,
  decodeAgentModelProfilePage,
  decodeAgentModelTestResult,
  decodeAgentReadiness,
  decodeAgentSettings,
} from './agentSetupProtocol.ts'

describe('Agent setup protocol', () => {
  it('严格解析缺省默认模型、准备状态和 MCP 策略', () => {
    const readiness = decodeAgentReadiness(readinessFixture())

    expect(readiness.settings.default_model_profile_id).toBeUndefined()
    expect(readiness.mcp_policy).toMatchObject({
      approval_bypass: false,
      scope_count: 29,
      required_scope_count: 29,
      revision: 2,
    })
  })

  it('拒绝零 revision、非法时间和越界字段', () => {
    expect(() => decodeAgentSettings({
      ...settingsFixture(),
      revision: 0,
    })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentSettings({
      ...settingsFixture(),
      updated_at: 'not-a-time',
    })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModelProfile({
      ...profileFixture(),
      name: 'a'.repeat(81),
    })).toThrow(AgentSetupProtocolError)
    expect(() => decodeAgentModelProfile({
      ...profileFixture(),
      name: '模'.repeat(27),
    })).toThrow(AgentSetupProtocolError)
  })

  it('模型列表单页最多接受 32 项', () => {
    expect(decodeAgentModelProfilePage({
      items: Array.from({ length: 32 }, (_, index) => ({ ...profileFixture(), id: `amp-${index}` })),
    }).items).toHaveLength(32)
    for (const count of [33, 50]) {
      expect(() => decodeAgentModelProfilePage({
        items: Array.from({ length: count }, (_, index) => ({ ...profileFixture(), id: `amp-${index}` })),
      })).toThrow(AgentSetupProtocolError)
    }
  })

  it('拒绝包含凭据、查询参数或片段的模型地址', () => {
    for (const baseUrl of [
      'https://user:secret@example.test/v1',
      'https://example.test/v1?token=secret',
      'https://example.test/v1#fragment',
    ]) {
      expect(() => decodeAgentModelProfile({ ...profileFixture(), base_url: baseUrl })).toThrow(AgentSetupProtocolError)
    }
  })

  it('只接受稳定的模型测试状态', () => {
    expect(decodeAgentModelTestResult({ status: 'ready', latency_ms: 42, model_id: 'gpt-test', message: '' }).status).toBe('ready')
    expect(() => decodeAgentModelTestResult({ status: 'unknown', latency_ms: 42, model_id: 'gpt-test', message: '' })).toThrow(AgentSetupProtocolError)
  })
})

function settingsFixture() {
  return {
    default_reasoning_level: 'off',
    revision: 1,
    created_at: '2026-08-28T00:00:00Z',
    updated_at: '2026-08-28T00:00:00Z',
  }
}

function readinessFixture() {
  return {
    status: 'ready',
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

function profileFixture() {
  return {
    id: 'amp-1', name: 'Local model', api_mode: 'responses', base_url: 'https://example.test/v1',
    model_id: 'gpt-test', context_window_tokens: 8192, max_output_tokens: 1024,
    supports_images: false, supports_reasoning: true, api_key_configured: false,
    revision: 1, created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z',
  }
}
