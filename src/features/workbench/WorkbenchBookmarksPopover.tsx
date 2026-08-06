import { Button, Input, Popover, Tooltip, type InputRef } from 'antd'
import {
  Bookmark,
  BookmarkCheck,
  CircleAlert,
  LoaderCircle,
  PanelRightOpen,
  Search,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeRemotePosixPath } from '#shared/path'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkInput,
} from '#entities/file'
import {
  buildBookmarkGroups,
  filterBookmarkGroups,
  findBookmarkForPath,
} from '#entities/file'
import { WorkbenchBookmarkEditorModal } from './WorkbenchBookmarkEditorModal'
import './workbench-bookmarks-popover.css'

export interface WorkbenchBookmarksPopoverProps {
  bookmarks: FileBookmark[]
  groups: FileBookmarkGroup[]
  currentPath: string
  connected: boolean
  disabled?: boolean
  navigationBusy?: boolean
  navigationKey?: string | number
  onNavigate: (path: string) => Promise<boolean> | boolean
  onCreateBookmark: (
    input: FileBookmarkInput,
  ) => Promise<FileBookmark> | FileBookmark
  onUpdateBookmark: (
    id: string,
    input: FileBookmarkInput,
  ) => Promise<FileBookmark> | FileBookmark
  onManageBookmarks: () => Promise<void> | void
}

export function WorkbenchBookmarksPopover({
  bookmarks,
  groups,
  currentPath,
  connected,
  disabled = false,
  navigationBusy = false,
  navigationKey,
  onNavigate,
  onCreateBookmark,
  onUpdateBookmark,
  onManageBookmarks,
}: WorkbenchBookmarksPopoverProps) {
  const { t } = useTranslation()
  const panelId = useId()
  const searchInputRef = useRef<InputRef>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const currentActionRef = useRef<HTMLButtonElement>(null)
  const actionSequenceRef = useRef(0)
  const actionPendingRef = useRef(false)
  const editorOpenRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [navigatingBookmarkId, setNavigatingBookmarkId] = useState('')
  const [savingCurrent, setSavingCurrent] = useState(false)
  const [error, setError] = useState('')
  const [editorError, setEditorError] = useState('')

  const normalizedCurrentPath = useMemo(
    () => normalizeRemotePosixPath(currentPath),
    [currentPath],
  )
  const currentBookmark = useMemo(
    () => normalizedCurrentPath
      ? findBookmarkForPath(bookmarks, normalizedCurrentPath)
      : null,
    [bookmarks, normalizedCurrentPath],
  )
  const bookmarkGroups = useMemo(
    () => filterBookmarkGroups(
      buildBookmarkGroups(groups, bookmarks, t('files.bookmarksUngrouped')),
      query,
    ).filter((group) => group.items.length > 0),
    [bookmarks, groups, query, t],
  )
  const visibleBookmarks = useMemo(
    () => bookmarkGroups.flatMap((group) => group.items),
    [bookmarkGroups],
  )
  const defaultTabStopId = visibleBookmarks.some(
    (bookmark) => bookmark.id === currentBookmark?.id,
  )
    ? currentBookmark?.id
    : visibleBookmarks[0]?.id
  const actionPending = Boolean(navigatingBookmarkId) || savingCurrent
  const navigationDisabled = disabled || navigationBusy || !connected || actionPending
  const bookmarkMutationDisabled = (
    disabled
    || navigationBusy
    || actionPending
    || (!currentBookmark && !connected)
  )

  const closePopover = useCallback((restoreFocus = false) => {
    editorOpenRef.current = false
    setOpen(false)
    setEditorOpen(false)
    setQuery('')
    setError('')
    setEditorError('')
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [])

  const closeEditor = useCallback((restoreFocus = true) => {
    editorOpenRef.current = false
    setEditorOpen(false)
    setEditorError('')
    if (restoreFocus) {
      window.requestAnimationFrame(() => currentActionRef.current?.focus())
    }
  }, [])

  useEffect(() => {
    actionSequenceRef.current += 1
    actionPendingRef.current = false
    editorOpenRef.current = false
    setOpen(false)
    setEditorOpen(false)
    setQuery('')
    setNavigatingBookmarkId('')
    setSavingCurrent(false)
    setError('')
    setEditorError('')
  }, [navigationKey])

  useEffect(() => {
    if (connected && !disabled) {
      return
    }
    actionSequenceRef.current += 1
    actionPendingRef.current = false
    editorOpenRef.current = false
    setNavigatingBookmarkId('')
    setSavingCurrent(false)
    setError('')
    setEditorOpen(false)
    setEditorError('')
    if (disabled) {
      setOpen(false)
      setQuery('')
    }
  }, [connected, disabled])

  useEffect(() => () => {
    actionSequenceRef.current += 1
    actionPendingRef.current = false
  }, [])

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus({ cursor: 'end' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const navigateToBookmark = useCallback(async (bookmark: FileBookmark) => {
    if (navigationDisabled || actionPendingRef.current) {
      return
    }
    actionPendingRef.current = true
    const requestSequence = actionSequenceRef.current + 1
    actionSequenceRef.current = requestSequence
    setError('')
    setNavigatingBookmarkId(bookmark.id)
    try {
      const accepted = await onNavigate(bookmark.path)
      if (actionSequenceRef.current !== requestSequence) {
        return
      }
      if (accepted === false) {
        setError(t('files.bookmarkNavigationFailed'))
        return
      }
      closePopover(true)
    } catch (navigationError) {
      if (actionSequenceRef.current !== requestSequence) {
        return
      }
      setError(
        navigationError instanceof Error && navigationError.message.trim()
          ? navigationError.message
          : t('files.bookmarkNavigationFailed'),
      )
    } finally {
      if (actionSequenceRef.current === requestSequence) {
        actionPendingRef.current = false
        setNavigatingBookmarkId('')
      }
    }
  }, [closePopover, navigationDisabled, onNavigate, t])

  const saveCurrentPath = useCallback(async (input: FileBookmarkInput) => {
    if (
      bookmarkMutationDisabled
      || actionPendingRef.current
      || !normalizedCurrentPath
    ) {
      return
    }
    actionPendingRef.current = true
    const requestSequence = actionSequenceRef.current + 1
    actionSequenceRef.current = requestSequence
    setEditorError('')
    setSavingCurrent(true)
    try {
      const nextInput = {
        ...input,
        name: input.name.trim(),
        path: normalizedCurrentPath,
      }
      if (currentBookmark) {
        await onUpdateBookmark(currentBookmark.id, nextInput)
      } else {
        await onCreateBookmark(nextInput)
      }
      if (actionSequenceRef.current !== requestSequence) {
        return
      }
      closeEditor(false)
      window.requestAnimationFrame(() => searchInputRef.current?.focus())
    } catch (saveError) {
      if (actionSequenceRef.current !== requestSequence) {
        return
      }
      setEditorError(
        saveError instanceof Error && saveError.message.trim()
          ? saveError.message
          : t('files.bookmarkActionFailed'),
      )
    } finally {
      if (actionSequenceRef.current === requestSequence) {
        actionPendingRef.current = false
        setSavingCurrent(false)
      }
    }
  }, [
    closeEditor,
    bookmarkMutationDisabled,
    currentBookmark,
    normalizedCurrentPath,
    onCreateBookmark,
    onUpdateBookmark,
    t,
  ])

  const focusBookmark = useCallback((target: 'first' | 'last' | 'next' | 'previous') => {
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-workbench-bookmark-item]:not(:disabled)',
      ) ?? [],
    )
    if (buttons.length === 0) {
      return
    }
    const activeIndex = buttons.findIndex((button) => button === document.activeElement)
    let nextIndex = 0
    if (target === 'last') {
      nextIndex = buttons.length - 1
    } else if (target === 'next') {
      nextIndex = activeIndex < 0 || activeIndex === buttons.length - 1
        ? 0
        : activeIndex + 1
    } else if (target === 'previous') {
      nextIndex = activeIndex <= 0 ? buttons.length - 1 : activeIndex - 1
    }
    buttons[nextIndex]?.focus()
    buttons[nextIndex]?.scrollIntoView({ block: 'nearest' })
  }, [])

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePopover(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusBookmark(event.key === 'ArrowDown' ? 'first' : 'last')
    }
  }

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePopover(true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }
    event.preventDefault()
    if (event.key === 'Home') {
      focusBookmark('first')
    } else if (event.key === 'End') {
      focusBookmark('last')
    } else {
      focusBookmark(event.key === 'ArrowDown' ? 'next' : 'previous')
    }
  }

  const content = (
    <section
      id={panelId}
      className="workbench-bookmarks-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t('files.bookmarkPanelLabel')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closePopover(true)
        }
      }}
    >
      <header className="workbench-bookmarks-header">
        <span className="workbench-bookmarks-heading">
          <Bookmark size={15} aria-hidden="true" />
          <span>
            <strong>{t('files.bookmarks')}</strong>
            <small>{t('files.bookmarkCount', { count: bookmarks.length })}</small>
          </span>
        </span>
        <Tooltip
          title={currentBookmark
            ? t('files.editBookmark')
            : t('files.bookmarkCurrentAdd')}
          placement="top"
          mouseEnterDelay={0.45}
          zIndex={3500}
          classNames={{ root: 'termous-tooltip workbench-bookmarks-tooltip' }}
        >
          <span className="workbench-bookmarks-current-target">
            <button
              ref={currentActionRef}
              type="button"
              className={`workbench-bookmarks-current ${currentBookmark ? 'is-saved' : ''}`}
              aria-label={currentBookmark
                ? t('files.editBookmark')
                : t('files.bookmarkCurrentAdd')}
              disabled={
                bookmarkMutationDisabled
                || !normalizedCurrentPath
              }
              onClick={() => {
                setEditorError('')
                editorOpenRef.current = true
                setEditorOpen(true)
              }}
            >
              {savingCurrent ? (
                <LoaderCircle
                  className="workbench-bookmarks-spinner"
                  size={13}
                  aria-hidden="true"
                />
              ) : currentBookmark ? (
                <BookmarkCheck size={13} aria-hidden="true" />
              ) : (
                <Bookmark size={13} aria-hidden="true" />
              )}
              <span>
                {currentBookmark
                  ? t('files.bookmarkCurrentSavedShort')
                  : t('files.bookmarkCurrentAddShort')}
              </span>
            </button>
          </span>
        </Tooltip>
      </header>

      <div className="workbench-bookmarks-search-shell">
        <Input
          id={`${panelId}-search`}
          ref={searchInputRef}
          className="workbench-bookmarks-search"
          value={query}
          allowClear
          variant="borderless"
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={t('files.bookmarkSearchPlaceholder')}
          aria-label={t('files.bookmarkSearchPlaceholder')}
          onChange={(event) => {
            setQuery(event.target.value)
            setError('')
          }}
          onKeyDown={handleSearchKeyDown}
        />
      </div>

      {!connected ? (
        <div className="workbench-bookmarks-notice is-offline" role="status">
          <CircleAlert size={14} aria-hidden="true" />
          <span>{t('files.bookmarkNoSession')}</span>
        </div>
      ) : error ? (
        <div className="workbench-bookmarks-notice is-error" role="alert">
          <CircleAlert size={14} aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div
        ref={listRef}
        className="workbench-bookmarks-list"
        role="listbox"
        aria-label={t('files.bookmarkPanelLabel')}
        aria-busy={actionPending || undefined}
        onKeyDown={handleListKeyDown}
      >
        {bookmarkGroups.length === 0 ? (
          <div className="workbench-bookmarks-empty">
            <Bookmark size={18} aria-hidden="true" />
            <strong>
              {bookmarks.length === 0
                ? t('files.noBookmarks')
                : t('files.noBookmarkResults')}
            </strong>
            {bookmarks.length === 0 ? <span>{t('files.noBookmarksHint')}</span> : null}
          </div>
        ) : (
          bookmarkGroups.map((group) => (
            <section
              key={group.id || '__ungrouped__'}
              className="workbench-bookmarks-group"
              role="group"
              aria-label={group.name}
            >
              <div className="workbench-bookmarks-group-heading">
                <Tooltip
                  title={group.name}
                  placement="left"
                  mouseEnterDelay={0.45}
                  zIndex={3500}
                  classNames={{ root: 'termous-tooltip workbench-bookmarks-tooltip' }}
                >
                  <span>{group.name}</span>
                </Tooltip>
                <small>{group.items.length}</small>
              </div>
              <div className="workbench-bookmarks-group-items">
                {group.items.map((bookmark) => {
                  const current = bookmark.id === currentBookmark?.id
                  const navigating = bookmark.id === navigatingBookmarkId
                  return (
                    <Tooltip
                      key={bookmark.id}
                      title={(
                        <span className="workbench-bookmark-tooltip-copy">
                          <strong>{bookmark.name}</strong>
                          <span>{bookmark.path}</span>
                          <small>{group.name}</small>
                        </span>
                      )}
                      placement="left"
                      mouseEnterDelay={0.45}
                      zIndex={3500}
                      classNames={{ root: 'termous-tooltip workbench-bookmarks-tooltip' }}
                    >
                      <button
                        type="button"
                        className={[
                          'workbench-bookmarks-item',
                          current ? 'is-current' : '',
                          navigating ? 'is-loading' : '',
                        ].filter(Boolean).join(' ')}
                        role="option"
                        aria-selected={current}
                        aria-current={current ? 'location' : undefined}
                        aria-busy={navigating || undefined}
                        aria-disabled={navigationDisabled}
                        tabIndex={bookmark.id === defaultTabStopId ? 0 : -1}
                        data-workbench-bookmark-item
                        onClick={() => void navigateToBookmark(bookmark)}
                      >
                        <span className="workbench-bookmarks-item-icon" aria-hidden="true">
                          {navigating ? (
                            <LoaderCircle
                              className="workbench-bookmarks-spinner"
                              size={14}
                            />
                          ) : current ? (
                            <BookmarkCheck size={14} />
                          ) : (
                            <Bookmark size={14} />
                          )}
                        </span>
                        <span className="workbench-bookmarks-item-copy">
                          <strong>{bookmark.name}</strong>
                          <small>{bookmark.path}</small>
                        </span>
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>

      <footer className="workbench-bookmarks-footer">
        <button
          type="button"
          className="workbench-bookmarks-manage"
          disabled={actionPending}
          onClick={() => {
            closePopover()
            void onManageBookmarks()
          }}
        >
          <PanelRightOpen size={14} aria-hidden="true" />
          <span>{t('files.manageBookmarks')}</span>
        </button>
      </footer>
    </section>
  )

  return (
    <>
      <Popover
        open={open}
        trigger="click"
        placement="bottomRight"
        arrow={false}
        autoAdjustOverflow
        zIndex={3400}
        classNames={{ root: 'workbench-bookmarks-popover' }}
        getPopupContainer={() => document.body}
        content={content}
        onOpenChange={(nextOpen) => {
          if (disabled && nextOpen) {
            return
          }
          if (nextOpen) {
            setError('')
            setOpen(true)
            return
          }
          if (editorOpenRef.current) {
            return
          }
          closePopover()
        }}
      >
        <Tooltip
          title={t('files.bookmarks')}
          placement="bottom"
          mouseEnterDelay={0.45}
          open={open ? false : undefined}
          zIndex={3500}
          classNames={{ root: 'termous-tooltip workbench-bookmarks-tooltip' }}
        >
          <Button
            ref={triggerRef}
            type="text"
            className={[
              'workbench-files-address-action',
              'workbench-bookmarks-trigger',
              open ? 'is-open' : '',
              currentBookmark ? 'is-saved' : '',
            ].filter(Boolean).join(' ')}
            aria-label={t('files.bookmarks')}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-haspopup="dialog"
            disabled={disabled}
            icon={currentBookmark
              ? <BookmarkCheck size={15} aria-hidden="true" />
              : <Bookmark size={15} aria-hidden="true" />}
          />
        </Tooltip>
      </Popover>

      <WorkbenchBookmarkEditorModal
        open={editorOpen}
        currentPath={normalizedCurrentPath ?? ''}
        bookmark={currentBookmark}
        groups={groups}
        saving={savingCurrent}
        error={editorError}
        onCancel={() => closeEditor()}
        onSubmit={saveCurrentPath}
      />
    </>
  )
}
