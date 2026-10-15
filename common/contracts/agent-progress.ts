export interface AgentProgressData {
  pattern_id: string
  assistant_message_id: string
  after_part_sequence: number
  tool_name: string
  reason: 'repeated_observation' | 'repeated_failure' | 'cycle'
  status: 'detected' | 'progressed'
  count: number
  guidance: string
  next_tools: string[]
}

export interface AgentProgressActivity extends AgentProgressData {
  created_at: string
}

// 进展事件仅承载有界诊断，不携带工具输入、图片或授权凭据。
export function isAgentProgressData(value: unknown): value is AgentProgressData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  const text = (item: unknown, max: number) => typeof item === 'string' && item.length > 0 && item.length <= max && !item.includes('\0')
  return text(v.pattern_id, 128) && text(v.assistant_message_id, 128) && text(v.tool_name, 128)
    && Number.isSafeInteger(v.after_part_sequence) && Number(v.after_part_sequence) >= 0
    && ['repeated_observation', 'repeated_failure', 'cycle'].includes(String(v.reason))
    && ['detected', 'progressed'].includes(String(v.status))
    && Number.isSafeInteger(v.count) && Number(v.count) >= 1
    && text(v.guidance, 2048) && Array.isArray(v.next_tools) && v.next_tools.length <= 8
    && v.next_tools.every((name) => text(name, 128))
}
