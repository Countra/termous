import { describe, expect, it } from 'vitest'
import { agentReasoningLevels, type AgentModel, type AgentSettings } from '#entities/agent'
import {
  createAgentModelDraft,
  isAgentModelDraftDirty,
  resolveEffectiveReasoningLevel,
  toAgentModelEditorValue,
  validateAgentModelDraft,
} from './agentModelEditorDraft.ts'

describe('Agent 模型编辑草稿', () => {
  it('新增模型只有初始空白态不脏，未填写 ID 时的其他修改仍需确认放弃', () => {
    const settings = settingsFixture()
    const draft = createAgentModelDraft(undefined, settings)

    expect(draft).toMatchObject({
      supportsImages: true,
      reasoningControl: 'openai_effort',
      supportedReasoningLevels: agentReasoningLevels,
    })
    expect(isAgentModelDraftDirty(draft, undefined, settings)).toBe(false)
    expect(isAgentModelDraftDirty({ ...draft, displayName: '本地别名' }, undefined, settings)).toBe(true)
    expect(isAgentModelDraftDirty({
      ...draft,
      contextWindowTokens: draft.contextWindowTokens + 1024,
    }, undefined, settings)).toBe(true)
  })

  it('编辑模型时忠实保留已经保存的能力配置', () => {
    const model: AgentModel = {
      ...modelFixture(),
      reasoning_control: 'none',
      supported_reasoning_levels: ['off'],
      supports_images: false,
    }

    expect(createAgentModelDraft(model, settingsFixture())).toMatchObject({
      supportsImages: false,
      reasoningControl: 'none',
      supportedReasoningLevels: ['off'],
    })
  })

  it('继承模式保留模型专属参数且不在切换时清空', () => {
    const model = modelFixture()
    const settings = settingsFixture()
    const draft = createAgentModelDraft(model, settings)
    const inherited = { ...draft, parameterMode: 'inherit_global' as const }

    expect(inherited.contextWindowTokens).toBe(model.context_window_tokens)
    expect(inherited.maxOutputTokens).toBe(model.max_output_tokens)
    expect(isAgentModelDraftDirty(inherited, model, settings)).toBe(true)
    expect(toAgentModelEditorValue(inherited)).toMatchObject({
      parameter_mode: 'inherit_global',
      context_window_tokens: model.context_window_tokens,
      max_output_tokens: model.max_output_tokens,
    })
  })

  it('有效推理默认值优先选择不高于请求的最高支持档位', () => {
    expect(resolveEffectiveReasoningLevel('max', ['off', 'low', 'high'])).toBe('high')
    expect(resolveEffectiveReasoningLevel('minimal', ['off', 'medium'])).toBe('off')
    expect(resolveEffectiveReasoningLevel('off', ['off', 'high'])).toBe('off')
    expect(resolveEffectiveReasoningLevel('off', ['high', 'minimal'])).toBe('minimal')
  })

  it('openai_effort 允许不含 off，但拒绝空档位集合', () => {
    const draft = createAgentModelDraft(modelFixture(), settingsFixture())
    const translate = (key: string) => key

    expect(validateAgentModelDraft({
      ...draft,
      supportedReasoningLevels: ['low', 'high'],
    }, translate)).toBeNull()
    expect(validateAgentModelDraft({
      ...draft,
      supportedReasoningLevels: [],
    }, translate)).toBe('settings.agent.validation.reasoningLevels')
    expect(validateAgentModelDraft({
      ...draft,
      supportedReasoningLevels: ['off'],
    }, translate)).toBe('settings.agent.validation.reasoningLevels')
  })

  it('none 推理控制只接受唯一的 off 档位', () => {
    const draft = createAgentModelDraft(modelFixture(), settingsFixture())
    const translate = (key: string) => key

    expect(validateAgentModelDraft({
      ...draft,
      reasoningControl: 'none',
      supportedReasoningLevels: ['off'],
      defaultReasoningLevel: 'off',
    }, translate)).toBeNull()
    expect(validateAgentModelDraft({
      ...draft,
      reasoningControl: 'none',
      supportedReasoningLevels: ['off', 'low'],
      defaultReasoningLevel: 'off',
    }, translate)).toBe('settings.agent.validation.reasoningLevels')
    expect(validateAgentModelDraft({
      ...draft,
      reasoningControl: 'none',
      supportedReasoningLevels: ['low'],
      defaultReasoningLevel: 'low',
    }, translate)).toBe('settings.agent.validation.reasoningLevels')
  })
})

function settingsFixture(): AgentSettings {
  return {
    default_reasoning_level: 'max',
    global_context_window_tokens: 16_384,
    global_max_output_tokens: 4_096,
    show_turn_token_usage: true,
    revision: 1,
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  }
}

function modelFixture(): AgentModel {
  return {
    id: 'model',
    provider_id: 'provider',
    remote_model_id: 'remote-model',
    display_name: 'Remote model',
    availability: 'available',
    source: 'manual',
    parameter_mode: 'custom',
    context_window_tokens: 65_536,
    max_output_tokens: 8_192,
    default_reasoning_level: 'high',
    reasoning_control: 'openai_effort',
    supported_reasoning_levels: ['off', 'low', 'high'],
    supports_images: false,
    supports_reasoning: true,
    capabilities_confirmed: true,
    effective_context_window_tokens: 65_536,
    effective_max_output_tokens: 8_192,
    effective_default_reasoning_level: 'high',
    first_seen_at: '2026-08-30T00:00:00Z',
    last_seen_at: '2026-08-30T00:00:00Z',
    revision: 1,
    created_at: '2026-08-30T00:00:00Z',
    updated_at: '2026-08-30T00:00:00Z',
  }
}
