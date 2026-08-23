import { Button, Tooltip } from 'antd'
import {
  CircleAlert,
  FileSearch,
  LoaderCircle,
  LocateFixed,
  Search,
  SearchX,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { FileNameSearchResult, FileNameSearchResultItem } from '#entities/file'
import { calculateFixedVirtualWindow } from '#shared/model'
import type { FileNameSearchPhase } from '../model/types'
import styles from './GlobalFileSearchResults.module.scss'

interface GlobalFileSearchResultsProps {
  result: FileNameSearchResult | null
  phase: FileNameSearchPhase
  searchedQuery: string
  locatingPath: string
  unavailablePaths: ReadonlySet<string>
  onReveal: (item: FileNameSearchResultItem) => void
}

const resultRowHeight = 58
const resultOverscan = 6

export function GlobalFileSearchResults({
  result,
  phase,
  searchedQuery,
  locatingPath,
  unavailablePaths,
  onReveal,
}: GlobalFileSearchResultsProps) {
  const { t } = useTranslation()
  const listboxID = useId()
  const viewportRef = useRef<HTMLDivElement>(null)
  const programmaticActiveIndexRef = useRef<number | null>(null)
  const items = useMemo(() => result?.items ?? [], [result?.items])
  const [activePath, setActivePath] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(360)
  const running = phase === 'running' || phase === 'stopping'
  const activeItem = items.find((item) => item.path === activePath) ?? null
  const activeIndex = activeItem ? items.indexOf(activeItem) : -1
  const windowRange = calculateFixedVirtualWindow(
    items.length,
    scrollTop,
    viewportHeight,
    resultRowHeight,
    resultOverscan,
  )
  const visibleItems = items.slice(windowRange.start, windowRange.end)
  const activeOptionID = activeIndex >= windowRange.start && activeIndex < windowRange.end
    ? `${listboxID}-option-${activeIndex}`
    : undefined

  useLayoutEffect(() => {
    setActivePath((current) => (
      items.some((item) => item.path === current)
        ? current
        : items[0]?.path ?? ''
    ))
  }, [items])

  useLayoutEffect(() => {
    programmaticActiveIndexRef.current = null
    setScrollTop(0)
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0
    }
  }, [result])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const updateHeight = () => {
      if (viewport.clientHeight > 0) {
        setViewportHeight(viewport.clientHeight)
      }
    }
    const observer = new ResizeObserver(updateHeight)
    observer.observe(viewport)
    updateHeight()
    return () => observer.disconnect()
  }, [])

  const focusItem = useCallback((index: number) => {
    const viewport = viewportRef.current
    const nextIndex = Math.max(0, Math.min(items.length - 1, index))
    const next = items[nextIndex]
    if (!next || !viewport) {
      return
    }
    setActivePath(next.path)
    const rowTop = nextIndex * resultRowHeight
    const rowBottom = rowTop + resultRowHeight
    let nextScrollTop = viewport.scrollTop
    if (rowTop < viewport.scrollTop) {
      nextScrollTop = rowTop
    } else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
      nextScrollTop = Math.max(0, rowBottom - viewport.clientHeight)
    }
    if (nextScrollTop !== viewport.scrollTop) {
      programmaticActiveIndexRef.current = nextIndex
      viewport.scrollTop = nextScrollTop
      setScrollTop(nextScrollTop)
      window.requestAnimationFrame(() => {
        if (programmaticActiveIndexRef.current === nextIndex) {
          programmaticActiveIndexRef.current = null
        }
      })
    } else {
      programmaticActiveIndexRef.current = null
    }
    viewport.focus({ preventScroll: true })
  }, [items])

  const revealItem = useCallback((item: FileNameSearchResultItem) => {
    if (!unavailablePaths.has(item.path) && !locatingPath) {
      onReveal(item)
    }
  }, [locatingPath, onReveal, unavailablePaths])

  const emptyState = result && items.length === 0 && !running
    ? {
        icon: <SearchX size={25} aria-hidden="true" />,
        title: t('files.globalSearch.noResults', { query: searchedQuery }),
        description: t('files.globalSearch.noResultsDescription'),
      }
    : running
      ? {
          icon: <LoaderCircle className={styles.spinner} size={25} aria-hidden="true" />,
          title: t(phase === 'stopping'
            ? 'files.globalSearch.stopping'
            : 'files.globalSearch.searching'),
          description: t('files.globalSearch.searchingDescription'),
        }
      : {
          icon: <Search size={25} aria-hidden="true" />,
          title: t('files.globalSearch.initialTitle'),
          description: t('files.globalSearch.initialDescription'),
        }

  return (
    <div
      className={styles['results-surface']}
      data-testid="global-file-search-results"
      aria-busy={running}
    >
      <div
        ref={viewportRef}
        className={styles['results-viewport']}
        role={items.length > 0 ? 'listbox' : 'status'}
        aria-label={t('files.globalSearch.results')}
        aria-activedescendant={activeOptionID}
        tabIndex={items.length > 0 ? 0 : undefined}
        onKeyDown={(event) => {
          if (items.length === 0) {
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            if (activeItem) {
              revealItem(activeItem)
            }
            return
          }
          const currentIndex = activeIndex >= 0 ? activeIndex : 0
          const targetIndex = event.key === 'ArrowDown'
            ? currentIndex + 1
            : event.key === 'ArrowUp'
              ? currentIndex - 1
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : null
          if (targetIndex === null) {
            return
          }
          event.preventDefault()
          focusItem(targetIndex)
        }}
        onScroll={(event) => {
          const viewport = event.currentTarget
          const nextScrollTop = viewport.scrollTop
          setScrollTop(nextScrollTop)
          const programmaticIndex = programmaticActiveIndexRef.current
          if (programmaticIndex !== null) {
            programmaticActiveIndexRef.current = null
            setActivePath(items[programmaticIndex]?.path ?? '')
            return
          }
          if (items.length === 0 || viewport.clientHeight <= 0) {
            return
          }
          const firstVisible = Math.min(
            items.length - 1,
            Math.floor(nextScrollTop / resultRowHeight),
          )
          const lastVisible = Math.min(
            items.length - 1,
            Math.ceil((nextScrollTop + viewport.clientHeight) / resultRowHeight) - 1,
          )
          if (activeIndex < firstVisible || activeIndex > lastVisible) {
            setActivePath(items[firstVisible]?.path ?? '')
          }
        }}
      >
        {items.length > 0 ? (
          <div
            className={styles['results-virtual-space']}
            style={{ height: windowRange.totalHeight }}
          >
            <div
              className={styles['results-window']}
              style={{ transform: `translateY(${windowRange.offset}px)` }}
            >
              {visibleItems.map((item, visibleIndex) => {
                const index = windowRange.start + visibleIndex
                const active = item.path === activePath
                const unavailable = unavailablePaths.has(item.path)
                return (
                  <div
                    key={item.path}
                    id={`${listboxID}-option-${index}`}
                    role="option"
                    data-row-key={item.path}
                    data-result-index={index}
                    aria-label={`${item.name}, ${item.parent_path}`}
                    aria-posinset={index + 1}
                    aria-selected={active}
                    aria-setsize={items.length}
                    aria-disabled={unavailable}
                    className={[
                      styles['result-row'],
                      active ? styles['is-active'] : '',
                      unavailable ? styles['is-unavailable'] : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => {
                      setActivePath(item.path)
                      viewportRef.current?.focus({ preventScroll: true })
                    }}
                    onDoubleClick={() => revealItem(item)}
                  >
                    <span className={styles['result-icon']} aria-hidden="true">
                      <FileSearch size={16} />
                    </span>
                    <span className={styles['result-copy']}>
                      <strong>{item.name}</strong>
                      <code>{item.parent_path}</code>
                    </span>
                    <Tooltip title={t(unavailable
                      ? 'files.globalSearch.resultUnavailable'
                      : 'files.globalSearch.reveal')}>
                      <Button
                        type="text"
                        className={styles['result-action']}
                        tabIndex={-1}
                        aria-label={t('files.globalSearch.revealNamed', { name: item.name })}
                        disabled={unavailable || Boolean(locatingPath && locatingPath !== item.path)}
                        loading={locatingPath === item.path}
                        icon={<LocateFixed size={15} aria-hidden="true" />}
                        onClick={(event) => {
                          event.stopPropagation()
                          revealItem(item)
                        }}
                      />
                    </Tooltip>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className={styles['results-empty']}>
            <span className={styles['results-empty-icon']}>{emptyState.icon}</span>
            <strong>{emptyState.title}</strong>
            <span>{emptyState.description}</span>
          </div>
        )}
      </div>

      <footer className={styles['results-footer']}>
        {activeItem ? <code>{activeItem.path}</code> : <span aria-hidden="true" />}
        {unavailablePaths.size > 0 ? (
          <span className={styles['results-stale-note']} role="status">
            <CircleAlert size={13} aria-hidden="true" />
            {t('files.globalSearch.staleResults', { count: unavailablePaths.size })}
          </span>
        ) : null}
      </footer>
    </div>
  )
}
