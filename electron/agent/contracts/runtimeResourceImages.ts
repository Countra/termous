import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { isImageResourceReference, type ImageResourceReference } from '#common/contracts'
import { isRecord } from './validation.ts'

// SDK 状态使用合法的轻量文本块携带类型化元数据，仅请求副本转换为图片块。
export interface RuntimeResourceImage extends TextContent {
  resource_image: ImageResourceReference
}

export type { RuntimeHistoryImage } from './workerCore.ts'

export function resourceImage(ref: ImageResourceReference): RuntimeResourceImage {
  return { type: 'text', text: '', resource_image: ref }
}

export function isResourceImage(value: unknown): value is RuntimeResourceImage {
  return isRecord(value) && value.type === 'text' && value.text === '' && isImageResourceReference(value.resource_image)
}

export function isRuntimeImage(value: unknown): value is ImageContent | RuntimeResourceImage {
  return isResourceImage(value) || isRecord(value) && value.type === 'image' && typeof value.data === 'string' && typeof value.mimeType === 'string'
}

export function persistedImage(value: TextContent | ImageContent) {
  return isResourceImage(value) ? { type: 'image_ref', mimeType: value.resource_image.mime_type, resource: value.resource_image } : value
}

export function restoreResourceImages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map(message => {
    if (message.role !== 'user' && message.role !== 'toolResult' || typeof message.content === 'string') return message
    return { ...message, content: message.content.map(block => {
      const raw: unknown = block
      return isRecord(raw) && raw.type === 'image_ref' && isImageResourceReference(raw.resource) ? resourceImage(raw.resource) : block
    }) }
  })
}
