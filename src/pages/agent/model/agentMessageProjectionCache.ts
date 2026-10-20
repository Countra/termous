import type { AgentMessage, AgentRun, AgentRunEvent } from '#entities/agent'
import type { AgentWorkspaceMessage } from '#widgets/agent-workspace'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

const noEvents: AgentRunEvent[] = []

export function createAgentMessageProjector() {
  // 实体按不可变方式更新；弱引用仅复用当前实体的投影，不累计历次流式正文。
  const cache = new WeakMap<AgentMessage, {
    run: AgentRun | undefined
    events: AgentRunEvent[]
    value: AgentWorkspaceMessage
  }>()
  return (messages: AgentMessage[], run: AgentRun | undefined, events: AgentRunEvent[]) => messages.map(message => {
    const matchingRun = run?.session_id === message.session_id && run.assistant_message_id === message.id ? run : undefined
    const relevantEvents = matchingRun || message.status === 'pending' || message.status === 'streaming' ? events : noEvents
    const cached = cache.get(message)
    if (cached && cached.run === matchingRun && cached.events === relevantEvents) return cached.value
    const value = projectAgentMessages([message], matchingRun, relevantEvents)[0]!
    cache.set(message, { run: matchingRun, events: relevantEvents, value })
    return value
  })
}
