import {
  normalizeCompletionItem,
  normalizeCompletionResult,
  type CompletionItem,
} from '#entities/session'

export { normalizeCompletionItem, normalizeCompletionResult }

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
