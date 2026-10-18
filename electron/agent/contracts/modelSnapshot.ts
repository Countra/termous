import { isExecutionBudget, type ExecutionBudget } from '#common/contracts'
import { isRecord } from './validation.ts'

export interface RuntimeModelSnapshot {
  execution_budget?: ExecutionBudget
  api_mode: 'responses' | 'chat_completions'
  base_url: string
  model_id: string
  provider_id: string
  provider_name: string
  model_display_name: string
  provider_revision: number
  model_revision: number
  context_window_tokens: number
  max_output_tokens: number
  supports_images: boolean
  reasoning_control: 'none' | 'openai_effort'
  supported_reasoning_levels: RuntimeReasoningLevel[]
  context_compaction_threshold_percent?: number
  force_context_compression?: boolean
}

export type RuntimeReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export function isRuntimeModelSnapshot(value: unknown): value is RuntimeModelSnapshot {
  return isRecord(value)
    && (value.api_mode === 'responses' || value.api_mode === 'chat_completions')
    && typeof value.base_url === 'string'
    && validProviderBaseURL(value.base_url)
    && typeof value.model_id === 'string'
    && value.model_id.length > 0
    && value.model_id.length <= 512
    && typeof value.provider_id === 'string'
    && value.provider_id.length > 0
    && value.provider_id.length <= 128
    && typeof value.provider_name === 'string'
    && value.provider_name.length > 0
    && value.provider_name.length <= 256
    && typeof value.model_display_name === 'string'
    && value.model_display_name.length > 0
    && value.model_display_name.length <= 512
    && Number.isSafeInteger(value.provider_revision)
    && Number(value.provider_revision) > 0
    && Number.isSafeInteger(value.model_revision)
    && Number(value.model_revision) > 0
    && Number.isSafeInteger(value.context_window_tokens)
    && Number(value.context_window_tokens) >= 1_024
    && Number(value.context_window_tokens) <= 2_000_000
    && Number.isSafeInteger(value.max_output_tokens)
    && Number(value.max_output_tokens) > 0
    && Number(value.max_output_tokens) <= Number(value.context_window_tokens)
    && typeof value.supports_images === 'boolean'
    && (value.force_context_compression === undefined || typeof value.force_context_compression === 'boolean')
    && (value.execution_budget === undefined || isExecutionBudget(value.execution_budget))
    && (value.context_compaction_threshold_percent === undefined
      || (Number.isInteger(value.context_compaction_threshold_percent)
        && Number(value.context_compaction_threshold_percent) >= 50
        && Number(value.context_compaction_threshold_percent) <= 95))
    && validReasoningConfiguration(value.reasoning_control, value.supported_reasoning_levels)
}

function validProviderBaseURL(value: string) {
  if (value.length === 0 || value.length > 2_048) {
    return false
  }
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

export function validReasoningLevel(value: unknown): value is RuntimeReasoningLevel {
  return value === 'off'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max'
}

function validReasoningConfiguration(
  control: unknown,
  levels: unknown,
): levels is RuntimeReasoningLevel[] {
  if ((control !== 'none' && control !== 'openai_effort')
    || !Array.isArray(levels)
    || levels.length === 0
    || !levels.every(validReasoningLevel)
    || new Set(levels).size !== levels.length) {
    return false
  }
  return control === 'none'
    ? levels.length === 1 && levels[0] === 'off'
    : levels.some((level) => level !== 'off')
}
