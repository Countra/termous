import type { AgentCompactionActivity, AgentMessage, AgentRunEvent } from '#entities/agent'

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
      mergeCompactionValue(previous, { ...activity, created_at: event.created_at }),
    ],
  }
}

export function mergeCompactionValue(previous: AgentCompactionActivity | undefined, incoming: AgentCompactionActivity): AgentCompactionActivity {
  if (previous && previous.status !== 'started' && incoming.status === 'started') return previous
  return { ...incoming,
    context_window_tokens: incoming.context_window_tokens ?? previous?.context_window_tokens,
    duration_ms: incoming.duration_ms ?? previous?.duration_ms,
    created_at: previous?.created_at ?? incoming.created_at,
  }
}
