import type { AgentMessage, AgentRun, AgentRunEvent } from '#entities/agent'
import type { AgentWorkspaceMessage } from '#widgets/agent-workspace'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'
import { AgentToolDetailCache } from './agentToolDetailCache.ts'

const noEvents: AgentRunEvent[] = []

export function createAgentMessageProjector() {
  const toolDetails = new AgentToolDetailCache()
  let previous: AgentWorkspaceMessage[] = []
  // 实体按不可变方式更新；弱引用仅复用当前实体的投影，不累计历次流式正文。
  const cache = new WeakMap<AgentMessage, {
    run: AgentRun | undefined
    events: AgentRunEvent[]
    value: AgentWorkspaceMessage
  }>()
  return (messages: AgentMessage[], run: AgentRun | undefined, events: AgentRunEvent[]) => {
    const byId = new Map(previous.map(message => [message.id, message]))
    const result = messages.map(message => {
      const matchingRun = run?.session_id === message.session_id && run.assistant_message_id === message.id ? run : undefined
      const relevantEvents = matchingRun || message.status === 'pending' || message.status === 'streaming' ? events : noEvents
      const cached = cache.get(message)
      if (cached && cached.run === matchingRun && cached.events === relevantEvents) return cached.value
      let value = projectAgentMessages([message], matchingRun, relevantEvents, toolDetails)[0]!
      const old = byId.get(message.id)
      if (old) {
        // 同一长 Run 只更新变化的片段；工具详情和图片组件不随每个 token 重新渲染。
        const parts = new Map(old.parts.map(part => [part.id, part]))
        value.parts = value.parts.map(part => {
          const previousPart = parts.get(part.id)
          return sameView(previousPart, part) ? previousPart! : part
        })
        if (sameView(old, value)) value = old
      }
      cache.set(message, { run: matchingRun, events: relevantEvents, value })
      return value
    })
    if (result.length === previous.length && result.every((message, index) => message === previous[index])) return previous
    previous = result
    return result
  }
}

// 仅比较有界展示投影，不序列化工具正文，也不缓存历次消息版本。
function sameView(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key)
    && sameView((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}
