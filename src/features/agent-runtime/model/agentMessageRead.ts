import type { AgentMessage } from '#entities/agent'
import { replaceAgentMessages, type AgentWorkspaceState } from './agentWorkspaceState.ts'

export function applyAgentMessageRead(
  current: AgentWorkspaceState,
  sessionId: string,
  incoming: AgentMessage[],
  baseline: readonly AgentMessage[],
): AgentWorkspaceState {
  const previous = new Map(baseline.map(message => [message.id, message]))
  // 查询期间收到的实体仍然有效；查询前已有但权威列表已移除的消息不能被保留。
  const concurrent = (current.messages[sessionId] ?? []).filter(message => previous.get(message.id) !== message)
  return replaceAgentMessages(current, sessionId, [...incoming, ...concurrent])
}
