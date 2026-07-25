import { App as AntdApp, Tooltip } from 'antd'
import {
  BookmarkCheck,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  forwardRef,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkInput,
} from '../../types/domain'
import { normalizeRemotePosixPath } from '../../shared/remotePosixPath'
import {
  buildBookmarkGroups,
  findBookmarkForPath,
  suggestBookmarkName,
} from './fileBookmarksModel'
import './file-bookmarks-rail.css'

export interface FileBookmarksRailProps {
  bookmarks: FileBookmark[]
  groups: FileBookmarkGroup[]
  currentPath: string
  connected: boolean
  expanded: boolean
  mutationPending: boolean
  navigationKey?: string
  panelId?: string
  onNavigate: (path: string) => Promise<boolean> | boolean
  onCreateBookmark: (input: FileBookmarkInput) => Promise<FileBookmark>
  onExpandedChange: (expanded: boolean) => void
}

interface RailScrollState {
  canScrollLeft: boolean
  canScrollRight: boolean
}

const initialScrollState: RailScrollState = {
  canScrollLeft: false,
  canScrollRight: false,
}

export const FileBookmarksRail = forwardRef<HTMLButtonElement, FileBookmarksRailProps>(function FileBookmarksRail({
  bookmarks,
  groups,
  currentPath,
  connected,
  expanded,
  mutationPending,
  navigationKey,
  panelId = 'files-bookmarks-workbench',
  onNavigate,
  onCreateBookmark,
  onExpandedChange,
}, allBookmarksButtonRef) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const navigationRequestRef = useRef(0)
  const [scrollState, setScrollState] = useState(initialScrollState)
  const [navigatingBookmarkId, setNavigatingBookmarkId] = useState('')
  const [savingCurrent, setSavingCurrent] = useState(false)
  const normalizedCurrentPath = normalizeRemotePosixPath(currentPath) ?? '/'
  const currentBookmark = useMemo(
    () => findBookmarkForPath(bookmarks, normalizedCurrentPath),
    [bookmarks, normalizedCurrentPath],
  )
  const railGroups = useMemo(
    () => buildBookmarkGroups(groups, bookmarks, t('files.bookmarksUngrouped'))
      .filter((group) => group.items.length > 0),
    [bookmarks, groups, t],
  )
  const railOrderKey = useMemo(
    () => railGroups
      .map((group) => `${group.id}:${group.items.map((bookmark) => bookmark.id).join(',')}`)
      .join('|'),
    [railGroups],
  )

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      setScrollState(initialScrollState)
      return
    }
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    setScrollState({
      canScrollLeft: viewport.scrollLeft > 1,
      canScrollRight: viewport.scrollLeft < maxScrollLeft - 1,
    })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) {
      return undefined
    }

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateScrollState)
    observer?.observe(viewport)
    observer?.observe(track)
    viewport.addEventListener('scroll', updateScrollState, { passive: true })
    const frame = window.requestAnimationFrame(updateScrollState)
    return () => {
      window.cancelAnimationFrame(frame)
      viewport.removeEventListener('scroll', updateScrollState)
      observer?.disconnect()
    }
  }, [bookmarks.length, railGroups.length, updateScrollState])

  useEffect(() => {
    navigationRequestRef.current += 1
    setNavigatingBookmarkId('')
  }, [navigationKey])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !currentBookmark) {
      return
    }
    const currentButton = Array.from(
      viewport.querySelectorAll<HTMLButtonElement>('[data-bookmark-id]'),
    ).find((button) => button.dataset.bookmarkId === currentBookmark.id)
    currentButton?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }, [currentBookmark, railOrderKey])

  const notifyError = useCallback((error: unknown) => {
    notification.error({
      message: t('files.bookmarkActionFailed'),
      description: error instanceof Error ? error.message : t('app.error'),
      placement: 'topRight',
      duration: 3.2,
    })
  }, [notification, t])

  const scrollRail = (direction: -1 | 1) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    viewport.scrollBy({
      left: direction * Math.max(180, Math.round(viewport.clientWidth * 0.72)),
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  const navigateToBookmark = async (bookmark: FileBookmark) => {
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
      await onNavigate(bookmark.path)
    } catch (error) {
      if (navigationRequestRef.current === requestSequence) {
        notifyError(error)
      }
    } finally {
      if (navigationRequestRef.current === requestSequence) {
        setNavigatingBookmarkId('')
      }
    }
  }

  const saveCurrentPath = async () => {
    if (currentBookmark) {
      return
    }
    if (savingCurrent || mutationPending) {
      return
    }
    if (!connected) {
      notification.warning({
        message: t('files.bookmarkNoSession'),
        placement: 'topRight',
        duration: 2.8,
      })
      return
    }
    setSavingCurrent(true)
    try {
      await onCreateBookmark({
        name: suggestBookmarkName(normalizedCurrentPath),
        path: normalizedCurrentPath,
        group_id: '',
      })
    } catch (error) {
      notifyError(error)
    } finally {
      setSavingCurrent(false)
    }
  }

  const handleRailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return
    }
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('.files-bookmark-rail-item:not(:disabled)'),
    ).filter((button) => button.getClientRects().length > 0)
    if (buttons.length === 0) {
      return
    }
    const currentIndex = buttons.findIndex((button) => button === document.activeElement)
    let nextIndex: number
    if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1
    } else if (event.key === 'ArrowLeft') {
      nextIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1
    } else {
      nextIndex = currentIndex < 0 || currentIndex === buttons.length - 1 ? 0 : currentIndex + 1
    }
    event.preventDefault()
    buttons[nextIndex]?.focus()
    buttons[nextIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const handleRailWheel = (event: WheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (maxScrollLeft <= 1) {
      return
    }
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY
    if (rawDelta === 0) {
      return
    }
    const unit = event.deltaMode === 1
      ? 28
      : event.deltaMode === 2
        ? Math.max(180, viewport.clientWidth * 0.72)
        : 1
    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, viewport.scrollLeft + rawDelta * unit),
    )
    if (Math.abs(nextScrollLeft - viewport.scrollLeft) <= 1) {
      return
    }
    event.preventDefault()
    viewport.scrollTo({ left: nextScrollLeft, behavior: 'auto' })
  }

  return (
    <nav className="files-bookmark-rail" aria-label={t('files.bookmarkRailLabel')}>
      <div
        className={[
          'files-bookmark-rail-scroller',
          scrollState.canScrollLeft ? 'can-scroll-left' : '',
          scrollState.canScrollRight ? 'can-scroll-right' : '',
        ].filter(Boolean).join(' ')}
      >
        <button
          type="button"
          className="files-bookmark-rail-scroll is-left"
          aria-label={t('files.bookmarkScrollLeft')}
          disabled={!scrollState.canScrollLeft}
          onClick={() => scrollRail(-1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>

        <div
          ref={viewportRef}
          className="files-bookmark-rail-viewport"
          onKeyDown={handleRailKeyDown}
          onWheel={handleRailWheel}
        >
          <div ref={trackRef} className="files-bookmark-rail-track">
            {railGroups.length === 0 ? (
              <span className="files-bookmark-rail-empty">{t('files.noBookmarks')}</span>
            ) : (
              railGroups.map((group) => (
                <span
                  key={group.id || '__ungrouped__'}
                  className="files-bookmark-rail-group"
                  role="group"
                  aria-label={group.name}
                >
                  <Tooltip title={group.name} placement="bottom" mouseEnterDelay={0.45}>
                    <span className="files-bookmark-rail-group-label">
                      <span>{group.name}</span>
                      <small>{group.items.length}</small>
                    </span>
                  </Tooltip>
                  <span className="files-bookmark-rail-group-items">
                    {group.items.map((bookmark) => {
                      const current = currentBookmark?.id === bookmark.id
                      const navigating = navigatingBookmarkId === bookmark.id
                      return (
                        <Tooltip
                          key={bookmark.id}
                          title={(
                            <span className="files-bookmark-tooltip-copy">
                              <strong>{bookmark.name}</strong>
                              <span>{bookmark.path}</span>
                              <small>{group.name}</small>
                            </span>
                          )}
                          placement="bottom"
                          mouseEnterDelay={0.45}
                        >
                          <button
                            type="button"
                            className={[
                              'files-bookmark-rail-item',
                              current ? 'is-current' : '',
                              navigating ? 'is-loading' : '',
                            ].filter(Boolean).join(' ')}
                            aria-current={current ? 'location' : undefined}
                            aria-label={`${bookmark.name}: ${bookmark.path}`}
                            aria-busy={navigating || undefined}
                            aria-disabled={navigating || undefined}
                            data-bookmark-id={bookmark.id}
                            disabled={!connected}
                            onClick={() => {
                              if (!navigating) {
                                void navigateToBookmark(bookmark)
                              }
                            }}
                          >
                            {navigating ? (
                              <span className="files-bookmark-rail-item-loader" aria-hidden="true">
                                <LoaderCircle className="is-spinning" size={13} />
                              </span>
                            ) : null}
                            <span>{bookmark.name}</span>
                          </button>
                        </Tooltip>
                      )
                    })}
                  </span>
                </span>
              ))
            )}
          </div>
        </div>

        <button
          type="button"
          className="files-bookmark-rail-scroll is-right"
          aria-label={t('files.bookmarkScrollRight')}
          disabled={!scrollState.canScrollRight}
          onClick={() => scrollRail(1)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      <span className="files-bookmark-rail-divider" aria-hidden="true" />

      <Tooltip
        title={(
          <span className="files-bookmark-tooltip-copy">
            <strong>
              {currentBookmark
                ? t('files.bookmarkCurrentSaved')
                : t('files.bookmarkCurrentAdd')}
            </strong>
            <span>{normalizedCurrentPath}</span>
          </span>
        )}
        placement="bottom"
        mouseEnterDelay={0.45}
      >
        <span className="files-bookmark-current-tooltip-target">
          <button
            type="button"
            className={`files-bookmark-current-toggle ${currentBookmark ? 'is-saved' : ''}`}
            aria-label={currentBookmark
              ? t('files.bookmarkCurrentSaved')
              : t('files.bookmarkCurrentAdd')}
            disabled={!connected || savingCurrent || mutationPending || Boolean(currentBookmark)}
            onClick={() => void saveCurrentPath()}
          >
            {savingCurrent ? (
              <LoaderCircle className="is-spinning" size={14} aria-hidden="true" />
            ) : currentBookmark ? (
              <BookmarkCheck size={14} aria-hidden="true" />
            ) : (
              <BookmarkPlus size={14} aria-hidden="true" />
            )}
            <span>
              {currentBookmark
                ? t('files.bookmarkCurrentSavedShort')
                : t('files.bookmarkCurrentAddShort')}
            </span>
          </button>
        </span>
      </Tooltip>

      <Tooltip
        title={t('files.manageBookmarks')}
        placement="bottom"
        mouseEnterDelay={0.45}
      >
        <button
          ref={allBookmarksButtonRef}
          type="button"
          className={`files-bookmark-expand-toggle ${expanded ? 'is-expanded' : ''}`}
          aria-label={t('files.manageBookmarks')}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => onExpandedChange(!expanded)}
        >
          <span>{t('files.manageBookmarks')}</span>
          {expanded ? (
            <PanelRightClose size={14} aria-hidden="true" />
          ) : (
            <PanelRightOpen size={14} aria-hidden="true" />
          )}
        </button>
      </Tooltip>
    </nav>
  )
})
