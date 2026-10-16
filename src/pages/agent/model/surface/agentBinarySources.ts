import type { AgentDetachedBinary } from '#common/contracts'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'

// 子窗口只引用宿主已投影的内容；加载函数始终使用宿主目录中的原始元数据。
export function resolveAgentBinarySource(model: AgentSurfaceModel, request: Extract<AgentDetachedBinary, { source: unknown }>) {
  const workspace = model.workspace
  const messages = [...workspace?.messages ?? [], ...model.archive?.messages ?? []]
  if (request.kind === 'attachment') {
    const attachments = [
      ...messages.flatMap(message => message.attachments),
      ...workspace?.queued_turns.flatMap(turn => turn.attachments) ?? [],
      ...workspace?.draft_attachments.flatMap(item => item.attachment ? [item.attachment] : []) ?? [],
    ]
    const attachment = attachments.find(item => item.id === request.source.id)
    if (!attachment || !workspace) throw new Error('agent_attachment_missing')
    return workspace.onLoadAttachmentContent(attachment)
  }
  const images = messages.flatMap(message => message.parts.flatMap(part => part.kind === 'tool' ? part.images ?? [] : []))
  const image = images.find(item => ['session_id', 'message_id', 'part_id', 'content_index', 'revision']
    .every(key => item[key as keyof typeof item] === request.source[key]))
  if (!image || !workspace?.onLoadToolImage) throw new Error('agent_image_unavailable')
  return workspace.onLoadToolImage(image)
}
