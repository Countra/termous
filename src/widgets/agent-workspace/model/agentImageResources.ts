import { isAgentDisplayImageMIMEType } from '#common/contracts'
import type { AgentImageLoader, AgentWorkspaceImage, AgentWorkspaceMessage } from './types.ts'

const maximumImageBytes = 10 * 1024 * 1024

export type AgentImageCatalog = Pick<ReadonlyMap<string, AgentWorkspaceImage>, 'get' | 'size'>

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
  const versions = new Map<string, { index: number; image: AgentWorkspaceImage }[]>()
  return messages.map((message, index) => {
    for (const part of message.parts) {
      if (part.kind !== 'tool') continue
      for (const image of part.images ?? []) {
        const history = versions.get(image.reference) ?? []
        history.push({ index, image })
        versions.set(image.reference, history)
      }
    }
    // 每张图片只索引一次；按消息位置查版本，既隔离未来同名引用，也不复制累计 Map。
    const images: AgentImageCatalog = { size: versions.size, get: reference => {
      const history = versions.get(reference) ?? []
      let left = 0
      let right = history.length
      while (left < right) {
        const middle = (left + right) >>> 1
        if (history[middle]!.index <= index) left = middle + 1
        else right = middle
      }
      return history[left - 1]?.image
    } }
    return { message, images }
  })
}
