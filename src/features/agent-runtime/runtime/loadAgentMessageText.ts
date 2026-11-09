import type { AgentMessage } from '#entities/agent'
import type { AgentWorkspaceGateway } from '../api/agentRuntimeGateway.ts'
import { timelineBoundary } from '../model/agentContentWindow.ts'

// 复制是显式读取，只拼接正文，不把完整片段或图片重新放入展示缓存。
export async function loadAgentMessageText(gateway: Pick<AgentWorkspaceGateway, 'messages'>, message: AgentMessage, signal?: AbortSignal) {
  let cursor = timelineBoundary(message.session_id, { ...message, parts: [] }, 'first')
  const text: string[] = []
  const failures = new Set<string>()
  for (;;) {
    signal?.throwIfAborted()
    const page = await gateway.messages(message.session_id, { view: 'timeline', direction: 'after', cursor, limit: 100, signal })
    if (page.items.some(item => item.session_id !== message.session_id)) throw new Error('AGENT_MESSAGE_OWNER_INVALID')
    const item = page.items.find(item => item.id === message.id)
    for (const part of item?.parts ?? []) {
      if (part.kind === 'text') text.push(part.text)
      if (part.response_failure && !failures.has(part.response_failure.attempt_id)) {
        failures.add(part.response_failure.attempt_id)
        text.push(part.response_failure.error_message)
      }
    }
    if (!item || page.items.some(item => item.sequence > message.sequence) || !page.has_newer) return text.join('\n\n')
    if (!page.after_cursor || page.after_cursor === cursor) throw new Error('AGENT_MESSAGE_CURSOR_INVALID')
    cursor = page.after_cursor
  }
}
