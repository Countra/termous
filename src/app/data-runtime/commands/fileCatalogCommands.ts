import type { FileCatalogCommandGateway } from '../api/runtimeGatewayContracts'
import type {
  FileBookmark,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
} from '#entities/file'
import {
  sortFileBookmarkGroups,
  sortFileBookmarks,
  sortLocalPathMappings,
  upsertFileBookmark,
  upsertFileBookmarkGroup,
  upsertLocalPathMapping,
} from '../model/appDataState'
import type { SetAppData } from '../model/runtimeTypes'

export function createFileCatalogCommands(api: FileCatalogCommandGateway, setData: SetAppData) {
  return {
    async createFileBookmarkGroup(input: FileBookmarkGroupInput) {
      const group = await api.createFileBookmarkGroup(input)
      setData((current) => ({ ...current, fileBookmarkGroups: upsertFileBookmarkGroup(current.fileBookmarkGroups, group) }))
      return group
    },
    async updateFileBookmarkGroup(id: string, input: FileBookmarkGroupInput) {
      const group = await api.updateFileBookmarkGroup(id, input)
      setData((current) => ({ ...current, fileBookmarkGroups: upsertFileBookmarkGroup(current.fileBookmarkGroups, group) }))
      return group
    },
    async deleteFileBookmarkGroup(id: string) {
      await api.deleteFileBookmarkGroup(id)
      let nextBookmarks: FileBookmark[] | null = null
      try {
        nextBookmarks = await api.fileBookmarks()
      } catch {
        nextBookmarks = null
      }
      setData((current) => ({
        ...current,
        fileBookmarkGroups: current.fileBookmarkGroups.filter((group) => group.id !== id),
        fileBookmarks: nextBookmarks
          ? sortFileBookmarks(nextBookmarks)
          : sortFileBookmarks(current.fileBookmarks.map((bookmark) => (
            bookmark.group_id === id ? { ...bookmark, group_id: '' } : bookmark
          ))),
      }))
    },
    async reorderFileBookmarkGroups(items: FileBookmarkGroupReorderItem[]) {
      const groups = await api.reorderFileBookmarkGroups(items)
      setData((current) => ({ ...current, fileBookmarkGroups: sortFileBookmarkGroups(groups ?? current.fileBookmarkGroups) }))
      return groups
    },
    async createFileBookmark(input: FileBookmarkInput) {
      const bookmark = await api.createFileBookmark(input)
      setData((current) => ({ ...current, fileBookmarks: upsertFileBookmark(current.fileBookmarks, bookmark) }))
      return bookmark
    },
    async updateFileBookmark(id: string, input: FileBookmarkInput) {
      const bookmark = await api.updateFileBookmark(id, input)
      setData((current) => ({ ...current, fileBookmarks: upsertFileBookmark(current.fileBookmarks, bookmark) }))
      return bookmark
    },
    async deleteFileBookmark(id: string) {
      await api.deleteFileBookmark(id)
      setData((current) => ({ ...current, fileBookmarks: current.fileBookmarks.filter((bookmark) => bookmark.id !== id) }))
    },
    async reorderFileBookmarks(items: FileBookmarkReorderItem[]) {
      const bookmarks = await api.reorderFileBookmarks(items)
      setData((current) => ({ ...current, fileBookmarks: sortFileBookmarks(bookmarks ?? current.fileBookmarks) }))
      return bookmarks
    },
    async createLocalPathMapping(input: LocalPathMappingInput) {
      const mapping = await api.createLocalPathMapping(input)
      setData((current) => ({ ...current, localPathMappings: upsertLocalPathMapping(current.localPathMappings, mapping) }))
      return mapping
    },
    async updateLocalPathMapping(id: string, input: LocalPathMappingInput) {
      const mapping = await api.updateLocalPathMapping(id, input)
      setData((current) => ({ ...current, localPathMappings: upsertLocalPathMapping(current.localPathMappings, mapping) }))
      return mapping
    },
    async deleteLocalPathMapping(id: string) {
      await api.deleteLocalPathMapping(id)
      setData((current) => ({ ...current, localPathMappings: current.localPathMappings.filter((mapping) => mapping.id !== id) }))
    },
    async reorderLocalPathMappings(items: LocalPathMappingReorderItem[]) {
      const mappings = await api.reorderLocalPathMappings(items)
      setData((current) => ({ ...current, localPathMappings: sortLocalPathMappings(mappings ?? current.localPathMappings) }))
      return mappings
    },
  }
}
