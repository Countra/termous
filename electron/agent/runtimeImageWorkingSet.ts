import { createHash } from 'node:crypto'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'
import { decodeMCPToolName } from './toolNameCodec.ts'
import { runtimeImageDimensions } from './runtimeImageDimensions.ts'
import type { RuntimeContextImages } from './runtimeContextImages.ts'
import type { RuntimeContextImageReference } from './runtimeCheckpoint.ts'
import { isRecord } from './protocol.ts'

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

  project(messages: AgentMessage[], commit = true) {
    const groups: number[] = []
    const pendingCall = pendingPreviewCall(messages)
    let pendingPreview = -1
    messages.forEach((message, index) => {
      if (message.role !== 'toolResult') return
      const name = decodeMCPToolName(message.toolName) ?? message.toolName
      if (!(name.startsWith('termous.desktops.') || name.startsWith('termous.desktop_workflows.') || name === 'read_history_image')) return
      if (!message.content.some((part) => part.type === 'image')) return
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
        let metadata = this.metadata.get(part)
        if (!metadata) {
          metadata = { ref: this.images.reference(part.mimeType, part.data), size: runtimeImageDimensions(part.data) }
          this.metadata.set(part, metadata)
        }
        const { ref, size } = metadata
        const show = keep.has(index) && count++ < 2 && !hashes.has(ref.sha256)
        if (show) {
          hashes.add(ref.sha256)
          visible.push(`${message.toolCallId}:${ref.sha256}`)
          return part
        }
        return { type: 'text' as const, text: JSON.stringify({ history_image: ref, ...size, observed_at: message.timestamp, source_tool: message.toolName, notice: '此处只保留历史图片引用，当前看不到像素。需要检查时调用 read_history_image；历史图片不能用于实时点击授权。' }) }
      }) }
    }
    const fingerprint = visible.length ? createHash('sha256').update(visible.join('\n')).digest('hex') : ''
    const changed = this.fingerprint !== fingerprint
    if (commit) this.fingerprint = fingerprint
    return { messages: projected, fingerprint, changed }
  }
}

export function createHistoryImageTool(read: (ref: RuntimeContextImageReference, signal?: AbortSignal) => Promise<{ data: string; mime_type: string }>): AgentTool {
  return {
    name: 'read_history_image', label: '重读历史图片', executionMode: 'sequential',
    description: '按当前会话的持久化 history_image 引用读取图片。只恢复像素，不延长截图或桌面输入授权。',
    parameters: Type.Object({ reference: Type.Object({
      type: Type.Literal('image_ref'), mime_type: Type.String(), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      attachment_id: Type.Optional(Type.String()), message_part_id: Type.Optional(Type.String()), content_index: Type.Optional(Type.Integer({ minimum: 0 })),
    }, { additionalProperties: false }) }, { additionalProperties: false }),
    execute: async (_id, input, signal) => {
      const result = await read((input as { reference: RuntimeContextImageReference }).reference, signal)
      return { content: [{ type: 'text', text: '以下为已保存的历史图片，不能据此判断远端当前状态。' }, { type: 'image', data: result.data, mimeType: result.mime_type }], details: { kind: 'history_image' } }
    },
  }
}
