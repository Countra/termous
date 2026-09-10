export interface AgentDefaultModelStatus {
  available: boolean
  reason?: 'not_configured' | 'model_unavailable'
  model_id?: string
  model_name?: string
  provider_name?: string
}

export interface AgentDefaultModelStatusGateway {
  getDefaultModelStatus(options?: { signal?: AbortSignal }): Promise<AgentDefaultModelStatus>
}

export interface AgentDefaultModelStatusView {
  status: 'loading' | 'ready' | 'unavailable'
  label?: string
  reason?: 'not_configured' | 'model_unavailable' | 'status_unavailable' | 'desktop_required'
}

export function decodeAgentDefaultModelStatus(value: unknown): AgentDefaultModelStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent 默认模型状态无效')
  const source = value as Record<string, unknown>
  if (typeof source.available !== 'boolean') throw new Error('Agent 默认模型可用状态无效')
  if (source.available && source.reason !== undefined
    || !source.available && source.reason !== 'not_configured' && source.reason !== 'model_unavailable') {
    throw new Error('Agent 默认模型不可用原因无效')
  }
  const result: AgentDefaultModelStatus = { available: source.available }
  if (!source.available) result.reason = source.reason as AgentDefaultModelStatus['reason']
  for (const key of ['model_id', 'model_name', 'provider_name'] as const) {
    const field = source[key]
    if (field === undefined && !source.available) continue
    if (typeof field !== 'string' || !field.trim() || field.length > 1024 || field.includes('\0')) {
      throw new Error('Agent 默认模型标识无效')
    }
    result[key] = field
  }
  return result
}

export function agentDefaultModelReasonKey(reason: string | undefined) {
  if (reason === 'desktop_required') return 'terminal.aiCompletion.desktopRequired'
  if (reason === 'not_configured') return 'terminal.aiCompletion.modelNotConfigured'
  if (reason === 'model_unavailable') return 'terminal.aiCompletion.modelUnavailable'
  return 'terminal.aiCompletion.modelStatusFailed'
}
