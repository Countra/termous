import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { usePersistentJsonState } from './usePersistentJsonState'

type ResizablePanelSide = 'left' | 'right'

const resizeHoldDelayMs = 500
const resizeMoveThresholdPx = 4

interface UseResizablePanelWidthOptions {
  storageKey: string
  defaultWidth: number
  minWidth: number
  maxWidth: number
  side: ResizablePanelSide
  onExpand?: () => void
}

export function useResizablePanelWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  side,
  onExpand,
}: UseResizablePanelWidthOptions) {
  const [width, setWidth] = usePersistentJsonState<number>(
    storageKey,
    clamp(defaultWidth, minWidth, maxWidth),
    (value) => parsePanelWidth(value, defaultWidth, minWidth, maxWidth),
  )
  const [resizing, setResizing] = useState(false)
  const widthRef = useRef(width)
  const suppressClickRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    widthRef.current = clamp(width, minWidth, maxWidth)
  }, [maxWidth, minWidth, width])

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

      const pointerStartX = event.clientX
      let originX = pointerStartX
      let originWidth = widthRef.current
      let lastX = pointerStartX
      let moved = false
      let movedBeforeActivation = false
      let active = false

      const activate = () => {
        if (active) {
          return
        }
        originX = lastX
        originWidth = widthRef.current
        active = true
        onExpand?.()
        setResizing(true)
        document.body.classList.add('is-panel-resizing')
        window.getSelection()?.removeAllRanges()
      }

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        lastX = moveEvent.clientX
        if (!active) {
          if (Math.abs(lastX - pointerStartX) >= resizeMoveThresholdPx) {
            movedBeforeActivation = true
          }
          return
        }

        const delta = side === 'left' ? moveEvent.clientX - originX : originX - moveEvent.clientX
        if (delta !== 0) {
          moved = true
        }
        activate()
        moveEvent.preventDefault()
        setWidth(clamp(originWidth + delta, minWidth, maxWidth))
      }

      const holdTimer = window.setTimeout(activate, resizeHoldDelayMs)

      const finishResize = () => {
        window.clearTimeout(holdTimer)
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', finishResize)
        window.removeEventListener('pointercancel', finishResize)
        cleanupRef.current = null

        if (active) {
          setResizing(false)
          document.body.classList.remove('is-panel-resizing')
        }
        if (active || moved || movedBeforeActivation) {
          suppressClickRef.current = true
          window.setTimeout(() => {
            suppressClickRef.current = false
          }, 0)
        }
      }

      cleanupRef.current?.()
      cleanupRef.current = finishResize
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', finishResize)
      window.addEventListener('pointercancel', finishResize)
    },
    [maxWidth, minWidth, onExpand, setWidth, side],
  )

  const shouldSuppressClick = useCallback(() => {
    if (!suppressClickRef.current) {
      return false
    }
    suppressClickRef.current = false
    return true
  }, [])

  return {
    width: clamp(width, minWidth, maxWidth),
    resizing,
    beginResize,
    shouldSuppressClick,
  }
}

function parsePanelWidth(value: unknown, defaultWidth: number, minWidth: number, maxWidth: number) {
  return clamp(typeof value === 'number' && Number.isFinite(value) ? value : defaultWidth, minWidth, maxWidth)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
