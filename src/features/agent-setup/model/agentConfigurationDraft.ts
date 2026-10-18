import { defaultExecutionBudget, type ExecutionLimits } from '#common/contracts'
import type { AgentMcpPolicy, AgentReasoningLevel, AgentSettings } from '#entities/agent'

export interface AgentConfigurationDraft {
  defaultModelId: string
  defaultReasoningLevel: AgentReasoningLevel
  contextWindowTokens: number | null
  maxOutputTokens: number | null
  compactionThreshold: number | null
  maxConcurrentRuns: number
  connectOnBind: boolean
  showTokenUsage: boolean
  approvalBypass: boolean
  budgetEnabled: boolean
  model_requests: number | null
  total_tokens: number | null
  consecutive_failures: number | null
  selection_attempts: number | null
}

export const executionBudgetFields = [
  ['model_requests', 1, 500], ['total_tokens', 10_000, 10_000_000],
  ['consecutive_failures', 1, 10], ['selection_attempts', 1, 20],
] as const satisfies readonly (readonly [keyof ExecutionLimits, number, number])[]

export function createAgentConfigurationDraft(settings: AgentSettings, policy?: AgentMcpPolicy): AgentConfigurationDraft {
  const budget = settings.execution_budget ?? defaultExecutionBudget
  return {
    defaultModelId: settings.default_model_id ?? '',
    defaultReasoningLevel: settings.default_reasoning_level,
    contextWindowTokens: settings.global_context_window_tokens,
    maxOutputTokens: settings.global_max_output_tokens,
    compactionThreshold: settings.context_compaction_threshold_percent,
    maxConcurrentRuns: settings.max_concurrent_runs,
    connectOnBind: settings.connect_ssh_profile_on_bind,
    showTokenUsage: settings.show_turn_token_usage,
    approvalBypass: policy?.approval_bypass ?? false,
    budgetEnabled: budget.enabled,
    ...budget.limits,
  }
}

export function sameAgentConfiguration(left: AgentConfigurationDraft, right: AgentConfigurationDraft) {
  return (Object.keys(left) as (keyof AgentConfigurationDraft)[]).every(key => left[key] === right[key])
}

export function validateAgentConfiguration(draft: AgentConfigurationDraft, t: (key: string, args?: Record<string, unknown>) => string) {
  const errors: Partial<Record<keyof AgentConfigurationDraft, string>> = {}
  const integer = (value: number | null, min: number, max: number) => value !== null && Number.isSafeInteger(value) && value >= min && value <= max
  if (!integer(draft.contextWindowTokens, 1024, 2_000_000)) errors.contextWindowTokens = t('settings.agent.validation.contextWindow')
  if (!integer(draft.maxOutputTokens, 1, draft.contextWindowTokens ?? 0)) errors.maxOutputTokens = t('settings.agent.validation.tokenLimit')
  if (!integer(draft.compactionThreshold, 50, 95)) errors.compactionThreshold = t('settings.agent.compaction.validation')
  if (!integer(draft.maxConcurrentRuns, 1, 8)) errors.maxConcurrentRuns = t('settings.agent.configuration.invalidConcurrency')
  // 关闭限额也保留有效值，避免下次开启时提交空值或越界值。
  for (const [field, min, max] of executionBudgetFields) {
    if (!integer(draft[field], min, max)) errors[field] = t('settings.agent.executionLimits.validation', { min, max })
  }
  return errors
}

export function agentConfigurationSettings(draft: AgentConfigurationDraft) {
  // 调用方通过完整校验后才构造协议参数。
  return {
    default_model_id: draft.defaultModelId,
    default_reasoning_level: draft.defaultReasoningLevel,
    global_context_window_tokens: draft.contextWindowTokens!,
    global_max_output_tokens: draft.maxOutputTokens!,
    context_compaction_threshold_percent: draft.compactionThreshold!,
    max_concurrent_runs: draft.maxConcurrentRuns,
    connect_ssh_profile_on_bind: draft.connectOnBind,
    show_turn_token_usage: draft.showTokenUsage,
    execution_budget: {
      enabled: draft.budgetEnabled,
      limits: {
        model_requests: draft.model_requests!, total_tokens: draft.total_tokens!,
        consecutive_failures: draft.consecutive_failures!, selection_attempts: draft.selection_attempts!,
      },
    },
  }
}

// 外部仅修改无关字段时跟进确认值；有重叠修改时保留本地草稿并要求核对。
export function rebaseAgentConfiguration(baseline: AgentConfigurationDraft, draft: AgentConfigurationDraft, latest: AgentConfigurationDraft) {
  const next = { ...latest }
  let conflict = false
  for (const key of Object.keys(draft) as (keyof AgentConfigurationDraft)[]) {
    if (draft[key] === baseline[key]) continue
    if (latest[key] !== baseline[key] && latest[key] !== draft[key]) conflict = true
    Object.assign(next, { [key]: draft[key] })
  }
  return { draft: next, conflict }
}
