import type { AppConfig } from '#common/contracts';
import type { FileBookmark, FileBookmarkGroup, FileBookmarkGroupInput, FileBookmarkGroupReorderItem, FileBookmarkInput, FileBookmarkReorderItem, LocalPathMapping, LocalPathMappingInput, LocalPathMappingReorderItem, LocalTreeEntry } from '#entities/file';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

export class FileCatalogClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

fileBookmarkGroups() {
    return this.request<FileBookmarkGroup[]>('/api/v1/file-bookmark-groups').then(normalizeArray)
  }

createFileBookmarkGroup(input: FileBookmarkGroupInput) {
    return this.request<FileBookmarkGroup>('/api/v1/file-bookmark-groups', {
      method: 'POST',
      body: input,
    })
  }

updateFileBookmarkGroup(id: string, input: FileBookmarkGroupInput) {
    return this.request<FileBookmarkGroup>(`/api/v1/file-bookmark-groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteFileBookmarkGroup(id: string) {
    return this.request<void>(`/api/v1/file-bookmark-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

reorderFileBookmarkGroups(items: FileBookmarkGroupReorderItem[]) {
    return this.request<FileBookmarkGroup[]>('/api/v1/file-bookmark-groups/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

fileBookmarks() {
    return this.request<FileBookmark[]>('/api/v1/file-bookmarks').then(normalizeArray)
  }

createFileBookmark(input: FileBookmarkInput) {
    return this.request<FileBookmark>('/api/v1/file-bookmarks', {
      method: 'POST',
      body: input,
    })
  }

updateFileBookmark(id: string, input: FileBookmarkInput) {
    return this.request<FileBookmark>(`/api/v1/file-bookmarks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteFileBookmark(id: string) {
    return this.request<void>(`/api/v1/file-bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

reorderFileBookmarks(items: FileBookmarkReorderItem[]) {
    return this.request<FileBookmark[]>('/api/v1/file-bookmarks/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

localPathMappings() {
    return this.request<LocalPathMapping[]>('/api/v1/local-path-mappings').then(normalizeArray)
  }

createLocalPathMapping(input: LocalPathMappingInput) {
    return this.request<LocalPathMapping>('/api/v1/local-path-mappings', {
      method: 'POST',
      body: input,
    })
  }

updateLocalPathMapping(id: string, input: LocalPathMappingInput) {
    return this.request<LocalPathMapping>(`/api/v1/local-path-mappings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteLocalPathMapping(id: string) {
    return this.request<void>(`/api/v1/local-path-mappings/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

reorderLocalPathMappings(items: LocalPathMappingReorderItem[]) {
    return this.request<LocalPathMapping[]>('/api/v1/local-path-mappings/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

localPathMappingChildren(id: string, path = '', signal?: AbortSignal) {
    const query = path ? `?${new URLSearchParams({ path }).toString()}` : ''
    return this.request<LocalTreeEntry[]>(
      `/api/v1/local-path-mappings/${encodeURIComponent(id)}/children${query}`,
      { signal },
    ).then(normalizeArray)
  }

localPathMappingStat(id: string, path = '', signal?: AbortSignal) {
    const query = path ? `?${new URLSearchParams({ path }).toString()}` : ''
    return this.request<LocalTreeEntry>(
      `/api/v1/local-path-mappings/${encodeURIComponent(id)}/stat${query}`,
      { signal },
    )
  }
}
