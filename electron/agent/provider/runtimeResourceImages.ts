import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { ImageResourceReference } from '#common/contracts'
import { isResourceImage } from '../contracts/runtimeResourceImages.ts'

export async function materializeResourceImages(
  messages: AgentMessage[], read: ((ref: ImageResourceReference, signal?: AbortSignal) => Promise<string>) | undefined, signal?: AbortSignal,
): Promise<AgentMessage[]> {
  const result: AgentMessage[] = []
  // 顺序读取使单次请求的解码峰值可预测，同一图片只构造一份编码。
  const encoded = new Map<string, string>()
  for (const message of messages) {
    signal?.throwIfAborted()
    if (message.role !== 'user' && message.role !== 'toolResult' || typeof message.content === 'string') { result.push(message); continue }
    const content: Array<TextContent | ImageContent> = []
    for (const block of message.content) {
      if (!isResourceImage(block)) { content.push(block); continue }
      if (!read) throw new Error('AGENT_RUNTIME_IMAGE_UNAVAILABLE')
      const ref = block.resource_image
      let data = encoded.get(ref.sha256)
      if (!data) {
        data = await read(ref, signal)
        // 同一消息可能携带多张图片；取消后不继续读取下一张，也不发布刚返回的编码。
        signal?.throwIfAborted()
        encoded.set(ref.sha256, data)
      }
      content.push({ type: 'image', mimeType: ref.mime_type, data })
    }
    result.push({ ...message, content })
  }
  return result
}
