import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { usePersistentJsonState } from './usePersistentJsonState'

type ResizablePanelSide = 'left' | 'right'

interface UseRafResizablePanelWidthOptions {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  side: ResizablePanelSide
  targetRef: RefObject<HTMLElement | null>
  cssVariableName: string
  onExpand?: () => void
}

export function useRafResizablePanelWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  side,
  targetRef,
  cssVariableName,
  onExpand,
}: UseRafResizablePanelWidthOptions) {
  const [width, setWidth] = usePersistentJsonState<number>(
    storageKey,
    clamp(defaultWidth, minWidth, maxWidth),
    (value) => parsePanelWidth(value, defaultWidth, minWidth, maxWidth),
  )
  const [resizing, setResizing] = useState(false)
  const widthRef = useRef(width)
  const cleanupRef = useRef<(() => void) | null>(null)
  const frameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    if (!resizing) {
      widthRef.current = clamp(width, minWidth, maxWidth)
    }
    targetRef.current?.style.setProperty(cssVariableName, `${widthRef.current}px`)
  })

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      document.body.classList.remove('is-panel-resizing')
    }
  }, [])

  const beginResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      cleanupRef.current?.()
      onExpand?.()
      window.getSelection()?.removeAllRanges()

      const pointerStartX = event.clientX
      const originWidth = widthRef.current
      let latestX = pointerStartX
      let committedWidth = originWidth

      const applyWidth = () => {
        frameRef.current = null
        const delta = side === 'left' ? latestX - pointerStartX : pointerStartX - latestX
        committedWidth = clamp(originWidth + delta, minWidth, maxWidth)
        widthRef.current = committedWidth
        targetRef.current?.style.setProperty(cssVariableName, `${committedWidth}px`)
      }

      const requestApply = () => {
        if (frameRef.current !== null) {
          return
        }
        frameRef.current = window.requestAnimationFrame(applyWidth)
      }

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        latestX = moveEvent.clientX
        moveEvent.preventDefault()
        requestApply()
      }

      const stopListening = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', finishAndCommit)
        window.removeEventListener('pointercancel', finishAndCommit)

        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current)
          frameRef.current = null
          applyWidth()
        }

        document.body.classList.remove('is-panel-resizing')
      }

      const finishAndCommit = () => {
        stopListening()
        cleanupRef.current = null
        setWidth(committedWidth)
        setResizing(false)
      }

      cleanupRef.current = stopListening
      setResizing(true)
      document.body.classList.add('is-panel-resizing')
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', finishAndCommit)
      window.addEventListener('pointercancel', finishAndCommit)
    },
    [cssVariableName, maxWidth, minWidth, onExpand, setWidth, side, targetRef],
  )

  return {
    width: clamp(width, minWidth, maxWidth),
    resizing,
    beginResize,
  }
}

function parsePanelWidth(value: unknown, defaultWidth: number, minWidth: number, maxWidth: number) {
  return clamp(typeof value === 'number' && Number.isFinite(value) ? value : defaultWidth, minWidth, maxWidth)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
