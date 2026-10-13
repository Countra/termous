import { isAgentDisplayImageMIMEType } from '#common/contracts'
import type { AgentImageLoader, AgentWorkspaceImage, AgentWorkspaceMessage } from './types.ts'

const maximumImageBytes = 10 * 1024 * 1024

export async function loadAgentImage(image: AgentWorkspaceImage, loader?: AgentImageLoader, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  if (!loader || !isAgentDisplayImageMIMEType(image.mime_type)
    || !Number.isSafeInteger(image.size_bytes) || image.size_bytes <= 0 || image.size_bytes > maximumImageBytes) {
    throw new Error('AGENT_IMAGE_INVALID')
  }
  const blob = await loader(image, signal)
  signal?.throwIfAborted()
  if (blob.type !== image.mime_type || blob.size !== image.size_bytes) throw new Error('AGENT_IMAGE_INVALID')
  return blob
}

export function agentMessageImageCatalogs(messages: AgentWorkspaceMessage[]) {
  let images: ReadonlyMap<string, AgentWorkspaceImage> = new Map()
  return messages.map((message) => {
    const additions = message.parts.flatMap((part) => part.kind === 'tool' ? part.images ?? [] : [])
    if (additions.length > 0) {
      // 保留每条消息当时的资源目录，后续同名调用不能改变早先回答中的图片。
      images = new Map([...images, ...additions.map((image) => [image.reference, image] as const)])
    }
    return { message, images }
  })
}
