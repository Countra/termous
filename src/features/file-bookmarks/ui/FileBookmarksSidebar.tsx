import {
  App as AntdApp,
  Button,
  Dropdown,
  Empty,
  Input,
  Popconfirm,
  Select,
  Tooltip,
  type InputRef,
  type MenuProps,
} from 'antd'
import {
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  GripVertical,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
} from '#entities/file'
import { normalizeRemotePosixPath } from '#shared/path'
import { contextActionMenuPopupClassName, uiStyles } from '#shared/ui'
import {
  buildBookmarkGroups,
  buildBookmarkReorderItems,
  buildBookmarkStepReorderItems,
  buildGroupStepReorderItems,
  buildGroupReorderItems,
  filterBookmarkGroups,
  findBookmarkForPath,
  sortBookmarkGroups,
  suggestBookmarkName,
  type BookmarkDropPlacement,
  type BookmarkGroupView,
} from '#entities/file'
import styles from './FileBookmarksSidebar.module.scss'
import tooltipStyles from './BookmarkTooltip.module.scss'

export type FileBookmarksSidebarCloseReason = 'dismiss' | 'navigation'

export interface FileBookmarksSidebarProps {
  bookmarks: FileBookmark[]
  groups: FileBookmarkGroup[]
  currentPath: string
  connected: boolean
  open: boolean
  mutationPending: boolean
  navigationKey?: string
  panelId?: string
  onNavigate: (path: string) => Promise<boolean> | boolean
  onCreateBookmark: (input: FileBookmarkInput) => Promise<FileBookmark>
  onUpdateBookmark: (id: string, input: FileBookmarkInput) => Promise<FileBookmark>
  onDeleteBookmark: (id: string) => Promise<void>
  onReorderBookmarks: (items: FileBookmarkReorderItem[]) => Promise<FileBookmark[]>
  onCreateGroup: (input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  onUpdateGroup: (id: string, input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  onDeleteGroup: (id: string) => Promise<void>
  onReorderGroups: (items: FileBookmarkGroupReorderItem[]) => Promise<FileBookmarkGroup[]>
  onRequestClose: (reason?: FileBookmarksSidebarCloseReason) => void
}

type SidebarView =
  | { kind: 'list' }
  | { kind: 'bookmark-editor'; draft: FileBookmarkInput & { id?: string } }
  | { kind: 'group-editor'; draft: FileBookmarkGroupInput & { id?: string } }

type DeleteTarget =
  | { kind: 'bookmark'; id: string; label: string }
  | { kind: 'group'; id: string; label: string }

interface BookmarkDropTarget {
  groupId: string
  bookmarkId: string | null
  placement: Exclude<BookmarkDropPlacement, 'auto'>
}

interface BookmarkRowContext {
  bookmark: FileBookmark
  groupId: string
  groupName: string
}

const overlayMediaQuery = '(max-width: 1279px)'
const fullOverlayMediaQuery = '(max-width: 699px)'
const bookmarkFloatingLayerSelector = [
  '.ant-dropdown:not(.ant-dropdown-hidden) [data-files-bookmarks-floating-layer]',
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-files-bookmarks-floating-layer]',
].join(', ')

const renderBookmarkFloatingLayer = (content: ReactNode) => (
  <div data-files-bookmarks-floating-layer>{content}</div>
)

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => (
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  ))

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

function placementFromPointer(
  event: DragEvent<HTMLElement>,
): Exclude<BookmarkDropPlacement, 'auto'> {
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientY >= bounds.top + bounds.height / 2 ? 'after' : 'before'
}

function hasOpenBookmarkFloatingLayer() {
  return Boolean(document.querySelector(bookmarkFloatingLayerSelector))
}

export function FileBookmarksSidebar({
    bookmarks,
    groups,
    currentPath,
    connected,
    open,
    mutationPending,
    navigationKey,
    panelId = 'files-bookmarks-sidebar',
    onNavigate,
    onCreateBookmark,
    onUpdateBookmark,
    onDeleteBookmark,
    onReorderBookmarks,
    onCreateGroup,
    onUpdateGroup,
    onDeleteGroup,
    onReorderGroups,
    onRequestClose,
  }: FileBookmarksSidebarProps) {
    const { t } = useTranslation()
    const { notification } = AntdApp.useApp()
    const fullOverlay = useMediaQuery(fullOverlayMediaQuery)
    const listRef = useRef<HTMLDivElement>(null)
    const searchInputRef = useRef<InputRef>(null)
    const createButtonRef = useRef<HTMLButtonElement>(null)
    const navigationRequestRef = useRef(0)
    const editorTriggerRef = useRef<HTMLElement | null>(null)
    const editorTriggerKeyRef = useRef('')
    const deleteTriggerRef = useRef<HTMLElement | null>(null)
    const deleteTriggerKeyRef = useRef('')
    const reorderingRef = useRef(false)
    const [query, setQuery] = useState('')
    const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>([])
    const [view, setView] = useState<SidebarView>({ kind: 'list' })
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [reordering, setReordering] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
    const [navigatingBookmarkId, setNavigatingBookmarkId] = useState('')
    const [draggingBookmarkId, setDraggingBookmarkId] = useState('')
    const [bookmarkDropTarget, setBookmarkDropTarget] = useState<BookmarkDropTarget | null>(null)
    const [draggingGroupId, setDraggingGroupId] = useState('')
    const [groupDropTarget, setGroupDropTarget] = useState<{
      id: string
      placement: Exclude<BookmarkDropPlacement, 'auto'>
    } | null>(null)
    const mutationBlocked = mutationPending
      || reordering
      || deleting
      || Boolean(deleteTarget)

    const normalizedCurrentPath = normalizeRemotePosixPath(currentPath) ?? '/'
    const searchActive = query.trim().length > 0
    const groupViews = useMemo(
      () => buildBookmarkGroups(groups, bookmarks, t('files.bookmarksUngrouped')),
      [bookmarks, groups, t],
    )
    const visibleGroups = useMemo(
      () => filterBookmarkGroups(groupViews, query),
      [groupViews, query],
    )
    const searchRows = useMemo<BookmarkRowContext[]>(
      () => visibleGroups.flatMap((group) => (
        group.items.map((bookmark) => ({
          bookmark,
          groupId: group.id,
          groupName: group.name,
        }))
      )),
      [visibleGroups],
    )
    const currentBookmark = useMemo(
      () => findBookmarkForPath(bookmarks, normalizedCurrentPath),
      [bookmarks, normalizedCurrentPath],
    )
    const currentGroupId = useMemo(
      () => groupViews.find((group) => (
        group.items.some((bookmark) => bookmark.id === currentBookmark?.id)
      ))?.id ?? '',
      [currentBookmark?.id, groupViews],
    )
    const notifyError = useCallback((error: unknown) => {
      notification.error({
        message: t('files.bookmarkActionFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
        placement: 'topRight',
        duration: 3.2,
      })
    }, [notification, t])

    const resetDragState = useCallback(() => {
      setDraggingBookmarkId('')
      setBookmarkDropTarget(null)
      setDraggingGroupId('')
      setGroupDropTarget(null)
    }, [])

    const restoreFocus = useCallback((trigger: HTMLElement | null, focusKey: string) => {
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) {
          trigger.focus({ preventScroll: true })
          return
        }
        const keyedTrigger = Array.from(
          listRef.current?.parentElement?.querySelectorAll<HTMLElement>('[data-bookmark-focus-key]') ?? [],
        ).find((element) => element.dataset.bookmarkFocusKey === focusKey)
        ;(keyedTrigger ?? listRef.current)?.focus({ preventScroll: true })
      })
    }, [])

    const restoreEditorTriggerFocus = useCallback(() => {
      const trigger = editorTriggerRef.current
      const focusKey = editorTriggerKeyRef.current
      editorTriggerRef.current = null
      editorTriggerKeyRef.current = ''
      restoreFocus(trigger, focusKey)
    }, [restoreFocus])

    const closeEditor = useCallback(() => {
      setView({ kind: 'list' })
      restoreEditorTriggerFocus()
    }, [restoreEditorTriggerFocus])

    const cancelDelete = useCallback(() => {
      setDeleteTarget(null)
      const trigger = deleteTriggerRef.current
      const focusKey = deleteTriggerKeyRef.current
      deleteTriggerRef.current = null
      deleteTriggerKeyRef.current = ''
      restoreFocus(trigger, focusKey)
    }, [restoreFocus])

    const openBookmarkEditor = useCallback((
      bookmark?: FileBookmark,
      groupId = '',
      trigger?: HTMLElement,
    ) => {
      editorTriggerRef.current = trigger ?? null
      editorTriggerKeyRef.current = trigger?.dataset.bookmarkFocusKey ?? ''
      setDeleteTarget(null)
      setView({
        kind: 'bookmark-editor',
        draft: bookmark
          ? {
              id: bookmark.id,
              name: bookmark.name,
              path: bookmark.path,
              group_id: groupId,
            }
          : {
              name: suggestBookmarkName(normalizedCurrentPath),
              path: normalizedCurrentPath,
              group_id: groupId,
            },
      })
    }, [normalizedCurrentPath])

    const openGroupEditor = useCallback((
      group?: FileBookmarkGroup,
      trigger?: HTMLElement,
    ) => {
      editorTriggerRef.current = trigger ?? null
      editorTriggerKeyRef.current = trigger?.dataset.bookmarkFocusKey ?? ''
      setDeleteTarget(null)
      setView({
        kind: 'group-editor',
        draft: group ? { id: group.id, name: group.name } : { name: '' },
      })
    }, [])

    const saveEditor = useCallback(async () => {
      if (view.kind === 'list' || saving || mutationPending) {
        return
      }

      if (view.kind === 'bookmark-editor') {
        const input: FileBookmarkInput = {
          name: view.draft.name.trim(),
          path: normalizeRemotePosixPath(view.draft.path) ?? '',
          group_id: view.draft.group_id,
        }
        if (!input.name) {
          notification.warning({
            message: t('files.bookmarkNameRequired'),
            placement: 'topRight',
            duration: 2.4,
          })
          return
        }
        if (!input.path) {
          notification.warning({
            message: t('files.bookmarkPathRequired'),
            placement: 'topRight',
            duration: 2.4,
          })
          return
        }
        setSaving(true)
        try {
          if (view.draft.id) {
            await onUpdateBookmark(view.draft.id, input)
          } else {
            await onCreateBookmark(input)
          }
          setView({ kind: 'list' })
          restoreEditorTriggerFocus()
        } catch (error) {
          notifyError(error)
        } finally {
          setSaving(false)
        }
        return
      }

      const input: FileBookmarkGroupInput = { name: view.draft.name.trim() }
      if (!input.name) {
        notification.warning({
          message: t('files.groupNameRequired'),
          placement: 'topRight',
          duration: 2.4,
        })
        return
      }
      setSaving(true)
      try {
        if (view.draft.id) {
          await onUpdateGroup(view.draft.id, input)
        } else {
          await onCreateGroup(input)
        }
        setView({ kind: 'list' })
        restoreEditorTriggerFocus()
      } catch (error) {
        notifyError(error)
      } finally {
        setSaving(false)
      }
    }, [
      notification,
      notifyError,
      onCreateBookmark,
      onCreateGroup,
      onUpdateBookmark,
      onUpdateGroup,
      restoreEditorTriggerFocus,
      saving,
      mutationPending,
      t,
      view,
    ])

    const openDelete = useCallback((
      target: DeleteTarget,
      trigger: HTMLElement,
    ) => {
      deleteTriggerRef.current = trigger
      deleteTriggerKeyRef.current = trigger.dataset.bookmarkFocusKey ?? ''
      setDeleteTarget(target)
    }, [])

    const confirmDelete = useCallback(async () => {
      if (!deleteTarget || deleting || mutationPending || reorderingRef.current) {
        return
      }
      const target = deleteTarget
      setDeleting(true)
      try {
        if (target.kind === 'bookmark') {
          await onDeleteBookmark(target.id)
        } else {
          await onDeleteGroup(target.id)
        }
        setDeleteTarget(null)
        deleteTriggerRef.current = null
        deleteTriggerKeyRef.current = ''
        window.requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }))
      } catch (error) {
        notifyError(error)
        cancelDelete()
      } finally {
        setDeleting(false)
      }
    }, [
      deleteTarget,
      deleting,
      mutationPending,
      cancelDelete,
      notifyError,
      onDeleteBookmark,
      onDeleteGroup,
    ])

    const navigateToBookmark = useCallback(async (bookmark: FileBookmark) => {
      if (!connected) {
        notification.warning({
          message: t('files.bookmarkNoSession'),
          placement: 'topRight',
          duration: 2.8,
        })
        return
      }
      const requestSequence = navigationRequestRef.current + 1
      navigationRequestRef.current = requestSequence
      setNavigatingBookmarkId(bookmark.id)
      try {
        const succeeded = await onNavigate(bookmark.path)
        if (navigationRequestRef.current !== requestSequence) {
          return
        }
        if (succeeded && window.matchMedia(overlayMediaQuery).matches) {
          onRequestClose('navigation')
        }
      } catch (error) {
        if (navigationRequestRef.current === requestSequence) {
          notifyError(error)
        }
      } finally {
        if (navigationRequestRef.current === requestSequence) {
          setNavigatingBookmarkId('')
        }
      }
    }, [
      connected,
      notification,
      notifyError,
      onNavigate,
      onRequestClose,
      t,
    ])

    useEffect(() => {
      navigationRequestRef.current += 1
      setNavigatingBookmarkId('')
      return () => {
        navigationRequestRef.current += 1
      }
    }, [navigationKey, open])

    useEffect(() => {
      if (!open) {
        setQuery('')
        setCollapsedGroupIds([])
        setView({ kind: 'list' })
        setDeleteTarget(null)
        resetDragState()
        return undefined
      }
      return undefined
    }, [open, resetDragState])

    useEffect(() => {
      if (!searchActive) {
        return
      }
      resetDragState()
    }, [resetDragState, searchActive])

    useEffect(() => {
      if (!open || !currentBookmark) {
        return undefined
      }
      setCollapsedGroupIds((current) => current.filter((id) => id !== currentGroupId))
      const frame = window.requestAnimationFrame(() => {
        const row = Array.from(
          listRef.current?.querySelectorAll<HTMLElement>('[data-bookmark-id]') ?? [],
        ).find((element) => element.dataset.bookmarkId === currentBookmark.id)
        row?.scrollIntoView({ block: 'nearest' })
      })
      return () => window.cancelAnimationFrame(frame)
    }, [currentBookmark, currentGroupId, navigationKey, open])

    const reorderBookmarks = useCallback(async (
      groupId: string,
      targetBookmarkId: string | null,
      placement: Exclude<BookmarkDropPlacement, 'auto'>,
    ) => {
      if (reorderingRef.current || mutationPending || deleting || deleteTarget) {
        return
      }
      const items = buildBookmarkReorderItems(
        bookmarks,
        draggingBookmarkId,
        groupId,
        targetBookmarkId,
        !searchActive,
        placement,
        groups.map((group) => group.id),
      )
      resetDragState()
      if (items.length === 0) {
        return
      }
      reorderingRef.current = true
      setReordering(true)
      try {
        await onReorderBookmarks(items)
      } catch (error) {
        notifyError(error)
      } finally {
        reorderingRef.current = false
        setReordering(false)
      }
    }, [
      bookmarks,
      draggingBookmarkId,
      groups,
      deleteTarget,
      deleting,
      mutationPending,
      notifyError,
      onReorderBookmarks,
      resetDragState,
      searchActive,
    ])

    const reorderGroups = useCallback(async (
      targetGroupId: string,
      placement: Exclude<BookmarkDropPlacement, 'auto'>,
    ) => {
      if (reorderingRef.current || mutationPending || deleting || deleteTarget) {
        return
      }
      const items = buildGroupReorderItems(
        groups,
        draggingGroupId,
        targetGroupId,
        !searchActive,
        placement,
      )
      resetDragState()
      if (items.length === 0) {
        return
      }
      reorderingRef.current = true
      setReordering(true)
      try {
        await onReorderGroups(items)
      } catch (error) {
        notifyError(error)
      } finally {
        reorderingRef.current = false
        setReordering(false)
      }
    }, [
      draggingGroupId,
      deleteTarget,
      deleting,
      groups,
      notifyError,
      mutationPending,
      onReorderGroups,
      resetDragState,
      searchActive,
    ])

    const moveBookmarkByStep = useCallback(async (
      bookmarkId: string,
      direction: -1 | 1,
    ) => {
      if (
        searchActive
        || reorderingRef.current
        || mutationPending
        || deleting
        || deleteTarget
      ) {
        return
      }
      const items = buildBookmarkStepReorderItems(
        bookmarks,
        bookmarkId,
        direction,
        groups.map((group) => group.id),
      )
      if (items.length === 0) {
        return
      }
      reorderingRef.current = true
      setReordering(true)
      try {
        await onReorderBookmarks(items)
      } catch (error) {
        notifyError(error)
      } finally {
        reorderingRef.current = false
        setReordering(false)
      }
    }, [
      bookmarks,
      deleteTarget,
      deleting,
      groups,
      notifyError,
      mutationPending,
      onReorderBookmarks,
      searchActive,
    ])

    const moveGroupByStep = useCallback(async (
      groupId: string,
      direction: -1 | 1,
    ) => {
      if (
        searchActive
        || reorderingRef.current
        || mutationPending
        || deleting
        || deleteTarget
      ) {
        return
      }
      const items = buildGroupStepReorderItems(groups, groupId, direction)
      if (items.length === 0) {
        return
      }
      reorderingRef.current = true
      setReordering(true)
      try {
        await onReorderGroups(items)
      } catch (error) {
        notifyError(error)
      } finally {
        reorderingRef.current = false
        setReordering(false)
      }
    }, [
      deleteTarget,
      deleting,
      groups,
      mutationPending,
      notifyError,
      onReorderGroups,
      searchActive,
    ])

    const handleEscape = useCallback(() => {
      if (saving || deleting) {
        return
      }
      if (deleteTarget) {
        cancelDelete()
        return
      }
      if (view.kind !== 'list') {
        closeEditor()
        return
      }
      onRequestClose('dismiss')
    }, [
      cancelDelete,
      closeEditor,
      deleting,
      deleteTarget,
      onRequestClose,
      saving,
      view.kind,
    ])

    useEffect(() => {
      if (!open) {
        return undefined
      }
      const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
        if (event.key === 'Tab' && fullOverlay && !hasOpenBookmarkFloatingLayer()) {
          const panel = document.getElementById(panelId)
          const focusable = Array.from(
            panel?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
              + '[href], [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          ).filter((element) => element.getClientRects().length > 0)
          if (focusable.length === 0) {
            event.preventDefault()
            searchInputRef.current?.input?.focus({ preventScroll: true })
            return
          }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          const active = document.activeElement
          if (event.shiftKey && (active === first || !panel?.contains(active))) {
            event.preventDefault()
            last?.focus({ preventScroll: true })
          } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
            event.preventDefault()
            first?.focus({ preventScroll: true })
          }
          return
        }
        if (
          event.key !== 'Escape'
          || event.defaultPrevented
          || hasOpenBookmarkFloatingLayer()
        ) {
          return
        }
        event.preventDefault()
        handleEscape()
      }
      window.addEventListener('keydown', handleWindowKeyDown)
      return () => window.removeEventListener('keydown', handleWindowKeyDown)
    }, [fullOverlay, handleEscape, open, panelId])

    const createMenu = useMemo<MenuProps>(() => ({
      items: [
        {
          key: 'bookmark',
          icon: <BookmarkPlus size={14} aria-hidden="true" />,
          label: t('files.addBookmark'),
        },
        {
          key: 'group',
          icon: <Folder size={14} aria-hidden="true" />,
          label: t('files.newBookmarkGroup'),
        },
      ],
      onClick: ({ key }) => {
        const trigger = createButtonRef.current ?? undefined
        if (key === 'group') {
          openGroupEditor(undefined, trigger)
        } else {
          openBookmarkEditor(undefined, '', trigger)
        }
      },
    }), [openBookmarkEditor, openGroupEditor, t])

    const toggleGroup = useCallback((groupId: string) => {
      if (mutationBlocked) {
        return
      }
      setCollapsedGroupIds((current) => (
        current.includes(groupId)
          ? current.filter((id) => id !== groupId)
          : [...current, groupId]
      ))
    }, [mutationBlocked])

    const groupSourceById = useMemo(
      () => new Map(groups.map((group) => [group.id, group])),
      [groups],
    )

    const renderBookmarkRow = (
      bookmark: FileBookmark,
      groupName: string,
      groupId: string,
    ) => {
      const current = currentBookmark?.id === bookmark.id
      const navigating = navigatingBookmarkId === bookmark.id
      const deleteOpen = deleteTarget?.kind === 'bookmark' && deleteTarget.id === bookmark.id
      const dropPlacement = bookmarkDropTarget?.groupId === groupId
        && bookmarkDropTarget.bookmarkId === bookmark.id
          ? bookmarkDropTarget.placement
          : null
      return (
        <SidebarBookmarkRow
          key={bookmark.id}
          bookmark={bookmark}
          groupName={groupName}
          showGroupName={searchActive}
          connected={connected}
          current={current}
          navigating={navigating}
          reordering={mutationBlocked}
          deleteOpen={deleteOpen}
          deleting={deleting}
          deleteTriggerBlocked={mutationBlocked}
          deleteConfirmBlocked={reordering || mutationPending}
          sortingDisabled={searchActive}
          dragging={draggingBookmarkId === bookmark.id}
          dropPlacement={dropPlacement}
          onNavigate={() => void navigateToBookmark(bookmark)}
          onEdit={(trigger) => openBookmarkEditor(bookmark, groupId, trigger)}
          onOpenDelete={(trigger) => openDelete({
            kind: 'bookmark',
            id: bookmark.id,
            label: bookmark.path,
          }, trigger)}
          onCancelDelete={cancelDelete}
          onConfirmDelete={confirmDelete}
          onMoveByStep={(direction) => void moveBookmarkByStep(bookmark.id, direction)}
          onDragStart={(event) => {
            if (searchActive || mutationBlocked || reorderingRef.current) {
              event.preventDefault()
              return
            }
            setDraggingBookmarkId(bookmark.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', bookmark.id)
          }}
          onDragOver={(event) => {
            if (
              mutationBlocked
              || reorderingRef.current
              || searchActive
              || !draggingBookmarkId
              || draggingBookmarkId === bookmark.id
            ) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            event.dataTransfer.dropEffect = 'move'
            setBookmarkDropTarget({
              groupId,
              bookmarkId: bookmark.id,
              placement: placementFromPointer(event),
            })
          }}
          onDragEnd={resetDragState}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const placement = bookmarkDropTarget?.groupId === groupId
              && bookmarkDropTarget.bookmarkId === bookmark.id
                ? bookmarkDropTarget.placement
                : placementFromPointer(event)
            void reorderBookmarks(groupId, bookmark.id, placement)
          }}
        />
      )
    }

    const renderGroup = (group: BookmarkGroupView) => {
      const collapsed = collapsedGroupIds.includes(group.id)
      const sourceGroup = groupSourceById.get(group.id)
      const reorderLabel = t('files.bookmarkReorderGroupLabel', { name: group.name })
      const deleteOpen = deleteTarget?.kind === 'group' && deleteTarget.id === group.id

      const groupPlacement = groupDropTarget?.id === group.id
        ? groupDropTarget.placement
        : null
      const bookmarkGroupTarget = bookmarkDropTarget?.groupId === group.id
        && bookmarkDropTarget.bookmarkId === null
      return (
        <section
          key={group.id || 'ungrouped'}
          className={[
            'files-bookmarks-sidebar-group',
            draggingGroupId === group.id ? 'is-dragging' : '',
            groupPlacement ? `is-drop-${groupPlacement}` : '',
            bookmarkGroupTarget ? 'is-bookmark-drop-target' : '',
          ].filter(Boolean).join(' ')}
        >
          <div
            className={[
              'files-bookmarks-sidebar-group-head',
              !group.builtIn ? 'has-sort-handle' : '',
            ].filter(Boolean).join(' ')}
            onDragOver={(event) => {
              if (searchActive || mutationBlocked || reorderingRef.current) {
                return
              }
              if (draggingBookmarkId) {
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
                setBookmarkDropTarget({
                  groupId: group.id,
                  bookmarkId: null,
                  placement: 'after',
                })
              } else if (draggingGroupId && !group.builtIn && draggingGroupId !== group.id) {
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
                setGroupDropTarget({
                  id: group.id,
                  placement: placementFromPointer(event),
                })
              }
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (draggingBookmarkId) {
                void reorderBookmarks(group.id, null, 'after')
              } else if (draggingGroupId && !group.builtIn) {
                const placement = groupDropTarget?.id === group.id
                  ? groupDropTarget.placement
                  : placementFromPointer(event)
                void reorderGroups(group.id, placement)
              }
            }}
          >
            {!group.builtIn ? (
              <Tooltip
                title={searchActive
                  ? t('files.bookmarkSortDisabledSearch')
                  : reorderLabel}
                placement="left"
              >
                <button
                  type="button"
                  className="files-bookmarks-sidebar-grip"
                  draggable={!searchActive && !mutationBlocked}
                  disabled={searchActive || mutationBlocked}
                  aria-label={reorderLabel}
                  onDragStart={(event) => {
                    if (searchActive || mutationBlocked || reorderingRef.current) {
                      event.preventDefault()
                      return
                    }
                    setDraggingGroupId(group.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', group.id)
                  }}
                  onDragEnd={resetDragState}
                  onKeyDown={(event) => {
                    if (
                      searchActive
                      || mutationBlocked
                      || reorderingRef.current
                      || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
                    ) {
                      return
                    }
                    event.preventDefault()
                    event.stopPropagation()
                    void moveGroupByStep(group.id, event.key === 'ArrowUp' ? -1 : 1)
                  }}
                >
                  <GripVertical size={14} aria-hidden="true" />
                </button>
              </Tooltip>
            ) : null}
            <button
              type="button"
              className="files-bookmarks-sidebar-group-toggle"
              aria-expanded={!collapsed}
              disabled={mutationBlocked}
              onClick={() => toggleGroup(group.id)}
            >
              {collapsed ? (
                <ChevronRight size={14} aria-hidden="true" />
              ) : (
                <ChevronDown size={14} aria-hidden="true" />
              )}
              <span>{group.name}</span>
              <small>{group.items.length}</small>
            </button>
            <SidebarGroupMenu
              group={sourceGroup}
              builtIn={Boolean(group.builtIn)}
              disabled={mutationBlocked}
              deleteOpen={deleteOpen}
              deleting={deleting}
              deleteTriggerBlocked={mutationBlocked}
              deleteConfirmBlocked={reordering || mutationPending}
              onCreateBookmark={(trigger) => openBookmarkEditor(undefined, group.id, trigger)}
              onEdit={(trigger) => {
                if (sourceGroup) {
                  openGroupEditor(sourceGroup, trigger)
                }
              }}
              onOpenDelete={(trigger) => {
                if (sourceGroup) {
                  openDelete({
                    kind: 'group',
                    id: sourceGroup.id,
                    label: sourceGroup.name,
                  }, trigger)
                }
              }}
              onCancelDelete={cancelDelete}
              onConfirmDelete={confirmDelete}
            />
          </div>
          {!collapsed ? (
            <div
              className="files-bookmarks-sidebar-group-body"
              onDragOver={(event) => {
                if (
                  mutationBlocked
                  || reorderingRef.current
                  || searchActive
                  || !draggingBookmarkId
                  || event.target instanceof Element
                    && event.target.closest('[data-bookmark-id]')
                ) {
                  return
                }
                event.preventDefault()
                setBookmarkDropTarget({
                  groupId: group.id,
                  bookmarkId: null,
                  placement: 'after',
                })
              }}
              onDrop={(event) => {
                if (!draggingBookmarkId || mutationBlocked || reorderingRef.current) {
                  return
                }
                event.preventDefault()
                void reorderBookmarks(group.id, null, 'after')
              }}
            >
              {group.items.length === 0 ? (
                <div className="files-bookmarks-sidebar-group-empty">
                  {t('files.emptyBookmarkGroup')}
                </div>
              ) : (
                group.items.map((bookmark) => (
                  renderBookmarkRow(bookmark, group.name, group.id)
                ))
              )}
            </div>
          ) : null}
        </section>
      )
    }

    const mainContent = view.kind === 'list' ? (
      <>
        <header className="files-bookmarks-sidebar-heading">
          <span className="files-bookmarks-sidebar-title">
            <Bookmark size={15} aria-hidden="true" />
            <strong>{t('files.manageBookmarks')}</strong>
            <small>{bookmarks.length}</small>
            {reordering ? (
              <LoaderCircle className={`${uiStyles['is-spinning']} is-spinning`} size={13} aria-hidden="true" />
            ) : null}
          </span>
          <span className="files-bookmarks-sidebar-heading-actions">
            <Dropdown
              menu={createMenu}
              trigger={['click']}
              popupRender={renderBookmarkFloatingLayer}
              classNames={{
                root: `${contextActionMenuPopupClassName} files-bookmarks-sidebar-menu ${styles['menu-portal']}`,
              }}
            >
              <Tooltip title={t('app.create')} placement="bottom">
                <Button
                  ref={createButtonRef}
                  data-bookmark-focus-key="create"
                  type="text"
                  className="files-bookmarks-sidebar-action"
                  aria-label={t('app.create')}
                  disabled={mutationBlocked}
                  icon={<Plus size={15} aria-hidden="true" />}
                />
              </Tooltip>
            </Dropdown>
            <Tooltip title={t('app.close')} placement="bottom">
              <Button
                type="text"
                className="files-bookmarks-sidebar-action"
                aria-label={t('app.close')}
                icon={<X size={15} aria-hidden="true" />}
                onClick={() => onRequestClose('dismiss')}
              />
            </Tooltip>
          </span>
        </header>

        <div className="files-bookmarks-sidebar-search">
          <Input
            key={open ? 'open' : 'closed'}
            ref={searchInputRef}
            id={`${panelId}-search`}
            name="file-bookmark-search"
            autoFocus={open}
            allowClear
            prefix={<Search size={14} aria-hidden="true" />}
            value={query}
            disabled={mutationBlocked}
            aria-label={t('files.bookmarkSearchPlaceholder')}
            placeholder={t('files.bookmarkSearchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div
          ref={listRef}
          className="files-bookmarks-sidebar-list"
          tabIndex={-1}
        >
          {searchActive ? (
            <>
              <div className="files-bookmarks-sidebar-search-summary">
                <span>{t('files.bookmarkSearchResults')}</span>
                <small>{searchRows.length}</small>
              </div>
              {searchRows.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('files.noBookmarkResults')}
                />
              ) : (
                searchRows.map(({ bookmark, groupId, groupName }) => (
                  renderBookmarkRow(bookmark, groupName, groupId)
                ))
              )}
            </>
          ) : bookmarks.length === 0 && groups.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('files.noBookmarks')}
            >
              <Button
                type="primary"
                size="small"
                icon={<BookmarkPlus size={14} aria-hidden="true" />}
                disabled={mutationBlocked}
                data-bookmark-focus-key="create-empty"
                onClick={(event) => openBookmarkEditor(undefined, '', event.currentTarget)}
              >
                {t('files.addBookmark')}
              </Button>
            </Empty>
          ) : (
            groupViews.map(renderGroup)
          )}
        </div>

        <footer className="files-bookmarks-sidebar-footer">
          <span>{t('files.bookmarkCount', { count: bookmarks.length })}</span>
          {currentBookmark ? (
            <span className="is-current">
              <Check size={12} aria-hidden="true" />
              {t('files.bookmarkCurrent')}
            </span>
          ) : null}
        </footer>
      </>
    ) : (
      <SidebarEditor
        view={view}
        groups={groups}
        saving={saving}
        blocked={mutationPending}
        onChange={setView}
        onCancel={closeEditor}
        onClose={() => onRequestClose('dismiss')}
        onSave={() => void saveEditor()}
      />
    )

    return (
      <div className={styles.root}>
        <div className="files-bookmarks-sidebar-content">
          {mainContent}
        </div>
      </div>
    )
}

interface SidebarBookmarkRowProps {
  bookmark: FileBookmark
  groupName: string
  showGroupName: boolean
  connected: boolean
  current: boolean
  navigating: boolean
  reordering: boolean
  deleteOpen: boolean
  deleting: boolean
  deleteTriggerBlocked: boolean
  deleteConfirmBlocked: boolean
  sortingDisabled: boolean
  dragging: boolean
  dropPlacement: Exclude<BookmarkDropPlacement, 'auto'> | null
  onNavigate: () => void
  onEdit: (trigger: HTMLElement) => void
  onOpenDelete: (trigger: HTMLElement) => void
  onCancelDelete: () => void
  onConfirmDelete: () => Promise<void>
  onMoveByStep: (direction: -1 | 1) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}

function SidebarBookmarkRow({
  bookmark,
  groupName,
  showGroupName,
  connected,
  current,
  navigating,
  reordering,
  deleteOpen,
  deleting,
  deleteTriggerBlocked,
  deleteConfirmBlocked,
  sortingDisabled,
  dragging,
  dropPlacement,
  onNavigate,
  onEdit,
  onOpenDelete,
  onCancelDelete,
  onConfirmDelete,
  onMoveByStep,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: SidebarBookmarkRowProps) {
  const { t } = useTranslation()
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const reorderLabel = t('files.bookmarkReorderItemLabel', { name: bookmark.name })

  return (
    <article
      data-bookmark-id={bookmark.id}
      className={[
        'files-bookmarks-sidebar-row',
        current ? 'is-current' : '',
        navigating ? 'is-loading' : '',
        sortingDisabled ? 'is-sorting-disabled' : '',
        dragging ? 'is-dragging' : '',
        dropPlacement ? `is-drop-${dropPlacement}` : '',
      ].filter(Boolean).join(' ')}
      aria-busy={navigating || undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Tooltip
        title={sortingDisabled ? t('files.bookmarkSortDisabledSearch') : reorderLabel}
        placement="left"
      >
        <button
          type="button"
          className="files-bookmarks-sidebar-grip"
          draggable={!sortingDisabled && !navigating && !reordering}
          disabled={sortingDisabled || navigating || reordering}
          aria-label={reorderLabel}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={(event) => {
            if (sortingDisabled || navigating || reordering) {
              return
            }
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            onMoveByStep(event.key === 'ArrowUp' ? -1 : 1)
          }}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip
        title={connected ? (
          <span className={tooltipStyles.copy}>
            <strong>{bookmark.name}</strong>
            <span>{bookmark.path}</span>
            {showGroupName ? <small>{groupName}</small> : null}
          </span>
        ) : t('files.bookmarkNoSession')}
        placement="right"
        mouseEnterDelay={0.45}
      >
        <button
          type="button"
          className="files-bookmarks-sidebar-row-main"
          aria-current={current ? 'location' : undefined}
          aria-busy={navigating || undefined}
          disabled={navigating || reordering || !connected}
          onClick={onNavigate}
        >
          <span className="files-bookmarks-sidebar-row-icon" aria-hidden="true">
            {navigating ? (
              <LoaderCircle className={`${uiStyles['is-spinning']} is-spinning`} size={15} />
            ) : (
              <Bookmark size={15} />
            )}
          </span>
          <span className="files-bookmarks-sidebar-row-copy">
            <span className="files-bookmarks-sidebar-row-title">
              <strong>{bookmark.name}</strong>
              {current ? <small>{t('files.bookmarkCurrent')}</small> : null}
            </span>
            <span className="files-bookmarks-sidebar-row-path">{bookmark.path}</span>
            {showGroupName ? (
              <span className="files-bookmarks-sidebar-row-group">{groupName}</span>
            ) : null}
          </span>
        </button>
      </Tooltip>
      <span className="files-bookmarks-sidebar-row-actions">
        <Tooltip title={t('files.editBookmark')} placement="top">
          <Button
            ref={editButtonRef}
            data-bookmark-focus-key={`bookmark-edit:${bookmark.id}`}
            type="text"
            className="files-bookmarks-sidebar-row-action"
            aria-label={t('files.editBookmark')}
            disabled={navigating || reordering}
            icon={<Pencil size={14} aria-hidden="true" />}
            onClick={() => {
              if (editButtonRef.current) {
                onEdit(editButtonRef.current)
              }
            }}
          />
        </Tooltip>
        <SidebarDeletePopconfirm
          target={{ kind: 'bookmark', id: bookmark.id, label: bookmark.path }}
          open={deleteOpen}
          deleting={deleting}
          triggerBlocked={deleteTriggerBlocked}
          confirmBlocked={deleteConfirmBlocked}
          focusKey={`bookmark-delete:${bookmark.id}`}
          onOpen={onOpenDelete}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      </span>
    </article>
  )
}

interface SidebarGroupMenuProps {
  group?: FileBookmarkGroup
  builtIn: boolean
  disabled: boolean
  deleteOpen: boolean
  deleting: boolean
  deleteTriggerBlocked: boolean
  deleteConfirmBlocked: boolean
  onCreateBookmark: (trigger: HTMLElement) => void
  onEdit: (trigger: HTMLElement) => void
  onOpenDelete: (trigger: HTMLElement) => void
  onCancelDelete: () => void
  onConfirmDelete: () => Promise<void>
}

function SidebarGroupMenu({
  group,
  builtIn,
  disabled,
  deleteOpen,
  deleting,
  deleteTriggerBlocked,
  deleteConfirmBlocked,
  onCreateBookmark,
  onEdit,
  onOpenDelete,
  onCancelDelete,
  onConfirmDelete,
}: SidebarGroupMenuProps) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menu = useMemo<MenuProps>(() => ({
    items: [
      {
        key: 'create',
        icon: <BookmarkPlus size={14} aria-hidden="true" />,
        label: t('files.addBookmark'),
      },
      ...(!builtIn && group ? [
        {
          key: 'edit',
          icon: <Pencil size={14} aria-hidden="true" />,
          label: t('files.editBookmarkGroup'),
        },
      ] : []),
    ],
    onClick: ({ key }) => {
      const trigger = buttonRef.current
      if (!trigger) {
        return
      }
      if (key === 'edit') {
        onEdit(trigger)
      } else {
        onCreateBookmark(trigger)
      }
    },
  }), [builtIn, group, onCreateBookmark, onEdit, t])

  return (
    <span className="files-bookmarks-sidebar-group-actions">
      <Dropdown
        menu={menu}
        trigger={['click']}
        popupRender={renderBookmarkFloatingLayer}
        classNames={{
          root: `${contextActionMenuPopupClassName} files-bookmarks-sidebar-menu ${styles['menu-portal']}`,
        }}
        disabled={disabled}
      >
        <Tooltip title={t('files.actions')} placement="top">
          <Button
            ref={buttonRef}
            data-bookmark-focus-key={`group-action:${group?.id ?? 'ungrouped'}`}
            type="text"
            className="files-bookmarks-sidebar-row-action"
            aria-label={t('files.actions')}
            disabled={disabled}
            icon={<MoreHorizontal size={15} aria-hidden="true" />}
          />
        </Tooltip>
      </Dropdown>
      {!builtIn && group ? (
        <SidebarDeletePopconfirm
          target={{ kind: 'group', id: group.id, label: group.name }}
          open={deleteOpen}
          deleting={deleting}
          triggerBlocked={deleteTriggerBlocked}
          confirmBlocked={deleteConfirmBlocked}
          focusKey={`group-delete:${group.id}`}
          onOpen={onOpenDelete}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </span>
  )
}

interface SidebarDeletePopconfirmProps {
  target: DeleteTarget
  open: boolean
  deleting: boolean
  triggerBlocked: boolean
  confirmBlocked: boolean
  focusKey: string
  onOpen: (trigger: HTMLElement) => void
  onCancel: () => void
  onConfirm: () => Promise<void>
}

function SidebarDeletePopconfirm({
  target,
  open,
  deleting,
  triggerBlocked,
  confirmBlocked,
  focusKey,
  onOpen,
  onCancel,
  onConfirm,
}: SidebarDeletePopconfirmProps) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <Popconfirm
      open={open}
      title={t(target.kind === 'group'
        ? 'files.deleteBookmarkGroupTitle'
        : 'files.deleteBookmarkTitle')}
      description={target.kind === 'group'
        ? t('files.deleteBookmarkGroupHint')
        : target.label}
      placement="topRight"
      okText={t('app.delete')}
      cancelText={t('app.cancel')}
      okButtonProps={{ danger: true, disabled: confirmBlocked, loading: deleting }}
      cancelButtonProps={{ disabled: deleting }}
      rootClassName={`files-bookmarks-delete-popconfirm ${styles['popconfirm-root']}`}
      classNames={{
        container: `files-bookmarks-delete-popconfirm-surface ${styles['popconfirm-surface']}`,
      }}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          if (buttonRef.current) {
            onOpen(buttonRef.current)
          }
        } else if (!deleting) {
          onCancel()
        }
      }}
      onConfirm={onConfirm}
    >
      <Button
        ref={buttonRef}
        data-bookmark-focus-key={focusKey}
        type="text"
        danger
        className="files-bookmarks-sidebar-row-action files-bookmarks-sidebar-delete-action"
        aria-label={t('app.delete')}
        disabled={(triggerBlocked && !open) || deleting}
        icon={<Trash2 size={14} aria-hidden="true" />}
      />
    </Popconfirm>
  )
}

interface SidebarEditorProps {
  view: Exclude<SidebarView, { kind: 'list' }>
  groups: FileBookmarkGroup[]
  saving: boolean
  blocked: boolean
  onChange: (view: SidebarView) => void
  onCancel: () => void
  onClose: () => void
  onSave: () => void
}

function SidebarEditor({
  view,
  groups,
  saving,
  blocked,
  onChange,
  onCancel,
  onClose,
  onSave,
}: SidebarEditorProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const pathId = useId()
  const groupId = useId()
  const editing = Boolean(view.draft.id)
  const bookmarkEditor = view.kind === 'bookmark-editor'
  const groupOptions = useMemo(
    () => [
      { value: '', label: t('files.bookmarksUngrouped') },
      ...[...groups]
        .sort(sortBookmarkGroups)
        .map((group) => ({ value: group.id, label: group.name })),
    ],
    [groups, t],
  )
  const title = bookmarkEditor
    ? t(editing ? 'files.editBookmark' : 'files.addBookmark')
    : t(editing ? 'files.editBookmarkGroup' : 'files.newBookmarkGroup')

  return (
    <div className="files-bookmarks-sidebar-editor">
      <header className="files-bookmarks-sidebar-editor-heading">
        <Tooltip title={t('app.cancel')} placement="bottom">
          <Button
            type="text"
            className="files-bookmarks-sidebar-action"
            aria-label={t('app.cancel')}
            icon={<ArrowLeft size={15} aria-hidden="true" />}
            disabled={saving || blocked}
            onClick={onCancel}
          />
        </Tooltip>
        <span>
          {bookmarkEditor ? (
            <Bookmark size={15} aria-hidden="true" />
          ) : (
            <Folder size={15} aria-hidden="true" />
          )}
          <strong>{title}</strong>
        </span>
        <Tooltip title={t('app.close')} placement="bottom">
          <Button
            type="text"
            className="files-bookmarks-sidebar-action"
            aria-label={t('app.close')}
            icon={<X size={15} aria-hidden="true" />}
            disabled={saving || blocked}
            onClick={onClose}
          />
        </Tooltip>
      </header>

      <div className="files-bookmarks-sidebar-editor-body">
        <div className="files-bookmarks-sidebar-editor-intro">
          <strong>{title}</strong>
          <span>
            {t(bookmarkEditor
              ? 'files.bookmarkInlineHint'
              : 'files.bookmarkGroupInlineHint')}
          </span>
        </div>
        <label htmlFor={nameId}>
          <span>
            {t(bookmarkEditor ? 'files.bookmarkName' : 'files.bookmarkGroupName')}
          </span>
          <Input
            id={nameId}
            autoFocus
            value={view.draft.name}
            placeholder={t(bookmarkEditor
              ? 'files.bookmarkNamePlaceholder'
              : 'files.bookmarkGroupNamePlaceholder')}
            disabled={saving || blocked}
            onChange={(event) => {
              if (view.kind === 'bookmark-editor') {
                onChange({
                  ...view,
                  draft: { ...view.draft, name: event.target.value },
                })
              } else {
                onChange({
                  ...view,
                  draft: { ...view.draft, name: event.target.value },
                })
              }
            }}
            onPressEnter={onSave}
          />
        </label>

        {view.kind === 'bookmark-editor' ? (
          <>
            <label htmlFor={pathId}>
              <span>{t('files.bookmarkPath')}</span>
              <Input
                id={pathId}
                value={view.draft.path}
                placeholder="/root"
                disabled={saving || blocked}
                onChange={(event) => onChange({
                  ...view,
                  draft: { ...view.draft, path: event.target.value },
                })}
              />
            </label>
            <label htmlFor={groupId}>
              <span>{t('files.bookmarkGroup')}</span>
              <Select
                id={groupId}
                value={view.draft.group_id}
                className="termous-select"
                popupRender={renderBookmarkFloatingLayer}
                classNames={{ popup: { root: 'files-bookmarks-sidebar-select-popup' } }}
                options={groupOptions}
                disabled={saving || blocked}
                onChange={(nextGroupId) => onChange({
                  ...view,
                  draft: { ...view.draft, group_id: nextGroupId },
                })}
              />
            </label>
          </>
        ) : null}
      </div>

      <footer className="files-bookmarks-sidebar-editor-footer">
        <Button disabled={saving || blocked} onClick={onCancel}>
          {t('app.cancel')}
        </Button>
        <Button
          type="primary"
          icon={<Check size={14} aria-hidden="true" />}
          loading={saving}
          disabled={blocked}
          onClick={onSave}
        >
          {t(editing ? 'app.save' : 'app.create')}
        </Button>
      </footer>
    </div>
  )
}
