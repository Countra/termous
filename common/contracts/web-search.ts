export interface WebSearchSettings { mode: 'cloud' | 'searxng'; base_url: string }
export interface WebSearchRequest { query: string; limit?: number; page?: number; language?: string; time_range?: 'day' | 'month' | 'year' }
export interface WebSearchItem { title: string; url: string; snippet: string; published_at?: string }
export interface WebSearchResult {
  provider: 'searxng'
  query: string
  page: number
  retrieved_at: string
  results: WebSearchItem[]
  partial: boolean
  truncated: boolean
  warnings: string[]
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.length <= maximum
function safeURL(value: unknown) {
  if (!text(value, 8192)) return false
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
export function isWebSearchResult(value: unknown): value is WebSearchResult {
  return record(value) && value.provider === 'searxng' && text(value.query, 4096)
    && Number.isInteger(value.page) && Number(value.page) >= 1 && Number(value.page) <= 10
    && text(value.retrieved_at, 64) && Number.isFinite(Date.parse(value.retrieved_at))
    && typeof value.partial === 'boolean' && typeof value.truncated === 'boolean'
    && Array.isArray(value.warnings) && value.warnings.length <= 16 && value.warnings.every(item => text(item, 1024))
    && Array.isArray(value.results) && value.results.length <= 10 && value.results.every(item => record(item)
      && text(item.title, 1024) && safeURL(item.url) && text(item.snippet, 8192)
      && (item.published_at === undefined || text(item.published_at, 64) && Number.isFinite(Date.parse(item.published_at))))
    && new TextEncoder().encode(JSON.stringify(value)).byteLength <= 65536
}
