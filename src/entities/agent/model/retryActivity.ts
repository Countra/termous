import type { AgentRetryActivity } from './types.ts'

export function mergeAgentRetryActivity(
  previous: AgentRetryActivity | undefined,
  incoming: AgentRetryActivity,
): AgentRetryActivity {
  if (!previous) return incoming
  // 历史快照可能领先于补拉事件；终态和已开始的请求不能被旧阶段覆盖。
  if (previous.status !== 'waiting' && previous.status !== 'requesting') {
    return previous.status === incoming.status && previous.attempt === incoming.attempt
      && previous.duration_ms === undefined && incoming.duration_ms !== undefined
      ? { ...previous, duration_ms: incoming.duration_ms } : previous
  }
  const active = incoming.status === 'waiting' || incoming.status === 'requesting'
  const progress = (activity: AgentRetryActivity) => activity.attempt * 2 + (activity.status === 'waiting' ? 1 : 0)
  if (incoming.attempt < previous.attempt || (active && progress(incoming) < progress(previous))) return previous
  return {
    ...incoming,
    assistant_message_id: previous.assistant_message_id,
    purpose: previous.purpose,
    after_part_sequence: previous.after_part_sequence,
    created_at: previous.created_at,
    duration_ms: incoming.duration_ms ?? previous.duration_ms,
  }
}
