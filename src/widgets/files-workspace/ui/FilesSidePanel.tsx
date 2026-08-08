import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { filesWorkspaceSidePanelWidthBounds } from '../model/filesWorkspaceState'
import styles from './FilesWorkspace.module.scss'

export type FilesSidePanelMode = 'bookmarks' | 'details'

export interface FilesSidePanelProps {
  id: string
  mode: FilesSidePanelMode
  width: number
  ariaLabel: string
  resizeLabel: string
  children: ReactNode
  closeOnEscape?: boolean
  onWidthChange: (width: number) => void
  onRequestClose: () => void
}

const overlayMediaQuery = '(max-width: 1279px)'
const fullOverlayMediaQuery = '(max-width: 699px)'

function boundedSidePanelWidth(width: number) {
  return Math.min(
    filesWorkspaceSidePanelWidthBounds.max,
    Math.max(filesWorkspaceSidePanelWidthBounds.min, Math.round(width)),
  )
}

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

function hasOtherModalPanel(panel: HTMLElement) {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  ).some((candidate) => (
    candidate !== panel && candidate.getClientRects().length > 0
  ))
}

export const FilesSidePanel = forwardRef<HTMLElement, FilesSidePanelProps>(
  function FilesSidePanel({
    id,
    mode,
    width,
    ariaLabel,
    resizeLabel,
    children,
    closeOnEscape = true,
    onWidthChange,
    onRequestClose,
  }, forwardedRef) {
    const overlay = useMediaQuery(overlayMediaQuery)
    const fullOverlay = useMediaQuery(fullOverlayMediaQuery)
    const panelRef = useRef<HTMLElement>(null)
    const resizeCleanupRef = useRef<(() => void) | null>(null)
    const resolvedWidth = boundedSidePanelWidth(width)
    const panelStyle = {
      '--files-side-panel-width': `${resolvedWidth}px`,
    } as CSSProperties
    const assignPanelRef = useCallback((node: HTMLElement | null) => {
      panelRef.current = node
      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    }, [forwardedRef])

    const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
      if (overlay || event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      resizeCleanupRef.current?.()
      const startX = event.clientX
      const startWidth = resolvedWidth
      const resizeTarget = event.currentTarget
      const pointerId = event.pointerId
      let previewWidth = startWidth
      let previewFrame: number | null = null
      let finished = false
      resizeTarget.setPointerCapture(pointerId)
      document.body.dataset.panelResizing = 'true'

      const handlePointerMove = (moveEvent: PointerEvent) => {
        moveEvent.preventDefault()
        previewWidth = boundedSidePanelWidth(startWidth + startX - moveEvent.clientX)
        if (previewFrame !== null) {
          return
        }
        previewFrame = window.requestAnimationFrame(() => {
          previewFrame = null
          panelRef.current?.style.setProperty(
            '--files-side-panel-width',
            `${previewWidth}px`,
          )
        })
      }
      const cleanup = (commit: boolean) => {
        if (finished) {
          return
        }
        finished = true
        if (previewFrame !== null) {
          window.cancelAnimationFrame(previewFrame)
          previewFrame = null
        }
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        window.removeEventListener('blur', finish)
        resizeTarget.removeEventListener('lostpointercapture', finish)
        if (resizeTarget.hasPointerCapture(pointerId)) {
          resizeTarget.releasePointerCapture(pointerId)
        }
        delete document.body.dataset.panelResizing
        resizeCleanupRef.current = null
        if (commit && previewWidth !== startWidth) {
          onWidthChange(previewWidth)
        }
      }
      const finish = () => cleanup(true)
      resizeCleanupRef.current = () => cleanup(false)
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', finish, { once: true })
      window.addEventListener('pointercancel', finish, { once: true })
      window.addEventListener('blur', finish, { once: true })
      resizeTarget.addEventListener('lostpointercapture', finish, { once: true })
    }, [onWidthChange, overlay, resolvedWidth])

    const resizeWithKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
      if (overlay || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return
      }
      event.preventDefault()
      if (event.key === 'Home') {
        onWidthChange(filesWorkspaceSidePanelWidthBounds.min)
        return
      }
      if (event.key === 'End') {
        onWidthChange(filesWorkspaceSidePanelWidthBounds.max)
        return
      }
      const direction = event.key === 'ArrowLeft' ? 1 : -1
      onWidthChange(boundedSidePanelWidth(
        resolvedWidth + direction * (event.shiftKey ? 24 : 8),
      ))
    }, [onWidthChange, overlay, resolvedWidth])

    useEffect(() => () => {
      resizeCleanupRef.current?.()
      delete document.body.dataset.panelResizing
    }, [])

    useEffect(() => {
      if (!fullOverlay || !closeOnEscape) {
        return undefined
      }
      const panel = panelRef.current
      if (!panel) {
        return undefined
      }
      const getFocusableElements = () => Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
          + '[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0)
      const focusFrame = window.requestAnimationFrame(() => {
        if (!panel.contains(document.activeElement) && !hasOtherModalPanel(panel)) {
          getFocusableElements()[0]?.focus({ preventScroll: true })
        }
      })
      const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
        if (event.defaultPrevented || hasOtherModalPanel(panel)) {
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onRequestClose()
          return
        }
        if (event.key !== 'Tab') {
          return
        }
        const focusable = getFocusableElements()
        if (focusable.length === 0) {
          event.preventDefault()
          panel.focus({ preventScroll: true })
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !panel.contains(active))) {
          event.preventDefault()
          last?.focus({ preventScroll: true })
        } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
          event.preventDefault()
          first?.focus({ preventScroll: true })
        }
      }
      window.addEventListener('keydown', handleWindowKeyDown)
      return () => {
        window.cancelAnimationFrame(focusFrame)
        window.removeEventListener('keydown', handleWindowKeyDown)
      }
    }, [closeOnEscape, fullOverlay, onRequestClose])

    return (
      <aside
        ref={assignPanelRef}
        id={id}
        className={[
          styles['files-side-panel'],
          `is-${mode}`,
          mode === 'bookmarks' ? styles['files-bookmarks-sidebar'] : styles['files-inspector'],
          overlay ? 'is-overlay' : styles['is-docked'],
        ].join(' ')}
        style={panelStyle}
        aria-label={ariaLabel}
        role={fullOverlay ? 'dialog' : undefined}
        aria-modal={fullOverlay ? true : undefined}
        onKeyDown={(event) => {
          if (closeOnEscape && event.key === 'Escape') {
            event.preventDefault()
            onRequestClose()
          }
        }}
      >
        {children}
        <div
          className={styles['files-side-panel-resize-edge']}
          role="separator"
          tabIndex={overlay ? -1 : 0}
          aria-hidden={overlay ? true : undefined}
          aria-orientation="vertical"
          aria-label={resizeLabel}
          aria-valuemin={filesWorkspaceSidePanelWidthBounds.min}
          aria-valuemax={filesWorkspaceSidePanelWidthBounds.max}
          aria-valuenow={resolvedWidth}
          aria-valuetext={`${resolvedWidth}px`}
          onPointerDown={startResize}
          onKeyDown={resizeWithKeyboard}
        />
      </aside>
    )
  },
)

FilesSidePanel.displayName = 'FilesSidePanel'
