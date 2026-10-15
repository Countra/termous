import type { AgentProgressActivity } from '#common/contracts'

// 重连快照可能落后于实时提示；同一模式已恢复后不能被迟到诊断覆盖。
export function mergeAgentProgress(previous: AgentProgressActivity | undefined, incoming: AgentProgressActivity): AgentProgressActivity {
  if (!previous) return incoming
  if (incoming.count < previous.count || previous.status === 'progressed' && (incoming.status === 'detected' || incoming.count === previous.count)) return previous
  return { ...incoming, after_part_sequence: previous.after_part_sequence, created_at: previous.created_at }
}
