import type { AgentSession } from '#entities/agent'
import type { AgentSessionListOptions, AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { AgentHistoryReadError } from './loadAgentMessages.ts'

export async function loadAgentSessions(
  gateway: Pick<AgentWorkspaceGateway, 'sessions'>,
  options: Omit<AgentSessionListOptions, 'limit' | 'cursor'> = {},
): Promise<AgentSession[]> {
  const sessions = new Map<string, AgentSession>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 100; page += 1) {
    options.signal?.throwIfAborted()
    const result = await gateway.sessions({ ...options, limit: 200, cursor })
    options.signal?.throwIfAborted()
    for (const session of result.items) {
      if (options.archived !== undefined && Boolean(session.archived_at) !== options.archived) {
        throw new AgentHistoryReadError('AGENT_SESSION_PAGE_INVALID')
      }
      const previous = sessions.get(session.id)
      // 翻页期间的真实活动可能移动条目；按版本合并，不能用旧页覆盖新的标题和归属。
      if (!previous || session.revision > previous.revision) sessions.set(session.id, session)
    }
    if (!result.next_cursor) return [...sessions.values()]
    if (cursors.has(result.next_cursor)) throw new AgentHistoryReadError('AGENT_SESSION_CURSOR_INVALID')
    cursors.add(result.next_cursor)
    cursor = result.next_cursor
  }
  throw new AgentHistoryReadError('AGENT_SESSION_PAGE_LIMIT')
}
