import type { FileReview, FileReviewPage, FileReviewRow } from './types.ts'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FILE_REVIEW_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max) throw new Error('FILE_REVIEW_INVALID')
  return value
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) throw new Error('FILE_REVIEW_INVALID')
  return value
}
function hash(value: unknown, empty = false) {
  const result = text(value, 64)
  if (!/^[a-f0-9]{64}$/u.test(result) && !(empty && result === '')) throw new Error('FILE_REVIEW_INVALID')
  return result
}
export function decodeFileReview(value: unknown): FileReview {
  const raw = record(value)
  if (raw.version !== 1) throw new Error('FILE_REVIEW_VERSION_UNSUPPORTED')
  const id = text(raw.id, 128)
  if (!id || typeof raw.coarse !== 'boolean') throw new Error('FILE_REVIEW_INVALID')
  return { version: 1, id, digest: hash(raw.digest), before_sha256: hash(raw.before_sha256, true),
    after_sha256: hash(raw.after_sha256), change_count: integer(raw.change_count, 100), coarse: raw.coarse }
}
export function decodeFileReviewPage(value: unknown): FileReviewPage {
  const raw = record(value)
  if (!['diff', 'before', 'after'].includes(String(raw.mode)) || !Array.isArray(raw.rows) || raw.rows.length > 100) throw new Error('FILE_REVIEW_INVALID')
  let bytes = 0
  const rows = raw.rows.map(value => {
    const row = record(value)
    if (!['equal', 'add', 'remove', 'omitted'].includes(String(row.kind)) || row.partial !== undefined && typeof row.partial !== 'boolean') throw new Error('FILE_REVIEW_INVALID')
    const content = text(row.text, 65536)
    bytes += new TextEncoder().encode(content).length
    if (bytes > 65536) throw new Error('FILE_REVIEW_INVALID')
    return { kind: row.kind as FileReviewRow['kind'], text: content,
      before_line: row.before_line === undefined ? undefined : integer(row.before_line),
      after_line: row.after_line === undefined ? undefined : integer(row.after_line), partial: row.partial as boolean | undefined }
  })
  return { review: decodeFileReview(raw.review), mode: raw.mode as FileReviewPage['mode'], rows,
    cursor: raw.cursor === undefined ? undefined : text(raw.cursor, 4096) }
}
