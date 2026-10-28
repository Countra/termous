import type { AgentMessage, AgentMessagePart } from '#entities/agent'
import { readDesktopBatchContent } from '#common/desktop-batch'

type ToolResult = Extract<AgentMessagePart, { kind: 'tool_result' }>
type DesktopBatchSource = Extract<AgentMessagePart, { kind: 'tool_result' | 'task_result' }>
export type DesktopBatchResults = ReadonlyMap<string, DesktopBatchSource>

// 消息不可变；弱引用只缓存当前消息的索引，避免每个流式 token 重复解码全部历史回执。
const messageResults = new WeakMap<AgentMessage, DesktopBatchResults>()

function hasImage(part: DesktopBatchSource) {
  return part.kind === 'task_result' ? Boolean(part.task_result.image) : Boolean(part.tool_result.images?.length)
}

// 显式查询或等待可以消费完成回执，原调用仍需从持久化历史取得最终展示和真实图片来源。
export function indexDesktopBatchResults(messages: AgentMessage[]) {
  const sessions = new Map<string, Map<string, DesktopBatchSource>>()
  for (const message of messages) {
    let indexed = messageResults.get(message)
    if (!indexed) {
      const values = new Map<string, DesktopBatchSource>()
      for (const part of message.parts) {
        if (part.kind !== 'task_result' && part.kind !== 'tool_result') continue
        const result = part.kind === 'task_result' ? desktopTaskResultPart(part) : part
        const receipt = readDesktopBatchContent(result.tool_result.tool_name, result.tool_result.content)
        if (!receipt || receipt.state === 'running') continue
        const previous = values.get(receipt.id)
        if (!previous || !hasImage(previous) || hasImage(part)) values.set(receipt.id, part)
      }
      indexed = values
      messageResults.set(message, indexed)
    }
    if (!indexed.size) continue
    const results = sessions.get(message.session_id) ?? new Map<string, DesktopBatchSource>()
    for (const [id, source] of indexed) {
      const previous = results.get(id)
      // 同一终态的后续查询可能已失去缓存图片，不能覆盖历史中仍有效的原证据。
      if (!previous || !hasImage(previous) || hasImage(source)) results.set(id, source)
    }
    sessions.set(message.session_id, results)
  }
  return sessions
}

export function completedDesktopBatchResult(result: ToolResult, completed: DesktopBatchResults | undefined) {
  const receipt = readDesktopBatchContent(result.tool_result.tool_name, result.tool_result.content)
  if (!receipt) return result
  const source = completed?.get(receipt.id)
  const observation = source?.kind === 'task_result' ? desktopTaskResultPart(source) : source
  // 账本已补齐终态时仍可采用原观察片段的图片，图片地址必须保持真实来源。
  return observation && (receipt.state === 'running' || !result.tool_result.images?.length && observation.tool_result.images?.length)
    ? observation : result
}

// 仅将观察投影到原工具记录；不改变持久化片段类型或制造第二次工具调用。
export function desktopTaskResultPart(part: Extract<AgentMessagePart, { kind: 'task_result' }>): Extract<AgentMessagePart, { kind: 'tool_result' }> {
  const { task_result: task, ...base } = part
  const run = task.result.run
  return { ...base, kind: 'tool_result', tool_result: {
    tool_call_id: task.tool_call_id, tool_name: 'termous.desktops.execute',
    content: [{ type: 'text', text: JSON.stringify(task.result) }],
    is_error: run.state !== 'completed' || Boolean(run.cleanup_error || run.report_error),
    images: task.image ? [{ content_index: 1, mime_type: task.image.mime_type, size_bytes: task.image.size_bytes }] : [],
  } }
}
