import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  clampCommandDockHeight,
  commandDockHeightLimits,
  resolveCommandDockHeightBounds,
  type CommandDockHeightBounds,
} from '../model/commandDockHeight'
import styles from './WorkbenchPage.module.scss'

interface CommandDockResizeHandleProps {
  open: boolean
  preferredHeight: number
  onHeightChange: (height: number) => void
}

export const CommandDockResizeHandle = memo(function CommandDockResizeHandle({
  open,
  preferredHeight,
  onHeightChange,
}: CommandDockResizeHandleProps) {
  const { t } = useTranslation()
  const handleRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const frameRef = useRef<number | null>(null)
  const refreshBoundsRef = useRef<() => void>(() => undefined)
  const preferredHeightRef = useRef(preferredHeight)
  const onHeightChangeRef = useRef(onHeightChange)
  const boundsRef = useRef<CommandDockHeightBounds>({
    min: commandDockHeightLimits.min,
    max: commandDockHeightLimits.max,
  })
  const draftHeightRef = useRef(preferredHeight)
  const [bounds, setBounds] = useState(boundsRef.current)
  const [displayHeight, setDisplayHeight] = useState(preferredHeight)
  const [resizing, setResizing] = useState(false)

  preferredHeightRef.current = preferredHeight
  onHeightChangeRef.current = onHeightChange

  const applyHeight = useCallback((height: number, updateState = false) => {
    const nextHeight = clampCommandDockHeight(
      height,
      boundsRef.current.min,
      boundsRef.current.max,
    )
    draftHeightRef.current = nextHeight
    const handle = handleRef.current
    handle?.parentElement?.style.setProperty('--terminal-command-drawer-height', `${nextHeight}px`)
    handle?.setAttribute('aria-valuenow', String(nextHeight))
    handle?.setAttribute('aria-valuetext', `${nextHeight}px`)
    if (updateState) {
      setDisplayHeight((current) => current === nextHeight ? current : nextHeight)
    }
    return nextHeight
  }, [])

  useLayoutEffect(() => {
    const handle = handleRef.current
    const slot = handle?.parentElement
    if (!handle || !slot) {
      return undefined
    }
    const terminalWorkspace = slot.previousElementSibling instanceof HTMLElement
      ? slot.previousElementSibling
      : null

    const measureBounds = () => {
      const terminalHeight = terminalWorkspace?.getBoundingClientRect().height ?? 0
      const dockHeight = slot.getBoundingClientRect().height
      const measured = terminalHeight > 0 || dockHeight > 0
        ? resolveCommandDockHeightBounds(terminalHeight, dockHeight)
        : { min: commandDockHeightLimits.min, max: commandDockHeightLimits.max }
      boundsRef.current = measured
      setBounds((current) => current.min === measured.min && current.max === measured.max
        ? current
        : measured)
    }
    const updateBounds = () => {
      if (cleanupRef.current) {
        return
      }
      measureBounds()
      if (!cleanupRef.current) {
        applyHeight(preferredHeightRef.current, true)
      }
    }

    refreshBoundsRef.current = measureBounds
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateBounds)
    observer?.observe(slot)
    if (terminalWorkspace) {
      observer?.observe(terminalWorkspace)
    }
    window.addEventListener('resize', updateBounds)
    updateBounds()
    return () => {
      refreshBoundsRef.current = () => undefined
      observer?.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [applyHeight, open])

  useLayoutEffect(() => {
    if (!cleanupRef.current) {
      applyHeight(preferredHeight, true)
    }
  }, [applyHeight, preferredHeight])

  useEffect(() => () => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    delete document.body.dataset.termousBottomDrawerResizing
  }, [])

  useEffect(() => {
    if (!open) {
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
        setResizing(false)
      }
      if (document.activeElement === handleRef.current) {
        document.querySelector<HTMLElement>('[data-command-dispatch-toggle]')
          ?.focus({ preventScroll: true })
      }
    }
  }, [open])

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (!open || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    cleanupRef.current?.()
    window.getSelection()?.removeAllRanges()

    const handle = event.currentTarget
    const slot = handle.parentElement
    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = clampCommandDockHeight(
      slot?.getBoundingClientRect().height || draftHeightRef.current,
      boundsRef.current.min,
      boundsRef.current.max,
    )
    let latestY = startY
    let moved = false
    let finished = false

    const applyPointerHeight = () => {
      frameRef.current = null
      applyHeight(startHeight + startY - latestY)
    }
    const requestApply = () => {
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(applyPointerHeight)
      }
    }
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return
      }
      latestY = moveEvent.clientY
      moved ||= latestY !== startY
      moveEvent.preventDefault()
      requestApply()
    }
    const finishResize = (commit: boolean, updateReact = true) => {
      if (finished) {
        return
      }
      finished = true
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
      window.removeEventListener('blur', handleBlur)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
        if (commit) {
          applyPointerHeight()
        }
      }
      refreshBoundsRef.current()
      const finalHeight = applyHeight(draftHeightRef.current)
      if (handle.hasPointerCapture?.(pointerId)) {
        handle.releasePointerCapture(pointerId)
      }
      slot?.classList.remove(styles['is-resizing'])
      delete document.body.dataset.termousBottomDrawerResizing
      cleanupRef.current = null
      if (updateReact) {
        setResizing(false)
        setDisplayHeight(finalHeight)
      }
      if (commit && moved && finalHeight !== preferredHeightRef.current) {
        onHeightChangeRef.current(finalHeight)
      }
    }
    const handleEnd = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId === pointerId) {
        finishResize(true)
      }
    }
    const handleBlur = () => finishResize(true)

    handle.setPointerCapture?.(pointerId)
    slot?.classList.add(styles['is-resizing'])
    setResizing(true)
    document.body.dataset.termousBottomDrawerResizing = 'true'
    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
    window.addEventListener('blur', handleBlur)
    cleanupRef.current = () => finishResize(false, false)
  }

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      return
    }
    const step = event.shiftKey ? 24 : 8
    let nextHeight: number | null = null
    if (event.key === 'ArrowUp') {
      nextHeight = draftHeightRef.current + step
    } else if (event.key === 'ArrowDown') {
      nextHeight = draftHeightRef.current - step
    } else if (event.key === 'Home') {
      nextHeight = boundsRef.current.min
    } else if (event.key === 'End') {
      nextHeight = boundsRef.current.max
    }
    if (nextHeight === null) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const currentHeight = draftHeightRef.current
    const bounded = applyHeight(nextHeight, true)
    if (bounded !== currentHeight) {
      onHeightChangeRef.current(bounded)
    }
  }

  return (
    <div
      ref={handleRef}
      className={[
        styles['terminal-command-resize-edge'],
        resizing ? styles['is-resizing'] : '',
      ].filter(Boolean).join(' ')}
      role="separator"
      tabIndex={open ? 0 : -1}
      aria-hidden={!open}
      aria-orientation="horizontal"
      aria-label={t('commandDispatch.resizeDock')}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={displayHeight}
      aria-valuetext={`${displayHeight}px`}
      data-command-dock-resize-handle=""
      onPointerDown={beginResize}
      onKeyDown={resizeWithKeyboard}
    />
  )
})
