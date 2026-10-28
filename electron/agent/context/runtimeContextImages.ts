import { createHash } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import type { RuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'
import type { RuntimeContextImageReference } from '../contracts/runtimeCheckpoint.ts'
import { isRecord } from '../contracts/validation.ts'
import { runtimeMessageDetails } from './runtimeImageLifetime.ts'
import { isImageResourceReference } from '#common/contracts'
import { isResourceImage, isRuntimeImage } from '../contracts/runtimeResourceImages.ts'
import { isDesktopTaskReceipt, type DesktopTaskReceipt } from '../contracts/desktopTasks.ts'

export class RuntimeContextImages {
  private readonly sources = new Map<string, RuntimeContextImageReference>()

  constructor(bootstrap: Pick<RuntimeBootstrap, 'context' | 'messages'>) {
    for (const source of bootstrap.context.checkpoint?.image_sources ?? []) this.register(source)
    for (const message of bootstrap.messages) {
      for (const attachment of message.attachments) {
        if (attachment.kind !== 'image') continue
        this.register({
          type: 'image_ref',
          attachment_id: attachment.id,
          mime_type: attachment.mime_type,
          sha256: attachment.resource?.sha256 ?? imageHash(attachment.content_base64 ?? ''),
        })
      }
      for (const part of message.parts) {
        if (part.kind === 'task_result' && isDesktopTaskReceipt(part.content.task_result)) this.registerTaskResult(part.id, part.content.task_result)
        if (part.kind !== 'tool_result') continue
        const tool = part.content.tool_result
        if (isRecord(tool) && Array.isArray(tool.content)) this.registerToolContent(part.id, tool.content)
      }
    }
  }

  registerToolResult(partID: string, message: ToolResultMessage) {
    this.registerToolContent(partID, message.content)
  }

  registerTaskResult(partID: string, receipt: DesktopTaskReceipt) {
    if (receipt.image) this.register({ type: 'image_ref', message_part_id: partID, content_index: 1,
      mime_type: receipt.image.mime_type, sha256: receipt.image.sha256 })
  }

  reference(mimeType: string, data: string): RuntimeContextImageReference {
    const source = this.sources.get(sourceKey(mimeType, imageHash(data)))
    if (!source) throw new Error('AGENT_CONTEXT_IMAGE_SOURCE_MISSING')
    return { ...source }
  }

  referenceHash(mimeType: string, sha256: string): RuntimeContextImageReference {
    const source = this.sources.get(sourceKey(mimeType, sha256))
    if (!source) throw new Error('AGENT_CONTEXT_IMAGE_SOURCE_MISSING')
    return { ...source }
  }

  retain(messages: AgentMessage[]) {
    const keep = new Set<string>()
    for (const message of messages) {
      if ((message.role !== 'user' && message.role !== 'toolResult') || !Array.isArray(message.content)) continue
      for (const block of message.content) {
        if (isResourceImage(block)) keep.add(sourceKey(block.resource_image.mime_type, block.resource_image.sha256))
        else if (block.type === 'image') keep.add(sourceKey(block.mimeType, imageHash(block.data)))
      }
    }
    for (const key of this.sources.keys()) if (!keep.has(key)) this.sources.delete(key)
  }

  serialize(messages: AgentMessage[]): unknown[] {
    return messages.map((message) => {
      if (message.role !== 'user' && message.role !== 'toolResult') return structuredClone(message)
      if (typeof message.content === 'string') return { ...message }
      return {
        ...message,
        ...(message.role === 'toolResult' && message.details !== undefined ? { details: runtimeMessageDetails(message.details) } : {}),
        content: message.content.map((block) => {
          if (!isRuntimeImage(block)) return structuredClone(block)
          const source = isResourceImage(block) ? this.sources.get(sourceKey(block.resource_image.mime_type, block.resource_image.sha256))
            : this.sources.get(sourceKey(block.mimeType, imageHash(block.data)))
          if (!source) throw new Error('AGENT_CONTEXT_IMAGE_SOURCE_MISSING')
          return { ...source }
        }),
      }
    })
  }

  private registerToolContent(partID: string, content: unknown[]) {
    content.forEach((block, index) => {
      const ref = isResourceImage(block) ? block.resource_image : isRecord(block) && block.type === 'image_ref' && isImageResourceReference(block.resource) ? block.resource : undefined
      if (ref) {
        this.register({ type: 'image_ref', message_part_id: partID, content_index: index, mime_type: ref.mime_type, sha256: ref.sha256 })
        return
      }
      if (!isRecord(block) || block.type !== 'image') return
      if (typeof block.data !== 'string' || typeof block.mimeType !== 'string') {
        throw new Error('AGENT_RUNTIME_MESSAGE_INVALID')
      }
      this.register({
        type: 'image_ref',
        message_part_id: partID,
        content_index: index,
        mime_type: block.mimeType,
        sha256: imageHash(block.data),
      })
    })
  }

  private register(source: RuntimeContextImageReference) {
    const key = sourceKey(source.mime_type, source.sha256)
    // 相同图片可能被工具再次返回，保留最早已落盘的来源，不引用晚于快照的消息。
    if (!this.sources.has(key)) this.sources.set(key, { ...source })
  }
}

function sourceKey(mimeType: string, hash: string) {
  return `${mimeType}:${hash}`
}

function imageHash(base64: string) {
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== base64) {
    throw new Error('AGENT_CONTEXT_IMAGE_INVALID')
  }
  return createHash('sha256').update(bytes).digest('hex')
}
