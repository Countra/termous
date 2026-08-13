import type { GroupReorderItem } from '#shared/model'
import type { SnippetCommandGateway } from '../api/runtimeGatewayContracts'
import {
  replaceCodeSnippet,
  sortCodeSnippetGroups,
  upsertCodeSnippet,
  upsertCodeSnippetGroup,
  type CodeSnippetGroupInput,
  type CodeSnippetInput,
} from '#entities/snippet'
import type { SetAppData } from '../model/runtimeTypes'

export function createSnippetCommands(api: SnippetCommandGateway, setData: SetAppData) {
  return {
    async createCodeSnippet(input: CodeSnippetInput) {
      const snippet = await api.createCodeSnippet(input)
      setData((current) => ({ ...current, snippets: upsertCodeSnippet(current.snippets, snippet) }))
      return snippet
    },
    async updateCodeSnippet(id: string, input: CodeSnippetInput) {
      const snippet = await api.updateCodeSnippet(id, input)
      setData((current) => ({ ...current, snippets: upsertCodeSnippet(current.snippets, snippet) }))
      return snippet
    },
    async deleteCodeSnippet(id: string) {
      await api.deleteCodeSnippet(id)
      setData((current) => ({ ...current, snippets: current.snippets.filter((snippet) => snippet.id !== id) }))
    },
    async markCodeSnippetUsed(id: string) {
      const snippet = await api.markCodeSnippetUsed(id)
      setData((current) => ({ ...current, snippets: replaceCodeSnippet(current.snippets, snippet) }))
      return snippet
    },
    async createCodeSnippetGroup(input: CodeSnippetGroupInput) {
      const group = await api.createCodeSnippetGroup(input)
      setData((current) => ({
        ...current,
        snippetGroups: upsertCodeSnippetGroup(current.snippetGroups, group),
      }))
      return group
    },
    async updateCodeSnippetGroup(id: string, input: CodeSnippetGroupInput) {
      const group = await api.updateCodeSnippetGroup(id, input)
      setData((current) => ({
        ...current,
        snippetGroups: upsertCodeSnippetGroup(current.snippetGroups, group),
      }))
      return group
    },
    async deleteCodeSnippetGroup(id: string) {
      await api.deleteCodeSnippetGroup(id)
      setData((current) => ({
        ...current,
        snippetGroups: current.snippetGroups.filter((group) => group.id !== id),
        snippets: current.snippets.map((snippet) => (
          snippet.group_id === id ? { ...snippet, group_id: '' } : snippet
        )),
      }))
    },
    async reorderCodeSnippetGroups(items: GroupReorderItem[]) {
      const groups = await api.reorderCodeSnippetGroups(items)
      setData((current) => ({ ...current, snippetGroups: sortCodeSnippetGroups(groups) }))
      return groups
    },
  }
}
