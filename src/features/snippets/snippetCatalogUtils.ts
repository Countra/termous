import type { CodeSnippet } from '../../types/domain'
import { normalizeSnippetTags } from './snippetUtils'

export type SnippetCatalogFilter = 'all' | 'favorites'
export type SnippetCatalogDensity = 'management' | 'compact'

export interface SnippetTagSummary {
  key: string
  label: string
  count: number
}

export interface SnippetFilterState {
  filter: SnippetCatalogFilter
  query: string
  selectedTags: string[]
  groupId?: string
}

export function buildSnippetTags(snippets: CodeSnippet[]) {
  const summaries = new Map<string, SnippetTagSummary>()
  snippets.forEach((snippet) => {
    const seen = new Set<string>()
    normalizeSnippetTags(snippet.tags ?? []).forEach((tag) => {
      const key = snippetTagKey(tag)
      if (seen.has(key)) return
      seen.add(key)
      const summary = summaries.get(key)
      if (summary) summary.count += 1
      else summaries.set(key, { key, label: tag, count: 1 })
    })
  })
  return [...summaries.values()].sort((left, right) => left.label.localeCompare(right.label))
}

export function filterSnippets(snippets: CodeSnippet[], state: SnippetFilterState) {
  const queryTokens = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const selectedTagKeys = state.selectedTags.map(snippetTagKey)
  return snippets.filter((snippet) => {
    if (state.filter === 'favorites' && !snippet.favorite) return false
    if (state.groupId === '__ungrouped__' && snippet.group_id) return false
    if (state.groupId && state.groupId !== '__ungrouped__' && snippet.group_id !== state.groupId) return false
    const tags = normalizeSnippetTags(snippet.tags ?? [])
    const keys = new Set(tags.map(snippetTagKey))
    if (selectedTagKeys.some((tag) => !keys.has(tag))) return false
    if (queryTokens.length === 0) return true
    const searchable = [snippet.name, snippet.description ?? '', snippet.command, snippet.shell, tags.join(' ')]
      .join(' ')
      .toLowerCase()
    return queryTokens.every((token) => searchable.includes(token))
  })
}

export function snippetTagKey(value: string) {
  return value.trim().toLowerCase()
}
