import type {
  CompletionItem,
  CompletionResult,
  CompletionSource,
} from '../../../types/domain'

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

export interface CompletionLabelSegments {
  entered: string
  suggestion: string
}

export function splitCompletionLabel(item: CompletionItem): CompletionLabelSegments {
  if (item.insert_text.length === 0) {
    return {
      entered: item.label,
      suggestion: '',
    }
  }
  if (!item.label.endsWith(item.insert_text)) {
    return {
      entered: '',
      suggestion: item.label,
    }
  }
  return {
    entered: item.label.slice(0, -item.insert_text.length),
    suggestion: item.insert_text,
  }
}

export function isExactCompletionItem(item: CompletionItem) {
  return item.insert_text.length === 0
}

function isCompletionSource(value: unknown): value is CompletionSource {
  return typeof value === 'string' && completionSourcePattern.test(value)
}
