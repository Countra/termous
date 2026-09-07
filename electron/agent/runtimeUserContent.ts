import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import {
  decodeRuntimeAttachment,
  maximumImageAttachmentBytes,
  maximumImageAttachmentTotalBytes,
  maximumTextAttachmentBytes,
  maximumTextAttachmentTotalBytes,
  type RuntimeMessageAttachment,
} from './runtimeAttachmentPolicy.ts'
import type { RuntimeMessageView } from './workerCoreClient.ts'

export function hydrateRuntimeUserContent(
  message: RuntimeMessageView,
  supportsImages: boolean,
): Array<TextContent | ImageContent> {
  const content: Array<TextContent | ImageContent> = []
  for (const part of message.parts) {
    if (part.kind !== 'text') {
      throw new Error('AGENT_RUNTIME_MESSAGE_INVALID')
    }
    const textPart = requiredRecord(part.content.text)
    const sourceContext = runtimeSourceContext(textPart.source_context)
    if (sourceContext) {
      content.push({ type: 'text', text: runtimeSourceContextBlock(sourceContext) })
    }
    content.push({ type: 'text', text: requiredString(textPart.text) })
  }
  appendRuntimeAttachments(content, message.attachments, supportsImages)
  return content
}

interface RuntimeSourceContext {
  kind: 'workbench' | 'files' | 'host_profile' | 'forward_failure'
  entity_id: string
  title: string
  summary: string
}

function appendRuntimeAttachments(
  content: Array<TextContent | ImageContent>,
  attachments: RuntimeMessageAttachment[],
  supportsImages: boolean,
) {
  const attachmentIDs = new Set<string>()
  let textBytes = 0
  let imageBytes = 0
  for (const attachment of attachments) {
    if (attachmentIDs.has(attachment.id)) {
      throw new Error('AGENT_RUNTIME_ATTACHMENT_INVALID')
    }
    attachmentIDs.add(attachment.id)
    const bytes = decodeRuntimeAttachment(attachment)
    if (attachment.kind === 'text') {
      textBytes += bytes.byteLength
      if (bytes.byteLength > maximumTextAttachmentBytes
        || textBytes > maximumTextAttachmentTotalBytes) {
        throw new Error('AGENT_RUNTIME_ATTACHMENT_LIMIT_EXCEEDED')
      }
      content.push({
        type: 'text',
        text: runtimeTextAttachmentBlock(attachment, decodeUTF8Attachment(bytes), bytes.byteLength),
      })
      continue
    }
    if (!supportsImages) {
      throw new Error('AGENT_RUNTIME_MODEL_IMAGE_UNSUPPORTED')
    }
    imageBytes += bytes.byteLength
    if (bytes.byteLength > maximumImageAttachmentBytes
      || imageBytes > maximumImageAttachmentTotalBytes) {
      throw new Error('AGENT_RUNTIME_ATTACHMENT_LIMIT_EXCEEDED')
    }
    content.push({
      type: 'text',
      text: `[Termous 用户图片附件 id=${attachment.id} mime=${attachment.mime_type}]`,
    })
    content.push({ type: 'image', data: attachment.content_base64, mimeType: attachment.mime_type })
  }
}

function runtimeSourceContext(value: unknown): RuntimeSourceContext | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)
    || !Object.keys(value).every((key) =>
      key === 'kind' || key === 'entity_id' || key === 'title' || key === 'summary')
    || Object.keys(value).length !== 4
    || (value.kind !== 'workbench'
      && value.kind !== 'files'
      && value.kind !== 'host_profile'
      && value.kind !== 'forward_failure')
    || !validRuntimeContextString(value.entity_id, 128, false)
    || !validRuntimeContextString(value.title, 200, false)
    || !validRuntimeContextString(value.summary, 2000, true)) {
    throw new Error('AGENT_RUNTIME_SOURCE_CONTEXT_INVALID')
  }
  return {
    kind: value.kind,
    entity_id: requiredString(value.entity_id),
    title: requiredString(value.title),
    summary: requiredString(value.summary),
  }
}

function validRuntimeContextString(value: unknown, maximumBytes: number, allowEmpty: boolean) {
  return typeof value === 'string'
    && (allowEmpty || value.trim().length > 0)
    && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= maximumBytes
}

function runtimeSourceContextBlock(value: RuntimeSourceContext) {
  return [
    '[Termous 用户业务来源上下文开始]',
    JSON.stringify(value),
    '[Termous 用户业务来源上下文结束]',
  ].join('\n')
}

function decodeUTF8Attachment(bytes: Uint8Array) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (text.includes('\0')) {
      throw new Error('AGENT_RUNTIME_ATTACHMENT_INVALID')
    }
    return text
  } catch {
    throw new Error('AGENT_RUNTIME_ATTACHMENT_INVALID')
  }
}

function runtimeTextAttachmentBlock(
  attachment: RuntimeMessageAttachment,
  text: string,
  byteLength: number,
) {
  return [
    `[Termous 用户文本附件 id=${attachment.id} mime=${attachment.mime_type} bytes=${byteLength}]`,
    text,
    `[Termous 用户文本附件结束 id=${attachment.id}]`,
  ].join('\n')
}

function requiredRecord(value: unknown) {
  if (!isRecord(value)) {
    throw new Error('AGENT_RUNTIME_MESSAGE_INVALID')
  }
  return value
}

function requiredString(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('AGENT_RUNTIME_MESSAGE_INVALID')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
