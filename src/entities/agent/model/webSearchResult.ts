import { isWebSearchResult, type WebSearchResult } from '#common/contracts'
import type { AgentToolResultPart } from './types.ts'

export function readWebSearchResult(result: AgentToolResultPart): WebSearchResult | undefined {
  if (result.tool_name !== 'termous.web.search' || result.is_error || !Array.isArray(result.content)) return undefined
  const block = result.content.find(item => item && typeof item === 'object' && 'type' in item && item.type === 'text')
  if (!block || typeof block !== 'object' || !('text' in block) || typeof block.text !== 'string' || block.text.length > 65536) return undefined
  try {
    const value: unknown = JSON.parse(block.text)
    return isWebSearchResult(value) ? value : undefined
  } catch { return undefined }
}
