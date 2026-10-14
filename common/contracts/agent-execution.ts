export interface ExecutionLimits {
  consecutive_failures: number
  selection_attempts: number
  model_requests: number
  total_tokens: number
}

// 消息视图只保留最近请求明细；完整统计仍由 Core 事件存储持久化。
export const maxAgentMessageRequestUsage = 1000

export interface ExecutionBudget {
  enabled: boolean
  limits: ExecutionLimits
}

export const defaultExecutionBudget: ExecutionBudget = {
  enabled: false,
  limits: { consecutive_failures: 3, selection_attempts: 5, model_requests: 60, total_tokens: 500_000 },
}

export function isExecutionBudget(value: unknown): value is ExecutionBudget {
  if (typeof value != 'object' || value === null || Array.isArray(value)) return false
  const policy = value as Record<string, unknown>
  if (typeof policy.enabled !== 'boolean' || typeof policy.limits !== 'object' || policy.limits === null || Array.isArray(policy.limits)) return false
  const limits = policy.limits as Record<string, unknown>
  return Object.entries({ consecutive_failures: [1, 10], selection_attempts: [1, 20], model_requests: [1, 500], total_tokens: [10_000, 10_000_000] })
    .every(([key, [min, max]]) => Number.isSafeInteger(limits[key]) && Number(limits[key]) >= min! && Number(limits[key]) <= max!)
}
