import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentModel } from '#entities/agent'
import { resolveAgentModelReasoningLevel } from './agentModelSelection.ts'

test('新模型支持当前档位时保持原值', () => {
  assert.equal(resolveAgentModelReasoningLevel(model(), 'high'), 'high')
})

test('新模型不支持当前档位时使用该模型有效默认值', () => {
  assert.equal(resolveAgentModelReasoningLevel(model({
    supported_reasoning_levels: ['off', 'low'],
    effective_default_reasoning_level: 'low',
  }), 'high'), 'low')
})

test('异常目录缺少有效默认值时保守关闭推理', () => {
  assert.equal(resolveAgentModelReasoningLevel(model({
    supported_reasoning_levels: ['off'],
    effective_default_reasoning_level: 'high',
  }), 'high'), 'off')
  assert.equal(resolveAgentModelReasoningLevel(undefined, 'max'), 'off')
})

function model(overrides: Partial<AgentModel> = {}): AgentModel {
  return {
    id: 'model', provider_id: 'provider', remote_model_id: 'remote-model', display_name: '模型',
    availability: 'available', source: 'manual', parameter_mode: 'custom',
    context_window_tokens: 16_384, max_output_tokens: 4_096, default_reasoning_level: 'high',
    reasoning_control: 'openai_effort', supported_reasoning_levels: ['off', 'high'],
    supports_images: false, supports_reasoning: true, capabilities_confirmed: true,
    effective_context_window_tokens: 16_384, effective_max_output_tokens: 4_096,
    effective_default_reasoning_level: 'high', revision: 1,
    first_seen_at: '2026-08-30T00:00:00Z', last_seen_at: '2026-08-30T00:00:00Z',
    created_at: '2026-08-30T00:00:00Z', updated_at: '2026-08-30T00:00:00Z',
    ...overrides,
  }
}
