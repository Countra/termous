import type { AgentMessage, AgentRunEvent } from '#entities/agent'

export function mergeAgentCompactionActivity(
  message: AgentMessage,
  event: Extract<AgentRunEvent, { kind: 'compaction' }>,
): AgentMessage {
  const activity = event.payload.compaction
  if (activity.assistant_message_id !== message.id) return message
  const compactions = message.compactions ?? []
  const previous = compactions.find(({ compaction_id }) => compaction_id === activity.compaction_id)
  if (previous && previous.status !== 'started' && activity.status === 'started') return message
  return {
    ...message,
    compactions: [
      ...compactions.filter(({ compaction_id }) => compaction_id !== activity.compaction_id),
      {
        ...activity,
        context_window_tokens: activity.context_window_tokens ?? previous?.context_window_tokens,
        duration_ms: activity.duration_ms ?? previous?.duration_ms,
        created_at: previous?.created_at ?? event.created_at,
      },
    ],
  }
}
