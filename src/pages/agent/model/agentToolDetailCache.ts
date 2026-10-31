import type { AgentMessagePart } from '#entities/agent'
import { readLocalFileResult, type AgentLocalFileResult } from '#entities/agent'
import { readWebSearchResult } from '#entities/agent'
import type { WebSearchResult } from '#common/contracts'

const sensitiveKey = /(?:api[_-]?key|authorization|bearer|credential|pass(?:word|phrase)?|private[_-]?key|secret|token)/i
const maximumToolDetailLength = 4_000
type Call = Extract<AgentMessagePart, { kind: 'tool_call' }>
type Result = Extract<AgentMessagePart, { kind: 'tool_result' }>

// 正文不可变时只脱敏和序列化一次；缓存键随分页片段回收，不持有整个会话或事件数组。
export class AgentToolDetailCache {
  private readonly values = new WeakMap<Call | Result, { result?: Result; detail: string }>()
  private readonly files = new WeakMap<Result, AgentLocalFileResult | undefined>()
  private readonly searches = new WeakMap<Result, WebSearchResult | undefined>()

  webSearch(result: Result | undefined) {
    if (!result) return undefined
    if (!this.searches.has(result)) this.searches.set(result, readWebSearchResult(result.tool_result))
    return this.searches.get(result)
  }

  localFile(result: Result | undefined) {
    if (!result) return undefined
    if (!this.files.has(result)) this.files.set(result, readLocalFileResult(result.tool_result))
    return this.files.get(result)
  }

  detail(call: Call | undefined, result: Result | undefined) {
    const key = call ?? result
    if (!key) return ''
    const cached = this.values.get(key)
    if (cached && cached.result === result) return cached.detail
    const detail = boundedToolDetail({
      ...(call ? { arguments: redactJson(call.tool_call.arguments) } : {}),
      ...(result ? { result: redactJson(result.tool_result.content) } : {}),
    })
    this.values.set(key, { result, detail })
    return detail
  }
}

function redactJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]'
  if (Array.isArray(value)) return value.slice(0, 64).map(item => redactJson(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const block = value as Record<string, unknown>
  if ((block.type === 'image' || block.type === 'audio') && typeof block.data === 'string') {
    return { type: block.type, mimeType: block.mimeType, data: '[二进制内容已省略]' }
  }
  return Object.fromEntries(Object.entries(block).slice(0, 128).map(([key, item]) => [
    key, sensitiveKey.test(key) ? '[redacted]' : redactJson(item, depth + 1),
  ]))
}

function boundedToolDetail(value: unknown) {
  const serialized = JSON.stringify(value, null, 2)
  return serialized.length <= maximumToolDetailLength ? serialized : `${serialized.slice(0, maximumToolDetailLength)}\n...`
}
