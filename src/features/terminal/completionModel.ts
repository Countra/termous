import type {
  CompletionItem,
  CompletionResult,
  CompletionSource,
} from '../../types/domain'

const completionSources = new Set<CompletionSource>([
  'alias',
  'snippet',
  'history',
  'directory',
])

export function normalizeCompletionResult(result: CompletionResult): CompletionResult {
  return {
    ...result,
    items: result.items.map(normalizeCompletionItem),
  }
}

export function normalizeCompletionItem(
  item: CompletionItem & { sources?: unknown },
): CompletionItem {
  if (!completionSources.has(item.source)) {
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
  return typeof value === 'string' && completionSources.has(value as CompletionSource)
}
