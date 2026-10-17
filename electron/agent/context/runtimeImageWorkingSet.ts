import { createHash } from 'node:crypto'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent } from '@earendil-works/pi-ai'
import { decodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { runtimeImageDimensions } from './runtimeImageDimensions.ts'
import type { RuntimeContextImages } from './runtimeContextImages.ts'
import type { RuntimeContextImageReference } from '../contracts/runtimeCheckpoint.ts'
import { isRecord } from '../contracts/validation.ts'
import { releaseRuntimeImage, runtimeImageHistory, runtimeMessageDetails } from './runtimeImageLifetime.ts'

// 只固定最新的未确认模板；确认其他预览、重新截图都不能误取消它。
export function pendingPreviewCall(messages: AgentMessage[], now = Date.now()) {
  const calls = new Map<string, unknown>()
  let pending: { call: string; id?: string } | undefined
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const part of message.content) if (part.type === 'toolCall') calls.set(part.id, part.arguments)
    }
    if (message.role !== 'toolResult' || message.isError) continue
    const name = decodeMCPToolName(message.toolName) ?? message.toolName
    if (/templates\.(confirm|discard)$/u.test(name)) {
      const args = calls.get(message.toolCallId)
      if (pending && isRecord(args) && args.preview_id === pending.id) pending = undefined
    }
    if (!/templates\.(preview|get)$/u.test(name) || !message.content.some((part) => part.type === 'image')) continue
    let preview: Record<string, unknown> | undefined
    for (const part of message.content) {
      if (part.type !== 'text') continue
      try {
        const data: unknown = JSON.parse(part.text.slice(part.text.indexOf('{')))
        if (isRecord(data) && isRecord(data.preview)) preview = data.preview
      } catch { /* 只有结构化元数据可决定预览期限，普通文字不产生资源状态。 */ }
    }
    if (preview?.asset_id || (typeof preview?.expires_at === 'string' && Date.parse(preview.expires_at) <= now)) continue
    pending = { call: message.toolCallId, ...(typeof preview?.preview_id === 'string' ? { id: preview.preview_id } : {}) }
  }
  return pending?.call
}

export class RuntimeImageWorkingSet {
  private fingerprint = ''
  private readonly metadata = new WeakMap<object, { ref: RuntimeContextImageReference; size: { width: number; height: number } }>()
  private readonly images: RuntimeContextImages
  constructor(images: RuntimeContextImages) { this.images = images }
  key() { return this.fingerprint }

  releasePersisted(messages: AgentMessage[]) {
    const groups = messages.filter(message => isDesktopImageMessage(message))
    const keep = new Set(groups.slice(-2))
    const pending = pendingPreviewCall(messages)
    for (const message of messages) {
      if (message.role !== 'toolResult') continue
      message.details = runtimeMessageDetails(message.details)
      if (!isDesktopImageMessage(message) || keep.has(message) || message.toolCallId === pending) continue
      for (const part of message.content) {
        if (part.type !== 'image') continue
        const { ref, size } = this.imageMetadata(part)
        releaseRuntimeImage(part, runtimeImageHistory(ref, size, message))
      }
    }
  }

  project(messages: AgentMessage[], commit = true) {
    const groups: number[] = []
    const pendingCall = pendingPreviewCall(messages)
    let pendingPreview = -1
    messages.forEach((message, index) => {
      if (!isDesktopImageMessage(message) || message.role !== 'toolResult') return
      groups.push(index)
      if (message.toolCallId === pendingCall) pendingPreview = index
    })
    const keep = new Set([...groups.slice(-2), ...(pendingPreview >= 0 ? [pendingPreview] : [])])
    const desktop = new Set(groups)
    const hashes = new Set<string>()
    const visible: string[] = []
    // 倒序保留同图最新一次观察；文本里的时间、代次和引用仍保留在各自结果中。
    const projected = messages.slice()
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!
      if (!desktop.has(index) || message.role !== 'toolResult') continue
      let count = 0
      projected[index] = { ...message, content: message.content.map((part) => {
        if (part.type !== 'image') return part
        const { ref, size } = this.imageMetadata(part)
        const show = keep.has(index) && count++ < 2 && !hashes.has(ref.sha256)
        if (show) {
          hashes.add(ref.sha256)
          visible.push(`${message.toolCallId}:${ref.sha256}`)
          return part
        }
        return runtimeImageHistory(ref, size, message)
      }) }
    }
    const fingerprint = visible.length ? createHash('sha256').update(visible.join('\n')).digest('hex') : ''
    const changed = this.fingerprint !== fingerprint
    if (commit) this.fingerprint = fingerprint
    return { messages: projected, fingerprint, changed }
  }

  private imageMetadata(part: ImageContent) {
    let metadata = this.metadata.get(part)
    if (!metadata) {
      metadata = { ref: this.images.reference(part.mimeType, part.data), size: runtimeImageDimensions(part.data) }
      this.metadata.set(part, metadata)
    }
    return metadata
  }
}

function isDesktopImageMessage(message: AgentMessage) {
  if (message.role !== 'toolResult') return false
  const name = decodeMCPToolName(message.toolName) ?? message.toolName
  return (name.startsWith('termous.desktops.') || name.startsWith('termous.desktop_workflows.') || name === 'read_history_image')
    && message.content.some(part => part.type === 'image')
}
