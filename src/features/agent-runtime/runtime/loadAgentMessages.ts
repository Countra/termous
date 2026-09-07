import type { AgentMessage } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'

export class AgentHistoryReadError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AgentHistoryReadError'
    this.code = code
  }
}

// 主工作区与归档预览共用历史校验，避免归档绕过消息归属和分页完整性检查。
export async function loadAgentMessages(
  gateway: Pick<AgentWorkspaceGateway, 'messages'>,
  sessionId: string,
  afterSequence = 0,
  signal?: AbortSignal,
  createError: (code: string) => Error = (code) => new AgentHistoryReadError(code),
) {
  const messages: AgentMessage[] = []
  const messageIDs = new Set<string>()
  const messageSequences = new Set<number>()
  const turnUsageRunIDs = new Set<string>()
  let cursor = afterSequence
  for (let page = 0; page < 100; page += 1) {
    signal?.throwIfAborted()
    const result = await gateway.messages(sessionId, { afterSequence: cursor, limit: 200, signal })
    signal?.throwIfAborted()
    for (const message of result.items) {
      if (message.session_id !== sessionId) throw createError('AGENT_MESSAGE_OWNER_INVALID')
      if (message.sequence <= cursor || messageIDs.has(message.id) || messageSequences.has(message.sequence)) {
        throw createError('AGENT_MESSAGE_PAGE_INVALID')
      }
      if (message.turn_usage && turnUsageRunIDs.has(message.turn_usage.run_id)) {
        throw createError('AGENT_MESSAGE_TURN_USAGE_DUPLICATE')
      }
      messageIDs.add(message.id)
      messageSequences.add(message.sequence)
      if (message.turn_usage) turnUsageRunIDs.add(message.turn_usage.run_id)
    }
    messages.push(...result.items)
    if (!result.next_after_sequence) return messages
    if (result.next_after_sequence <= cursor) throw createError('AGENT_MESSAGE_CURSOR_INVALID')
    cursor = result.next_after_sequence
    if (page === 99) throw createError('AGENT_MESSAGE_PAGE_LIMIT')
  }
  return messages
}
