import { App as AntdApp, Button, Empty, Input, Modal, Popconfirm, Select, Tooltip } from 'antd'
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '../../components/ui/EmptyState'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
} from '../../types/domain'
import { normalizeRemotePath } from './fileUtils'

interface FileBookmarksPanelProps {
  bookmarks: FileBookmark[]
  groups: FileBookmarkGroup[]
  currentPath: string
  connected: boolean
  onNavigate: (path: string) => Promise<void> | void
  onCreateBookmark: (input: FileBookmarkInput) => Promise<FileBookmark>
  onUpdateBookmark: (id: string, input: FileBookmarkInput) => Promise<FileBookmark>
  onDeleteBookmark: (id: string) => Promise<void>
  onReorderBookmarks: (items: FileBookmarkReorderItem[]) => Promise<FileBookmark[]>
  onCreateGroup: (input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  onUpdateGroup: (id: string, input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  onDeleteGroup: (id: string) => Promise<void>
  onReorderGroups: (items: FileBookmarkGroupReorderItem[]) => Promise<FileBookmarkGroup[]>
}

type BookmarkDraft = FileBookmarkInput & { id?: string }
type GroupDraft = FileBookmarkGroupInput & { id?: string }

interface BookmarkGroupView {
  id: string
  name: string
  sort_order: number
  readonly builtIn?: boolean
  items: FileBookmark[]
}

const ungroupedSortOrder = Number.MAX_SAFE_INTEGER

export function FileBookmarksPanel({
  bookmarks,
  groups,
  currentPath,
  connected,
  onNavigate,
  onCreateBookmark,
  onUpdateBookmark,
  onDeleteBookmark,
  onReorderBookmarks,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onReorderGroups,
}: FileBookmarksPanelProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([])
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null)
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null)
  const [savingBookmark, setSavingBookmark] = useState(false)
  const [savingGroup, setSavingGroup] = useState(false)
  const [draggingBookmarkId, setDraggingBookmarkId] = useState('')
  const [bookmarkDropTarget, setBookmarkDropTarget] = useState<{ groupId: string; index: number } | null>(null)
  const [draggingGroupId, setDraggingGroupId] = useState('')
  const [groupDropTargetId, setGroupDropTargetId] = useState('')

  const normalizedCurrentPath = normalizeRemotePath(currentPath || '/')
  const groupViews = useMemo(
    () => buildBookmarkGroups(groups, bookmarks, t('files.bookmarksUngrouped')),
    [bookmarks, groups, t],
  )
  const groupOptions = useMemo(
    () => [
      { value: '', label: t('files.bookmarksUngrouped') },
      ...[...groups]
        .sort(sortGroups)
        .map((group) => ({ value: group.id, label: group.name })),
    ],
    [groups, t],
  )

  const notifyError = (error: unknown) => {
    notification.error({
      message: t('files.bookmarkActionFailed'),
      description: error instanceof Error ? error.message : t('app.error'),
      placement: 'topRight',
      duration: 3.2,
    })
  }

  const openCreateBookmark = (groupId = '') => {
    setBookmarkDraft({
      name: suggestBookmarkName(normalizedCurrentPath),
      path: normalizedCurrentPath,
      group_id: groupId,
    })
  }

  const saveBookmark = async () => {
    if (!bookmarkDraft) {
      return
    }
    const input = {
      name: bookmarkDraft.name.trim(),
      path: normalizeRemotePath(bookmarkDraft.path),
      group_id: bookmarkDraft.group_id,
    }
    if (!input.name) {
      notification.warning({ message: t('files.bookmarkNameRequired'), placement: 'topRight', duration: 2.4 })
      return
    }
    setSavingBookmark(true)
    try {
      if (bookmarkDraft.id) {
        await onUpdateBookmark(bookmarkDraft.id, input)
      } else {
        await onCreateBookmark(input)
      }
      setBookmarkDraft(null)
    } catch (error) {
      notifyError(error)
    } finally {
      setSavingBookmark(false)
    }
  }

  const saveGroup = async () => {
    if (!groupDraft) {
      return
    }
    const input = { name: groupDraft.name.trim() }
    if (!input.name) {
      notification.warning({ message: t('files.groupNameRequired'), placement: 'topRight', duration: 2.4 })
      return
    }
    setSavingGroup(true)
    try {
      if (groupDraft.id) {
        await onUpdateGroup(groupDraft.id, input)
      } else {
        await onCreateGroup(input)
      }
      setGroupDraft(null)
    } catch (error) {
      notifyError(error)
    } finally {
      setSavingGroup(false)
    }
  }

  const jumpToBookmark = async (bookmark: FileBookmark) => {
    if (!connected) {
      notification.warning({
        message: t('files.bookmarkNoSession'),
        placement: 'topRight',
        duration: 2.8,
      })
      return
    }
    try {
      await onNavigate(bookmark.path)
    } catch (error) {
      notifyError(error)
    }
  }

  const toggleGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => (
      current.includes(groupId)
        ? current.filter((item) => item !== groupId)
        : [...current, groupId]
    ))
  }

  const deleteBookmark = async (id: string) => {
    try {
      await onDeleteBookmark(id)
    } catch (error) {
      notifyError(error)
    }
  }

  const deleteGroup = async (id: string) => {
    try {
      await onDeleteGroup(id)
    } catch (error) {
      notifyError(error)
    }
  }

  const handleBookmarkDrop = async (groupId: string, index: number) => {
    if (!draggingBookmarkId) {
      return
    }
    const items = buildBookmarkReorderItems(bookmarks, draggingBookmarkId, groupId, index)
    setDraggingBookmarkId('')
    setBookmarkDropTarget(null)
    if (items.length === 0) {
      return
    }
    try {
      await onReorderBookmarks(items)
    } catch (error) {
      notifyError(error)
    }
  }

  const handleGroupDrop = async (targetGroupId: string) => {
    if (!draggingGroupId || draggingGroupId === targetGroupId) {
      return
    }
    const items = buildGroupReorderItems(groups, draggingGroupId, targetGroupId)
    setDraggingGroupId('')
    setGroupDropTargetId('')
    if (items.length === 0) {
      return
    }
    try {
      await onReorderGroups(items)
    } catch (error) {
      notifyError(error)
    }
  }

  const handleDragEnd = () => {
    setDraggingBookmarkId('')
    setBookmarkDropTarget(null)
    setDraggingGroupId('')
    setGroupDropTargetId('')
  }

  return (
    <section className="files-bookmarks-panel">
      <div className="files-bookmarks-toolbar">
        <div className="files-bookmarks-current">
          <span>{t('files.bookmarkCurrentPath')}</span>
          <strong title={normalizedCurrentPath}>{normalizedCurrentPath}</strong>
        </div>
        <Button
          className="files-bookmarks-primary"
          icon={<BookmarkPlus size={16} aria-hidden="true" />}
          onClick={() => openCreateBookmark()}
        >
          {t('files.addBookmark')}
        </Button>
      </div>

      <div className="files-bookmarks-group-actions">
        <Button icon={<Plus size={15} aria-hidden="true" />} onClick={() => setGroupDraft({ name: '' })}>
          {t('files.newBookmarkGroup')}
        </Button>
      </div>

      <div className="files-bookmarks-list">
        {bookmarks.length === 0 && groups.length === 0 ? (
          <EmptyState title={t('files.noBookmarks')} description={t('files.noBookmarksHint')} />
        ) : (
          groupViews.map((group) => {
            const collapsed = collapsedGroupIds.includes(group.id)
            const dropAtGroupEnd = bookmarkDropTarget?.groupId === group.id && bookmarkDropTarget.index === group.items.length
            return (
              <section
                key={group.id}
                className={`files-bookmark-group ${groupDropTargetId === group.id ? 'is-group-drop-target' : ''}`}
                onDragOver={(event) => {
                  if (!draggingGroupId || group.builtIn) {
                    return
                  }
                  event.preventDefault()
                  setGroupDropTargetId(group.id)
                }}
                onDrop={() => void handleGroupDrop(group.id)}
              >
                <header className="files-bookmark-group-header">
                  <button type="button" className="files-bookmark-group-toggle" onClick={() => toggleGroup(group.id)}>
                    {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    <span>{group.name}</span>
                    <small>{group.items.length}</small>
                  </button>
                  {!group.builtIn ? (
                    <span
                      className="files-bookmark-group-grip"
                      draggable
                      onDragStart={(event) => {
                        setDraggingGroupId(group.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={handleDragEnd}
                    >
                      <GripVertical size={14} aria-hidden="true" />
                    </span>
                  ) : null}
                  <Button size="small" type="text" icon={<Plus size={14} aria-hidden="true" />} onClick={() => openCreateBookmark(group.id)} />
                  {!group.builtIn ? (
                    <>
                      <Button
                        size="small"
                        type="text"
                        icon={<Pencil size={14} aria-hidden="true" />}
                        onClick={() => setGroupDraft({ id: group.id, name: group.name })}
                      />
                      <Popconfirm
                        title={t('files.deleteBookmarkGroupTitle')}
                        description={t('files.deleteBookmarkGroupHint')}
                        okText={t('app.delete')}
                        cancelText={t('app.cancel')}
                        onConfirm={() => void deleteGroup(group.id)}
                      >
                        <Button size="small" type="text" danger icon={<Trash2 size={14} aria-hidden="true" />} />
                      </Popconfirm>
                    </>
                  ) : null}
                </header>

                {!collapsed ? (
                  <div
                    className={`files-bookmark-group-body ${dropAtGroupEnd ? 'is-bookmark-drop-target' : ''}`}
                    onDragOver={(event) => {
                      if (!draggingBookmarkId) {
                        return
                      }
                      event.preventDefault()
                      setBookmarkDropTarget({ groupId: group.id, index: group.items.length })
                    }}
                    onDrop={() => void handleBookmarkDrop(group.id, group.items.length)}
                  >
                    {group.items.length === 0 ? (
                      <div className="files-bookmark-group-empty">
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('files.emptyBookmarkGroup')} />
                      </div>
                    ) : (
                      group.items.map((bookmark, index) => {
                        const dropAtBookmark = bookmarkDropTarget?.groupId === group.id && bookmarkDropTarget.index === index
                        return (
                          <BookmarkRow
                            key={bookmark.id}
                            bookmark={bookmark}
                            connected={connected}
                            dropTarget={dropAtBookmark}
                            onDragEnd={handleDragEnd}
                            onDragStart={(event) => {
                              setDraggingBookmarkId(bookmark.id)
                              event.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragOver={(event) => {
                              if (!draggingBookmarkId || draggingBookmarkId === bookmark.id) {
                                return
                              }
                              event.preventDefault()
                              event.stopPropagation()
                              setBookmarkDropTarget({ groupId: group.id, index })
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              void handleBookmarkDrop(group.id, index)
                            }}
                            onJump={() => void jumpToBookmark(bookmark)}
                            onEdit={() => setBookmarkDraft({
                              id: bookmark.id,
                              name: bookmark.name,
                              path: bookmark.path,
                              group_id: bookmark.group_id,
                            })}
                            onDelete={() => void deleteBookmark(bookmark.id)}
                          />
                        )
                      })
                    )}
                  </div>
                ) : null}
              </section>
            )
          })
        )}
      </div>

      <Modal
        open={Boolean(bookmarkDraft)}
        title={bookmarkDraft?.id ? t('files.editBookmark') : t('files.addBookmark')}
        className="termous-modal files-bookmark-modal"
        okText={bookmarkDraft?.id ? t('app.save') : t('app.create')}
        cancelText={t('app.cancel')}
        confirmLoading={savingBookmark}
        onCancel={() => setBookmarkDraft(null)}
        onOk={() => void saveBookmark()}
        centered
      >
        <div className="files-bookmark-form">
          <label>
            <span>{t('files.bookmarkName')}</span>
            <Input
              value={bookmarkDraft?.name ?? ''}
              placeholder={t('files.bookmarkNamePlaceholder')}
              onChange={(event) => setBookmarkDraft((current) => current ? { ...current, name: event.target.value } : current)}
            />
          </label>
          <label>
            <span>{t('files.bookmarkPath')}</span>
            <Input
              value={bookmarkDraft?.path ?? ''}
              placeholder="/root"
              onChange={(event) => setBookmarkDraft((current) => current ? { ...current, path: event.target.value } : current)}
            />
          </label>
          <label>
            <span>{t('files.bookmarkGroup')}</span>
            <Select
              value={bookmarkDraft?.group_id ?? ''}
              options={groupOptions}
              onChange={(groupId) => setBookmarkDraft((current) => current ? { ...current, group_id: groupId } : current)}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(groupDraft)}
        title={groupDraft?.id ? t('files.editBookmarkGroup') : t('files.newBookmarkGroup')}
        className="termous-modal files-bookmark-modal"
        okText={groupDraft?.id ? t('app.save') : t('app.create')}
        cancelText={t('app.cancel')}
        confirmLoading={savingGroup}
        onCancel={() => setGroupDraft(null)}
        onOk={() => void saveGroup()}
        centered
      >
        <div className="files-bookmark-form">
          <label>
            <span>{t('files.bookmarkGroupName')}</span>
            <Input
              value={groupDraft?.name ?? ''}
              placeholder={t('files.bookmarkGroupNamePlaceholder')}
              onChange={(event) => setGroupDraft((current) => current ? { ...current, name: event.target.value } : current)}
            />
          </label>
        </div>
      </Modal>
    </section>
  )
}

function BookmarkRow({
  bookmark,
  connected,
  dropTarget,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onJump,
  onEdit,
  onDelete,
}: {
  bookmark: FileBookmark
  connected: boolean
  dropTarget: boolean
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onJump: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <article
      className={`files-bookmark-row ${dropTarget ? 'is-bookmark-drop-target' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
    >
      <span className="files-bookmark-drag-handle">
        <GripVertical size={14} aria-hidden="true" />
      </span>
      <Tooltip title={connected ? bookmark.path : t('files.bookmarkNoSession')}>
        <button type="button" className="files-bookmark-main" onClick={onJump}>
          <span className="files-bookmark-icon">
            <Bookmark size={15} aria-hidden="true" />
          </span>
          <span className="files-bookmark-copy">
            <strong>{bookmark.name}</strong>
            <small>{bookmark.path}</small>
          </span>
          <CornerDownRight size={14} aria-hidden="true" />
        </button>
      </Tooltip>
      <div className="files-bookmark-row-actions">
        <Button size="small" type="text" icon={<Pencil size={14} aria-hidden="true" />} onClick={onEdit} />
        <Popconfirm
          title={t('files.deleteBookmarkTitle')}
          okText={t('app.delete')}
          cancelText={t('app.cancel')}
          onConfirm={onDelete}
        >
          <Button size="small" type="text" danger icon={<Trash2 size={14} aria-hidden="true" />} />
        </Popconfirm>
      </div>
    </article>
  )
}

function buildBookmarkGroups(groups: FileBookmarkGroup[], bookmarks: FileBookmark[], ungroupedName: string): BookmarkGroupView[] {
  const orderedGroups = [...groups].sort(sortGroups)
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
    sort_order: group.sort_order,
    items: sortBookmarks(bookmarksByGroup.get(group.id) ?? []),
  }))
  views.push({
    id: '',
    name: ungroupedName,
    sort_order: ungroupedSortOrder,
    builtIn: true,
    items: sortBookmarks(bookmarksByGroup.get('') ?? []),
  })
  return views.filter((view) => view.items.length > 0 || !view.builtIn || bookmarks.length === 0)
}

function buildBookmarkReorderItems(bookmarks: FileBookmark[], draggingId: string, targetGroupId: string, targetIndex: number): FileBookmarkReorderItem[] {
  const dragging = bookmarks.find((bookmark) => bookmark.id === draggingId)
  if (!dragging) {
    return []
  }
  const buckets = new Map<string, FileBookmark[]>()
  bookmarks
    .filter((bookmark) => bookmark.id !== draggingId)
    .forEach((bookmark) => {
      const items = buckets.get(bookmark.group_id) ?? []
      items.push(bookmark)
      buckets.set(bookmark.group_id, items)
    })
  const targetItems = sortBookmarks(buckets.get(targetGroupId) ?? [])
  targetItems.splice(Math.max(0, Math.min(targetIndex, targetItems.length)), 0, { ...dragging, group_id: targetGroupId })
  buckets.set(targetGroupId, targetItems)
  return Array.from(buckets.entries()).flatMap(([groupId, items]) =>
    (groupId === targetGroupId ? items : sortBookmarks(items)).map((bookmark, index) => ({
      id: bookmark.id,
      group_id: groupId,
      sort_order: index,
    })),
  )
}

function buildGroupReorderItems(groups: FileBookmarkGroup[], draggingId: string, targetId: string): FileBookmarkGroupReorderItem[] {
  const ordered = [...groups].sort(sortGroups)
  const dragging = ordered.find((group) => group.id === draggingId)
  if (!dragging) {
    return []
  }
  const next = ordered.filter((group) => group.id !== draggingId)
  const targetIndex = Math.max(0, next.findIndex((group) => group.id === targetId))
  next.splice(targetIndex, 0, dragging)
  return next.map((group, index) => ({ id: group.id, sort_order: index }))
}

function suggestBookmarkName(path: string) {
  const normalized = normalizeRemotePath(path || '/')
  const leaf = normalized.split('/').filter(Boolean).pop()
  return leaf || '/'
}

function sortGroups(left: FileBookmarkGroup, right: FileBookmarkGroup) {
  if (left.sort_order !== right.sort_order) {
    return left.sort_order - right.sort_order
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  return left.id.localeCompare(right.id)
}

function sortBookmarks(bookmarks: FileBookmark[]) {
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
