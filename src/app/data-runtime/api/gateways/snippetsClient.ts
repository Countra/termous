import type { AppConfig } from '#common/contracts';
import type { GroupReorderItem } from '#shared/model';
import type { CodeSnippet, CodeSnippetGroup, CodeSnippetGroupInput, CodeSnippetInput } from '#entities/snippet';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

export class SnippetClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

codeSnippets() {
    return this.request<CodeSnippet[]>('/api/v1/snippets').then(normalizeArray)
  }

codeSnippetGroups() {
    return this.request<CodeSnippetGroup[]>('/api/v1/snippet-groups').then(normalizeArray)
  }

snippetEventsUrl() {
    return this.websocketUrl('/api/v1/snippets/events')
  }

createCodeSnippetGroup(input: CodeSnippetGroupInput) {
    return this.request<CodeSnippetGroup>('/api/v1/snippet-groups', {
      method: 'POST',
      body: input,
    })
  }

updateCodeSnippetGroup(id: string, input: CodeSnippetGroupInput) {
    return this.request<CodeSnippetGroup>(`/api/v1/snippet-groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteCodeSnippetGroup(id: string) {
    return this.request<void>(`/api/v1/snippet-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

reorderCodeSnippetGroups(items: GroupReorderItem[]) {
    return this.request<CodeSnippetGroup[]>('/api/v1/snippet-groups/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

createCodeSnippet(input: CodeSnippetInput) {
    return this.request<CodeSnippet>('/api/v1/snippets', {
      method: 'POST',
      body: input,
    })
  }

updateCodeSnippet(id: string, input: CodeSnippetInput) {
    return this.request<CodeSnippet>(`/api/v1/snippets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteCodeSnippet(id: string) {
    return this.request<void>(`/api/v1/snippets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

markCodeSnippetUsed(id: string) {
    return this.request<CodeSnippet>(`/api/v1/snippets/${encodeURIComponent(id)}/used`, { method: 'POST' })
  }
}
