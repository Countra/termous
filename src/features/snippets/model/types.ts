import type { CodeSnippet, CodeSnippetGroup } from '#entities/snippet'

export interface SnippetManagementData {
  snippetGroups: CodeSnippetGroup[]
  snippets: CodeSnippet[]
}
