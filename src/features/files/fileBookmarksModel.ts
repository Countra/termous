import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupReorderItem,
  FileBookmarkReorderItem,
} from '../../types/domain'
import { normalizeRemotePosixPath } from '#shared/path'

export interface BookmarkGroupView {
  id: string
  name: string
  sortOrder: number
  builtIn?: boolean
  items: FileBookmark[]
}

export interface BookmarkRailItem {
  bookmark: FileBookmark
  groupId: string
  groupName: string
  startsGroup: boolean
}

export type BookmarkDropPlacement = 'auto' | 'before' | 'after'

const ungroupedSortOrder = Number.MAX_SAFE_INTEGER

export function buildBookmarkGroups(
  groups: readonly FileBookmarkGroup[],
  bookmarks: readonly FileBookmark[],
  ungroupedName: string,
): BookmarkGroupView[] {
  const orderedGroups = [...groups].sort(sortBookmarkGroups)
  const knownGroupIds = new Set(orderedGroups.map((group) => group.id))
  const bookmarksByGroup = new Map<string, FileBookmark[]>()

  bookmarks.forEach((bookmark) => {
    const groupId = bookmark.group_id && knownGroupIds.has(bookmark.group_id) ? bookmark.group_id : ''
    const items = bookmarksByGroup.get(groupId) ?? []
    items.push(bookmark)
    bookmarksByGroup.set(groupId, items)
  })

  const views: BookmarkGroupView[] = orderedGroups.map((group) => ({
    id: group.id,
    name: group.name,
    sortOrder: group.sort_order,
    items: sortBookmarks(bookmarksByGroup.get(group.id) ?? []),
  }))
  views.push({
    id: '',
    name: ungroupedName,
    sortOrder: ungroupedSortOrder,
    builtIn: true,
    items: sortBookmarks(bookmarksByGroup.get('') ?? []),
  })

  return views
}

export function filterBookmarkGroups(
  groups: readonly BookmarkGroupView[],
  query: string,
): BookmarkGroupView[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    return [...groups]
  }

  return groups.flatMap((group) => {
    const groupMatches = group.name.toLocaleLowerCase().includes(normalizedQuery)
    const items = groupMatches
      ? group.items
      : group.items.filter((bookmark) => (
          bookmark.name.toLocaleLowerCase().includes(normalizedQuery)
          || bookmark.path.toLocaleLowerCase().includes(normalizedQuery)
        ))
    return groupMatches || items.length > 0 ? [{ ...group, items }] : []
  })
}

export function flattenBookmarksForRail(
  groups: readonly FileBookmarkGroup[],
  bookmarks: readonly FileBookmark[],
  ungroupedName: string,
): BookmarkRailItem[] {
  return buildBookmarkGroups(groups, bookmarks, ungroupedName).flatMap((group) => (
    group.items.map((bookmark, index) => ({
      bookmark,
      groupId: group.id,
      groupName: group.name,
      startsGroup: index === 0,
    }))
  ))
}

export function findBookmarkForPath(
  bookmarks: readonly FileBookmark[],
  path: string,
): FileBookmark | null {
  const normalizedPath = normalizeRemotePosixPath(path)
  if (!normalizedPath) {
    return null
  }
  return sortBookmarks(
    bookmarks.filter((bookmark) => normalizeRemotePosixPath(bookmark.path) === normalizedPath),
  )[0] ?? null
}

export function suggestBookmarkName(path: string) {
  const normalizedPath = normalizeRemotePosixPath(path) ?? '/'
  return normalizedPath.split('/').filter(Boolean).pop() ?? '/'
}

export function buildBookmarkReorderItems(
  bookmarks: readonly FileBookmark[],
  draggingId: string,
  targetGroupId: string,
  targetBookmarkId: string | null,
  sortingEnabled = true,
  placement: BookmarkDropPlacement = 'auto',
  knownGroupIds?: readonly string[],
): FileBookmarkReorderItem[] {
  if (!sortingEnabled) {
    return []
  }
  const dragging = bookmarks.find((bookmark) => bookmark.id === draggingId)
  if (!dragging || targetBookmarkId === draggingId) {
    return []
  }

  const knownGroups = knownGroupIds ? new Set(knownGroupIds) : null
  const normalizeGroupId = (groupId: string) => (
    knownGroups && (!groupId || !knownGroups.has(groupId)) ? '' : groupId
  )
  const normalizedTargetGroupId = normalizeGroupId(targetGroupId)
  const originalTargetItems = sortBookmarks(
    bookmarks.filter((bookmark) => normalizeGroupId(bookmark.group_id) === normalizedTargetGroupId),
  )
  const originalDraggingIndex = originalTargetItems.findIndex(
    (bookmark) => bookmark.id === draggingId,
  )
  const originalTargetIndex = targetBookmarkId
    ? originalTargetItems.findIndex((bookmark) => bookmark.id === targetBookmarkId)
    : originalTargetItems.length
  const insertAfterTarget = placement === 'after' || (
    placement === 'auto'
    && originalDraggingIndex >= 0
    && originalTargetIndex >= 0
    && originalDraggingIndex < originalTargetIndex
  )
  const buckets = new Map<string, FileBookmark[]>()
  bookmarks
    .filter((bookmark) => bookmark.id !== draggingId)
    .forEach((bookmark) => {
      const groupId = normalizeGroupId(bookmark.group_id)
      const items = buckets.get(groupId) ?? []
      items.push({ ...bookmark, group_id: groupId })
      buckets.set(groupId, items)
    })

  const targetItems = sortBookmarks(buckets.get(normalizedTargetGroupId) ?? [])
  const targetIndex = targetBookmarkId
    ? targetItems.findIndex((bookmark) => bookmark.id === targetBookmarkId)
    : targetItems.length
  if (targetIndex < 0) {
    return []
  }

  const insertionIndex = Math.min(
    targetItems.length,
    targetIndex + (targetBookmarkId && insertAfterTarget ? 1 : 0),
  )
  targetItems.splice(insertionIndex, 0, {
    ...dragging,
    group_id: normalizedTargetGroupId,
  })
  buckets.set(normalizedTargetGroupId, targetItems)
  return Array.from(buckets.entries()).flatMap(([groupId, items]) => (
    (groupId === normalizedTargetGroupId ? items : sortBookmarks(items)).map((bookmark, index) => ({
      id: bookmark.id,
      group_id: groupId,
      sort_order: index,
    }))
  ))
}

export function buildGroupReorderItems(
  groups: readonly FileBookmarkGroup[],
  draggingId: string,
  targetId: string,
  sortingEnabled = true,
  placement: BookmarkDropPlacement = 'auto',
): FileBookmarkGroupReorderItem[] {
  if (!sortingEnabled) {
    return []
  }
  const ordered = [...groups].sort(sortBookmarkGroups)
  const dragging = ordered.find((group) => group.id === draggingId)
  if (!dragging || draggingId === targetId) {
    return []
  }

  const originalDraggingIndex = ordered.findIndex((group) => group.id === draggingId)
  const originalTargetIndex = ordered.findIndex((group) => group.id === targetId)
  const insertAfterTarget = placement === 'after' || (
    placement === 'auto'
    && originalDraggingIndex >= 0
    && originalTargetIndex >= 0
    && originalDraggingIndex < originalTargetIndex
  )
  const next = ordered.filter((group) => group.id !== draggingId)
  const targetIndex = next.findIndex((group) => group.id === targetId)
  if (targetIndex < 0) {
    return []
  }
  next.splice(targetIndex + (insertAfterTarget ? 1 : 0), 0, dragging)
  return next.map((group, index) => ({ id: group.id, sort_order: index }))
}

export function buildBookmarkStepReorderItems(
  bookmarks: readonly FileBookmark[],
  bookmarkId: string,
  direction: -1 | 1,
  knownGroupIds?: readonly string[],
): FileBookmarkReorderItem[] {
  const knownGroups = knownGroupIds ? new Set(knownGroupIds) : null
  const normalizeGroupId = (groupId: string) => (
    knownGroups && (!groupId || !knownGroups.has(groupId)) ? '' : groupId
  )
  const bookmark = bookmarks.find((item) => item.id === bookmarkId)
  if (!bookmark) {
    return []
  }
  const groupId = normalizeGroupId(bookmark.group_id)
  const siblings = sortBookmarks(
    bookmarks.filter((item) => normalizeGroupId(item.group_id) === groupId),
  )
  const currentIndex = siblings.findIndex((item) => item.id === bookmarkId)
  const target = siblings[currentIndex + direction]
  if (!target) {
    return []
  }
  return buildBookmarkReorderItems(
    bookmarks,
    bookmarkId,
    groupId,
    target.id,
    true,
    direction < 0 ? 'before' : 'after',
    knownGroupIds,
  )
}

export function buildGroupStepReorderItems(
  groups: readonly FileBookmarkGroup[],
  groupId: string,
  direction: -1 | 1,
): FileBookmarkGroupReorderItem[] {
  const ordered = [...groups].sort(sortBookmarkGroups)
  const currentIndex = ordered.findIndex((group) => group.id === groupId)
  const target = ordered[currentIndex + direction]
  if (!target) {
    return []
  }
  return buildGroupReorderItems(
    groups,
    groupId,
    target.id,
    true,
    direction < 0 ? 'before' : 'after',
  )
}

export function sortBookmarkGroups(left: FileBookmarkGroup, right: FileBookmarkGroup) {
  if (left.sort_order !== right.sort_order) {
    return left.sort_order - right.sort_order
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  return left.id.localeCompare(right.id)
}

export function sortBookmarks(bookmarks: readonly FileBookmark[]) {
  return [...bookmarks].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }
    return left.id.localeCompare(right.id)
  })
}
