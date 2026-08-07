import type {
  CompletionItem,
  CompletionResult,
  CompletionSource,
} from './types.ts'

const completionSourcePattern = /^[a-z][a-z0-9_-]{0,63}$/

export function normalizeCompletionResult(result: CompletionResult): CompletionResult {
  return {
    ...result,
    items: result.items.map(normalizeCompletionItem),
  }
}

export function normalizeCompletionItem(
  item: CompletionItem & { sources?: unknown },
): CompletionItem {
  if (!isCompletionSource(item.source)) {
    throw new Error('Invalid completion source')
  }
  const sources = Array.isArray(item.sources)
    ? item.sources.filter(isCompletionSource)
    : []
  return {
    ...item,
    sources: [...new Set([item.source, ...sources])],
  }
}

function isCompletionSource(value: unknown): value is CompletionSource {
  return typeof value === 'string' && completionSourcePattern.test(value)
}
