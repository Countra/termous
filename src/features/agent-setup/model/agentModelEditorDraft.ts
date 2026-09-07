import {
  agentReasoningLevels,
  type AgentModel,
  type AgentModelCreateInput,
  type AgentReasoningLevel,
  type AgentSettings,
} from '#entities/agent'

export type AgentModelEditorValue = Omit<AgentModelCreateInput, 'expected_revision'>

export interface AgentModelDraft {
  remoteModelId: string
  displayName: string
  parameterMode: 'inherit_global' | 'custom'
  contextWindowTokens: number
  maxOutputTokens: number
  defaultReasoningLevel: AgentReasoningLevel
  supportsImages: boolean
  reasoningControl: 'none' | 'openai_effort'
  supportedReasoningLevels: AgentReasoningLevel[]
}

export function createAgentModelDraft(model?: AgentModel, settings?: AgentSettings): AgentModelDraft {
  return {
    remoteModelId: model?.remote_model_id ?? '',
    displayName: model && model.display_name !== model.remote_model_id ? model.display_name : '',
    parameterMode: model?.parameter_mode ?? 'inherit_global',
    contextWindowTokens: model?.context_window_tokens ?? settings?.global_context_window_tokens ?? 16_384,
    maxOutputTokens: model?.max_output_tokens ?? settings?.global_max_output_tokens ?? 4_096,
    defaultReasoningLevel: model?.default_reasoning_level ?? settings?.default_reasoning_level ?? 'off',
    supportsImages: model?.supports_images ?? true,
    reasoningControl: model?.reasoning_control ?? 'openai_effort',
    supportedReasoningLevels: model?.supported_reasoning_levels ?? [...agentReasoningLevels],
  }
}

export function toAgentModelEditorValue(draft: AgentModelDraft): AgentModelEditorValue {
  const remoteModelId = draft.remoteModelId.trim()
  return {
    remote_model_id: remoteModelId,
    display_name: draft.displayName.trim() || remoteModelId,
    parameter_mode: draft.parameterMode,
    context_window_tokens: draft.contextWindowTokens,
    max_output_tokens: draft.maxOutputTokens,
    default_reasoning_level: draft.defaultReasoningLevel,
    supports_images: draft.supportsImages,
    reasoning_control: draft.reasoningControl,
    supported_reasoning_levels: draft.supportedReasoningLevels,
    capabilities_confirmed: true,
  }
}

export function isAgentModelDraftDirty(
  draft: AgentModelDraft,
  model?: AgentModel,
  settings?: AgentSettings,
) {
  const initial = createAgentModelDraft(model, settings)
  return draft.remoteModelId !== initial.remoteModelId
    || draft.displayName !== initial.displayName
    || draft.parameterMode !== initial.parameterMode
    || draft.contextWindowTokens !== initial.contextWindowTokens
    || draft.maxOutputTokens !== initial.maxOutputTokens
    || draft.defaultReasoningLevel !== initial.defaultReasoningLevel
    || draft.supportsImages !== initial.supportsImages
    || draft.reasoningControl !== initial.reasoningControl
    || draft.supportedReasoningLevels.join('|') !== initial.supportedReasoningLevels.join('|')
}

export function validateAgentModelDraft(draft: AgentModelDraft, t: (key: string) => string) {
  const modelId = draft.remoteModelId.trim()
  if (!modelId) return t('settings.agent.validation.modelId')
  if (new TextEncoder().encode(modelId).byteLength > 200 || containsControlCharacter(modelId)) {
    return t('settings.agent.validation.modelIdInvalid')
  }
  if (new TextEncoder().encode(draft.displayName.trim()).byteLength > 200) {
    return t('settings.agent.validation.displayNameTooLarge')
  }
  if (!Number.isInteger(draft.contextWindowTokens) || !Number.isInteger(draft.maxOutputTokens)) {
    return t('settings.agent.validation.integerTokens')
  }
  if (draft.contextWindowTokens < 1024 || draft.contextWindowTokens > 2_000_000) {
    return t('settings.agent.validation.contextWindow')
  }
  if (draft.maxOutputTokens < 1 || draft.maxOutputTokens > draft.contextWindowTokens) {
    return t('settings.agent.validation.tokenLimit')
  }
  if (draft.reasoningControl === 'none'
    && (draft.supportedReasoningLevels.length !== 1 || draft.supportedReasoningLevels[0] !== 'off')) {
    return t('settings.agent.validation.reasoningLevels')
  }
  if (draft.reasoningControl === 'openai_effort'
    && draft.supportedReasoningLevels.every((level) => level === 'off')) {
    return t('settings.agent.validation.reasoningLevels')
  }
  if (draft.parameterMode === 'custom'
    && !draft.supportedReasoningLevels.includes(draft.defaultReasoningLevel)) {
    return t('settings.agent.validation.defaultReasoning')
  }
  return null
}

export function resolveEffectiveReasoningLevel(
  requested: AgentReasoningLevel,
  supported: AgentReasoningLevel[],
) {
  if (supported.includes(requested)) return requested
  const requestedRank = agentReasoningLevels.indexOf(requested)
  for (let index = agentReasoningLevels.length - 1; index >= 0; index -= 1) {
    const candidate = agentReasoningLevels[index]!
    if (index <= requestedRank && supported.includes(candidate)) return candidate
  }
  return agentReasoningLevels.find((candidate) => supported.includes(candidate)) ?? 'off'
}

function containsControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}
