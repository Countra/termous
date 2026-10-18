import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent, ToolResultMessage } from '@earendil-works/pi-ai'
import type { RuntimeContextImageReference } from '../contracts/runtimeCheckpoint.ts'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'

export function runtimeImageHistory(ref: RuntimeContextImageReference, size: { width: number; height: number }, message: { timestamp: number; toolName: string }) {
  return { type: 'text' as const, text: JSON.stringify({ history_image: ref, ...size, observed_at: message.timestamp, source_tool: message.toolName,
    notice: '此处只保留历史图片引用，当前看不到像素。需要检查时调用 read_history_image；历史图片不能用于实时点击授权。' }) }
}

export function releaseRuntimeImage(image: ImageContent, history: ReturnType<typeof runtimeImageHistory>) {
  // SDK 循环、历史和压缩尾部共享内容块；确认落盘后原位释放，避免只换数组留下另一条强引用。
  Object.assign(image, history)
  Reflect.deleteProperty(image, 'data')
  Reflect.deleteProperty(image, 'mimeType')
}

export function runtimeMessageDetails(details: ToolResultMessage['details']): ToolResultMessage['details'] {
  const value: unknown = details
  if (!isMCPToolDetails(value) || !Array.isArray(value.result.content)
    || !value.result.content.some(block => block?.type === 'image')) return details
  // 图片的原始索引与正文由 message.content 持久化；运行详情保留结构化结果、错误及文本即可。
  return { ...value, result: { ...value.result, content: value.result.content.filter(block => block?.type !== 'image') } } as ToolResultMessage['details']
}

export function ownRuntimeImageMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map(message => {
    if (message.role === 'toolResult') return { ...message, details: runtimeMessageDetails(message.details), content: message.content.map(block => ({ ...block })) }
    if (message.role === 'user' && Array.isArray(message.content)) return { ...message, content: message.content.map(block => ({ ...block })) }
    return message
  })
}
