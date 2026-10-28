import type { AgentMessage, AgentMessagePart } from '#entities/agent'
import { readDesktopBatchContent } from '#common/desktop-batch'

type ToolResult = Extract<AgentMessagePart, { kind: 'tool_result' }>

// 显式查询或等待可以消费完成回执，原调用仍需从持久化历史取得最终展示和真实图片来源。
export function indexDesktopBatchResults(messages: AgentMessage[]) {
  const sessions = new Map<string, Map<string, ToolResult>>()
  for (const message of messages) for (const part of message.parts) {
    const result = part.kind === 'task_result' ? desktopTaskResultPart(part) : part.kind === 'tool_result' ? part : undefined
    if (!result) continue
    const receipt = readDesktopBatchContent(result.tool_result.tool_name, result.tool_result.content)
    if (!receipt || receipt.state === 'running') continue
    const results = sessions.get(message.session_id) ?? new Map<string, ToolResult>()
    const previous = results.get(receipt.id)
    // 同一终态的后续查询可能已失去缓存图片，不能覆盖历史中仍有效的原证据。
    if (!previous?.tool_result.images?.length || result.tool_result.images?.length) results.set(receipt.id, result)
    sessions.set(message.session_id, results)
  }
  return sessions
}

export function completedDesktopBatchResult(result: ToolResult, completed: ReadonlyMap<string, ToolResult> | undefined) {
  const receipt = readDesktopBatchContent(result.tool_result.tool_name, result.tool_result.content)
  return receipt?.state === 'running' ? completed?.get(receipt.id) ?? result : result
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
