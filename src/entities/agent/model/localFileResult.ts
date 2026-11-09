import type { AgentToolResultPart } from './types.ts'
import { decodeFileReview, type FileReview } from '#shared/file-review'

export interface AgentLocalFileResult {
  action: 'read' | 'write' | 'edit'
  path: string
  size: number
  created?: boolean
  text?: string
  offset?: number
  nextOffset?: number
  partial?: boolean
  previewLimited?: boolean
  startLine?: number
  endLine?: number
  consistency?: 'snapshot' | 'live'
  changed?: boolean
  changeCount?: number
  review?: FileReview
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function readLocalFileResult(result: AgentToolResultPart): AgentLocalFileResult | undefined {
  // 外部来源使用 source::name；仅投影确切的内置文件回执，异常数据保留原始详情。
  const action = new Map<string, AgentLocalFileResult['action']>([
    ['termous.local.files.read', 'read'], ['termous.local.files.write', 'write'], ['termous.local.files.edit', 'edit'],
  ]).get(result.tool_name)
  if (!action || result.is_error || !Array.isArray(result.content)) return undefined
  const block = result.content.find(item => record(item) && item.type === 'text')
  if (!record(block) || typeof block.text !== 'string' || block.text.length > 512 * 1024) return undefined
  let data: unknown
  try { data = JSON.parse(block.text) } catch { return undefined }
  if (action !== 'read') {
    if (!record(data) || data.state !== 'completed') return undefined
    data = data.value
  }
  if (!record(data) || typeof data.path !== 'string' || data.path.length > 32768 || !integer(data.size_bytes)) return undefined
  if (action !== 'read') {
    if (typeof data.created !== 'boolean') return undefined
    let review: FileReview | undefined
    if (data.review !== undefined) { try { review = decodeFileReview(data.review) } catch { return undefined } }
    return { action, path: data.path, size: data.size_bytes, created: data.created, review,
      changed: typeof data.changed === 'boolean' ? data.changed : undefined,
      changeCount: integer(data.change_count) ? data.change_count : undefined }
  }
  if (!integer(data.offset) || !integer(data.next_offset) || data.next_offset < data.offset || data.next_offset > data.size_bytes || typeof data.truncated !== 'boolean'
    || data.text !== undefined && typeof data.text !== 'string') return undefined
  // 图片读取只有资源引用，不能把缺失文本的非空文件展示为“空文件”。
  if (data.text === undefined && data.size_bytes > 0) return undefined
  const text = typeof data.text === 'string' ? data.text : ''
  let preview = text.slice(0, 4000)
  if (/[\uD800-\uDBFF]$/u.test(preview)) preview = preview.slice(0, -1)
  return { action, path: data.path, size: data.size_bytes, text: preview, offset: data.offset, nextOffset: data.next_offset,
    startLine: integer(data.start_line) ? data.start_line : undefined, endLine: integer(data.end_line) ? data.end_line : undefined,
    consistency: data.consistency === 'snapshot' || data.consistency === 'live' ? data.consistency : undefined,
    partial: data.truncated || data.offset > 0, previewLimited: preview.length < text.length }
}
