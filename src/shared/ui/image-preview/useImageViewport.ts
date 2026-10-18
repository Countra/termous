import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

interface Size { width: number; height: number }
interface Point { x: number; y: number }
type Zoom = number | 'fit'
interface View extends Point { zoom: Zoom }
interface Metrics { size?: Size; bounds: Size; scale: number; minimum: number; offset: Point; zoom: Zoom }
const initial: View = { zoom: 'fit', x: 0, y: 0 }
const maximum = 4
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))
const limitOffset = (point: Point, size: Size, bounds: Size, scale: number): Point => ({
  x: clamp(point.x, Math.max(0, (size.width * scale - bounds.width) / 2)),
  y: clamp(point.y, Math.max(0, (size.height * scale - bounds.height) / 2)),
})

export function useImageViewport(size: Size | undefined, enabled: boolean) {
  const viewport = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState<Size>({ width: 0, height: 0 })
  const [view, setView] = useState<View>(initial)
  const [dragging, setDragging] = useState(false)
  const gesture = useRef<{ pointer: number; start: Point; offset: Point } | undefined>(undefined)
  const fit = size && bounds.width > 0 && bounds.height > 0 ? Math.min(1, bounds.width / size.width, bounds.height / size.height) : 1
  const minimum = Math.min(.1, fit)
  const scale = view.zoom === 'fit' ? fit : Math.max(minimum, Math.min(maximum, view.zoom))
  const offset = size ? limitOffset(view, size, bounds, scale) : { x: 0, y: 0 }
  const metrics = useRef<Metrics>({ size, bounds, scale, minimum, offset, zoom: view.zoom })
  const canPan = enabled && !!size && (size.width * scale > bounds.width + 1 || size.height * scale > bounds.height + 1)

  useLayoutEffect(() => { metrics.current = { size, bounds, scale, minimum, offset, zoom: view.zoom } })
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setBounds(previous => element.clientWidth === previous.width && element.clientHeight === previous.height
      ? previous : { width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [enabled])

  const stopDragging = useCallback(() => {
    const current = gesture.current
    if (!current) return
    gesture.current = undefined
    setDragging(false)
    if (viewport.current?.hasPointerCapture?.(current.pointer)) viewport.current.releasePointerCapture(current.pointer)
  }, [])
  useEffect(() => {
    if (!enabled) { stopDragging(); setView(initial) }
  }, [enabled, stopDragging])
  useEffect(() => { stopDragging() }, [bounds.width, bounds.height, stopDragging])
  useEffect(() => {
    window.addEventListener('blur', stopDragging)
    return () => { window.removeEventListener('blur', stopDragging) }
  }, [stopDragging])

  const changeZoom = useCallback((zoom: Zoom, anchor: Point = { x: 0, y: 0 }) => {
    const current = metrics.current
    if (!current.size) return
    stopDragging()
    const next = zoom === 'fit' ? Math.min(1, current.bounds.width / current.size.width, current.bounds.height / current.size.height)
      : Math.max(current.minimum, Math.min(maximum, zoom))
    if (!(next > 0) || !Number.isFinite(next)) return
    // 缩放前后的同一图像坐标保持在鼠标下；图片小于视口的方向始终居中。
    const offset = zoom === 'fit' ? { x: 0, y: 0 } : limitOffset({
      x: anchor.x - (anchor.x - current.offset.x) * next / current.scale,
      y: anchor.y - (anchor.y - current.offset.y) * next / current.scale,
    }, current.size, current.bounds, next)
    const mode = zoom === 'fit' ? zoom : next
    metrics.current = { ...current, scale: next, offset, zoom: mode }
    setView({ zoom: mode, ...offset })
  }, [stopDragging])
  const adjustZoom = (direction: number) => changeZoom(Math.round((metrics.current.scale + direction * .25) * 10000) / 10000)

  useEffect(() => {
    const element = viewport.current
    if (!element || !enabled) return
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || !Number.isFinite(event.deltaY)) return
      // 使用非被动监听，仅拦截查看区域内的缩放，避免触发页面滚动或浏览器缩放。
      event.preventDefault(); event.stopPropagation()
      const current = metrics.current
      const rect = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.bounds.height : 1)
      changeZoom(current.scale * Math.exp(-Math.max(-240, Math.min(240, delta)) * .002), {
        x: event.clientX - rect.left - element.clientLeft - current.bounds.width / 2,
        y: event.clientY - rect.top - element.clientTop - current.bounds.height / 2,
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [enabled, changeZoom])

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!canPan || event.button !== 0 || !event.isPrimary || gesture.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    gesture.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, offset: metrics.current.offset }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current
    const current = metrics.current
    if (!drag || drag.pointer !== event.pointerId || !current.size || !enabled) return
    event.preventDefault()
    const offset = limitOffset({ x: drag.offset.x + event.clientX - drag.start.x, y: drag.offset.y + event.clientY - drag.start.y }, current.size, current.bounds, current.scale)
    metrics.current = { ...current, offset }
    setView({ zoom: current.zoom, ...offset })
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointer === event.pointerId) stopDragging()
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return
    const direction = { ArrowLeft: { x: 1, y: 0 }, ArrowRight: { x: -1, y: 0 }, ArrowUp: { x: 0, y: 1 }, ArrowDown: { x: 0, y: -1 } }[event.key]
    if (['+', '=', '-', '0', '1'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === '0') changeZoom('fit')
      else if (event.key === '1') changeZoom(1)
      else adjustZoom(event.key === '-' ? -1 : 1)
    } else if (direction && canPan && size) {
      event.preventDefault(); event.stopPropagation(); stopDragging()
      const current = metrics.current
      const distance = event.shiftKey ? 120 : 40
      const offset = limitOffset({ x: current.offset.x + direction.x * distance, y: current.offset.y + direction.y * distance }, size, current.bounds, current.scale)
      metrics.current = { ...current, offset }
      setView({ zoom: current.zoom, ...offset })
    }
  }
  return {
    viewport, zoom: view.zoom, scale, offset, dragging, canPan, canZoomIn: scale < maximum, canZoomOut: scale > minimum,
    adjustZoom, changeZoom, stopPanning: stopDragging,
    handlers: { onPointerDown: start, onPointerMove: move, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish,
      onBlur: stopDragging, onKeyDown: keyDown, onDoubleClick: () => { if (enabled) changeZoom(metrics.current.zoom === 1 ? 'fit' : 1) } },
  }
}
