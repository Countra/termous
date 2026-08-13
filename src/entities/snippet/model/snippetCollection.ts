import type { CodeSnippet, CodeSnippetGroup } from './types.ts'

export function upsertCodeSnippet(snippets: CodeSnippet[], next: CodeSnippet) {
  const exists = snippets.some((snippet) => snippet.id === next.id)
  const merged = exists ? snippets.map((snippet) => (snippet.id === next.id ? next : snippet)) : [next, ...snippets]
  return [...merged].sort(sortCodeSnippets)
}

export function sortCodeSnippetGroups(groups: CodeSnippetGroup[]) {
  return [...groups].sort((left, right) => (
    left.sort_order - right.sort_order
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ))
}

export function upsertCodeSnippetGroup(groups: CodeSnippetGroup[], next: CodeSnippetGroup) {
  const exists = groups.some((group) => group.id === next.id)
  return sortCodeSnippetGroups(
    exists ? groups.map((group) => (group.id === next.id ? next : group)) : [...groups, next],
  )
}

export function replaceCodeSnippet(snippets: CodeSnippet[], next: CodeSnippet) {
  if (!snippets.some((snippet) => snippet.id === next.id)) {
    return upsertCodeSnippet(snippets, next)
  }
  return snippets.map((snippet) => (snippet.id === next.id ? next : snippet))
}

export function sortCodeSnippets(left: CodeSnippet, right: CodeSnippet) {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  const leftCreatedAt = new Date(left.created_at).getTime()
  const rightCreatedAt = new Date(right.created_at).getTime()
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt
  }
  return left.id.localeCompare(right.id)
}
