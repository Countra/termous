import type { StreamFn } from '@earendil-works/pi-agent-core'
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import type { ImageResourceReference } from '#common/contracts'
import { isResourceImage } from '../contracts/runtimeResourceImages.ts'
import { materializeResourceImages } from './runtimeResourceImages.ts'

export function runtimeResourceStream(base: StreamFn,
  read?: (ref: ImageResourceReference, signal?: AbortSignal) => Promise<string>,
  reserve?: (bytes: number, signal?: AbortSignal) => Promise<() => void>,
): StreamFn {
  return async (model, context, options) => {
    const images = new Map<string, number>()
    let serializedBytes = 0
    for (const message of context.messages) {
      if ((message.role === 'user' || message.role === 'toolResult') && Array.isArray(message.content)) {
        for (const block of message.content) if (isResourceImage(block)) {
          images.set(block.resource_image.sha256, block.resource_image.size_bytes)
          serializedBytes += block.resource_image.size_bytes * 2
        }
      }
    }
    if (!images.size) return base(model, context, options)
    // 编码可按摘要复用，但请求序列化会再次展开每次引用，二者分别计入峰值。
    const sizes = [...images.values()]
    const bytes = serializedBytes + sizes.reduce((sum, size) => sum + size * 2, 0) + Math.max(...sizes) * 2
    const release = await reserve?.(bytes, options?.signal) ?? (() => undefined)
    try {
      const messages = await materializeResourceImages(context.messages, read, options?.signal)
      const source = await base(model, normalizeContext({ messages }), options)
      return new ResourceStream(source, release)
    } catch (error) { release(); throw error }
  }
}

class ResourceStream extends AssistantMessageEventStream {
  private released = false
  private readonly source: AssistantMessageEventStream
  private readonly release: () => void
  constructor(source: AssistantMessageEventStream, release: () => void) {
    super(); this.source = source; this.release = release
    // 迭代器结束不代表底层请求已经排空；只有真实请求终态才能归还物化预算。
    void source.result().then(() => this.finish(), () => this.finish())
  }
  private finish() { if (!this.released) { this.released = true; this.release() } }
  override async result() { try { return await this.source.result() } finally { this.finish() } }
  override async *[Symbol.asyncIterator]() {
    const iterator = this.source[Symbol.asyncIterator]()
    try {
      for (;;) { const next = await iterator.next(); if (next.done) break; yield next.value }
    } finally { await iterator.return?.() }
  }
}
