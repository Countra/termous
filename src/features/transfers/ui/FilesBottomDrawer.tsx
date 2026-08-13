import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import styles from './FilesBottomDrawer.module.scss'

interface FilesBottomDrawerProps {
  id?: string
  open: boolean
  height: number
  minHeight?: number
  maxHeight?: number
  minimumContentHeight?: number
  ariaLabel: string
  resizeLabel: string
  className?: string
  autoFocusOnOpen?: boolean
  children: ReactNode
  onHeightChange: (height: number) => void
  onEscape?: () => void
}

function clampDrawerHeight(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)))
}

export function FilesBottomDrawer({
  id,
  open,
  height,
  minHeight = 260,
  maxHeight = 420,
  minimumContentHeight = 160,
  ariaLabel,
  resizeLabel,
  className,
  autoFocusOnOpen = false,
  children,
  onHeightChange,
  onEscape,
}: FilesBottomDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null)
  const resizeEdgeRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const onHeightChangeRef = useRef(onHeightChange)
  const committedHeightRef = useRef(height)
  const draftHeightRef = useRef(height)
  const [resizing, setResizing] = useState(false)
  const [effectiveBounds, setEffectiveBounds] = useState(() => ({
    minimum: minHeight,
    maximum: maxHeight,
  }))
  const effectiveMinimum = effectiveBounds.minimum
  const effectiveMaximum = effectiveBounds.maximum
  onHeightChangeRef.current = onHeightChange
  committedHeightRef.current = height

  const applyHeight = useCallback((nextHeight: number) => {
    const bounded = clampDrawerHeight(nextHeight, effectiveMinimum, effectiveMaximum)
    draftHeightRef.current = bounded
    drawerRef.current?.style.setProperty('--files-bottom-drawer-height', `${bounded}px`)
    resizeEdgeRef.current?.setAttribute('aria-valuenow', String(bounded))
    resizeEdgeRef.current?.setAttribute('aria-valuetext', `${bounded}px`)
    return bounded
  }, [effectiveMaximum, effectiveMinimum])

  useLayoutEffect(() => {
    const drawer = drawerRef.current
    const parent = drawer?.parentElement
    if (!drawer || !parent) {
      return undefined
    }
    const canvas = drawer.previousElementSibling instanceof HTMLElement
      ? drawer.previousElementSibling
      : null
    const updateBounds = () => {
      const parentHeight = Math.floor(parent.getBoundingClientRect().height)
      if (parentHeight <= 0) {
        return
      }
      const canvasHeight = Math.floor(canvas?.getBoundingClientRect().height ?? 0)
      const availableMaximum = window.innerWidth < 1000
        ? Math.max(
            0,
            Math.min(
              parentHeight - 96,
              canvasHeight > 0 ? canvasHeight : parentHeight - 96,
            ),
          )
        : Math.max(
            0,
            Math.floor(
              canvasHeight
              + (open ? drawer.getBoundingClientRect().height : 0)
              - minimumContentHeight,
            ),
          )
      const maximum = Math.min(maxHeight, availableMaximum)
      const minimum = Math.min(minHeight, maximum)
      setEffectiveBounds((current) => (
        current.minimum === minimum && current.maximum === maximum
          ? current
          : { minimum, maximum }
      ))
    }
    const observer = new ResizeObserver(updateBounds)
    observer.observe(parent)
    if (canvas) {
      observer.observe(canvas)
    }
    window.addEventListener('resize', updateBounds)
    updateBounds()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [maxHeight, minHeight, minimumContentHeight, open])

  useEffect(() => {
    if (!resizeCleanupRef.current) {
      applyHeight(height)
    }
  }, [applyHeight, height])

  useEffect(() => {
    if (!open || !autoFocusOnOpen) {
      return undefined
    }
    const frame = window.requestAnimationFrame(() => {
      drawerRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocusOnOpen, open])

  useEffect(
    () => () => {
      resizeCleanupRef.current?.()
      resizeCleanupRef.current = null
      delete document.body.dataset.termousBottomDrawerResizing
    },
    [],
  )

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()

    const resizeEdge = event.currentTarget
    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = clampDrawerHeight(
      drawerRef.current?.getBoundingClientRect().height || committedHeightRef.current,
      effectiveMinimum,
      effectiveMaximum,
    )
    committedHeightRef.current = startHeight
    draftHeightRef.current = startHeight
    resizeEdge.setPointerCapture(pointerId)
    setResizing(true)
    document.body.dataset.termousBottomDrawerResizing = 'true'

    let finished = false
    const finishResize = (commit: boolean) => {
      if (finished) {
        return
      }
      finished = true
      setResizing(false)
      delete document.body.dataset.termousBottomDrawerResizing
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
      window.removeEventListener('blur', handleEnd)
      if (resizeEdge.hasPointerCapture(pointerId)) {
        resizeEdge.releasePointerCapture(pointerId)
      }
      resizeCleanupRef.current = null
      if (commit && draftHeightRef.current !== committedHeightRef.current) {
        onHeightChangeRef.current(draftHeightRef.current)
      }
    }
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault()
      applyHeight(startHeight + startY - moveEvent.clientY)
    }
    const handleEnd = () => finishResize(true)

    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', handleEnd, { once: true })
    window.addEventListener('pointercancel', handleEnd, { once: true })
    window.addEventListener('blur', handleEnd, { once: true })
    resizeCleanupRef.current = () => finishResize(false)
  }

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8
    const currentHeight = draftHeightRef.current
    let nextHeight: number | null = null
    if (event.key === 'ArrowUp') {
      nextHeight = currentHeight + step
    } else if (event.key === 'ArrowDown') {
      nextHeight = currentHeight - step
    } else if (event.key === 'Home') {
      nextHeight = effectiveMinimum
    } else if (event.key === 'End') {
      nextHeight = effectiveMaximum
    }
    if (nextHeight === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const bounded = applyHeight(nextHeight)
    if (bounded !== currentHeight) {
      onHeightChangeRef.current(bounded)
    }
  }

  const drawerStyle = {
    '--files-bottom-drawer-height': `${clampDrawerHeight(
      height,
      effectiveMinimum,
      effectiveMaximum,
    )}px`,
  } as CSSProperties

  return (
    <section
      id={id}
      ref={drawerRef}
      className={[
        styles.root,
        open ? styles.open : '',
        resizing ? styles.resizing : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      style={drawerStyle}
      aria-hidden={!open}
      aria-label={open ? ariaLabel : undefined}
      tabIndex={open && autoFocusOnOpen ? -1 : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && onEscape) {
          event.preventDefault()
          onEscape()
        }
      }}
    >
      <div
        ref={resizeEdgeRef}
        className={styles['resize-edge']}
        role="separator"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        aria-orientation="horizontal"
        aria-label={resizeLabel}
        aria-valuemin={effectiveMinimum}
        aria-valuemax={effectiveMaximum}
        aria-valuenow={clampDrawerHeight(height, effectiveMinimum, effectiveMaximum)}
        aria-valuetext={`${clampDrawerHeight(height, effectiveMinimum, effectiveMaximum)}px`}
        onPointerDown={beginResize}
        onKeyDown={resizeWithKeyboard}
      />
      <div className={styles.surface}>
        {children}
      </div>
    </section>
  )
}
