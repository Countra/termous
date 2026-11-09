import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject, type WheelEvent } from 'react'
import type { AnalysisGeometry } from '#common/contracts'
import { hitCandidates } from './annotationLayout'

export interface CandidateMenu { x: number; y: number; items: AnalysisGeometry[] }
export function useCanvasSelection(geometry: AnalysisGeometry[], selected: number | undefined, disabled: boolean,
  scale: number, contextKey: string, viewport: RefObject<HTMLDivElement | null>, onSelect: (id: number) => void) {
  const image = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<number>()
  const [menu, setMenu] = useState<CandidateMenu>()
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean }>(undefined)
  const frame = useRef<number | undefined>(undefined)
  const cancelHover = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    frame.current = undefined
  }, [])
  const reset = useCallback(() => {
    cancelHover(); gesture.current = undefined; setMenu(undefined); setHovered(undefined)
  }, [cancelHover])
  const close = () => { reset(); viewport.current?.focus({ preventScroll: true }) }
  useEffect(() => {
    reset()
    return cancelHover
  }, [geometry, disabled, scale, contextKey, reset, cancelHover])
  useEffect(() => {
    window.addEventListener('blur', reset)
    return () => window.removeEventListener('blur', reset)
  }, [reset])
  const hits = (x: number, y: number) => {
    const rect = image.current?.getBoundingClientRect()
    return rect && scale > 0 ? hitCandidates(geometry, (x - rect.left) / scale, (y - rect.top) / scale, selected) : []
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !viewport.current?.contains(e.target as Node) || e.button !== 0) return
    cancelHover()
    if (e.target instanceof Element && e.target.closest('button')) return
    setHovered(undefined)
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
    setMenu(undefined)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (g && g.id === e.pointerId) {
      g.moved ||= Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4
      return
    }
    if (disabled || menu || !viewport.current?.contains(e.target as Node) || e.target instanceof Element && e.target.closest('button')) return
    cancelHover()
    const { clientX, clientY } = e
    frame.current = requestAnimationFrame(() => { frame.current = undefined; setHovered(hits(clientX, clientY)[0]?.id) })
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.id !== e.pointerId) return
    gesture.current = undefined
    if (disabled || g.moved || Math.hypot(e.clientX - g.x, e.clientY - g.y) > 4) return
    const items = hits(e.clientX, e.clientY)
    if (items.length === 1) onSelect(items[0].id)
    else if (items.length > 1) {
      const rect = viewport.current!.getBoundingClientRect()
      setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, items })
    }
  }
  return { image, hovered, setHovered, menu: disabled ? undefined : menu, close,
    handlers: { onPointerDownCapture: down, onPointerMoveCapture: move, onPointerUpCapture: up,
      onPointerCancelCapture: () => { gesture.current = undefined },
      onLostPointerCaptureCapture: () => { gesture.current = undefined },
      onPointerLeave: () => { cancelHover(); if (!menu) setHovered(undefined) },
      // Portal 菜单的滚轮仍沿 React 树传播，只有画布内的滚轮才属于缩放手势。
      onWheelCapture: (e: WheelEvent<HTMLDivElement>) => { if (viewport.current?.contains(e.target as Node)) reset() } } }
}
