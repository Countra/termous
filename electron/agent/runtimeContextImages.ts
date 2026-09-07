import { createHash } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import type { RuntimeBootstrap } from './workerCoreClient.ts'
import type { RuntimeContextImageReference } from './runtimeCheckpoint.ts'
import { isRecord } from './protocol.ts'

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
          sha256: imageHash(attachment.content_base64),
        })
      }
      for (const part of message.parts) {
        if (part.kind !== 'tool_result') continue
        const tool = part.content.tool_result
        if (isRecord(tool) && Array.isArray(tool.content)) this.registerToolContent(part.id, tool.content)
      }
    }
  }

  registerToolResult(partID: string, message: ToolResultMessage) {
    this.registerToolContent(partID, message.content)
  }

  serialize(messages: AgentMessage[]): unknown[] {
    return messages.map((message) => {
      if (message.role !== 'user' && message.role !== 'toolResult') return structuredClone(message)
      if (typeof message.content === 'string') return { ...message }
      return {
        ...message,
        content: message.content.map((block) => {
          if (block.type !== 'image') return structuredClone(block)
          const source = this.sources.get(sourceKey(block.mimeType, imageHash(block.data)))
          if (!source) throw new Error('AGENT_CONTEXT_IMAGE_SOURCE_MISSING')
          return { ...source }
        }),
      }
    })
  }

  private registerToolContent(partID: string, content: unknown[]) {
    content.forEach((block, index) => {
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
