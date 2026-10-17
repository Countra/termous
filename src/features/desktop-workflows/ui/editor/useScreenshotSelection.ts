import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Point, Region } from '#entities/desktop-workflow'
import { imagePoint, imageRegion } from '../../model/coordinates'
import { moveSelection, resizeSelection, sameSelection, type ImageSize, type ResizeHandle } from '../../model/selection'
import { initialSelectionHistory, selectionHistory } from '../../model/selectionHistory'
import type { PreviewMode } from './PreviewModeControl'

interface Gesture { pointer: number; action: 'draw' | 'move' | ResizeHandle; start: Point; rect: DOMRect; original?: Region }
interface Props { size: ImageSize; mode: PreviewMode; disabled: boolean; initialRegion?: Region; onPoint: (point: Point) => void }

export function useScreenshotSelection({ size, mode, disabled, initialRegion, onPoint }: Props) {
  const canvas = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const gesture = useRef<Gesture | undefined>(undefined)
  const [history, dispatch] = useReducer(selectionHistory, initialRegion, initialSelectionHistory)
  const [applied, setApplied] = useState(initialRegion)
  const [dragging, setDragging] = useState(false)
  const previousRegion = useRef(initialRegion)
  const selection = history.preview ? history.preview.value : history.present

  const cancel = useCallback((event?: { pointerId: number }) => {
    const current = gesture.current
    if (!current || event && event.pointerId !== current.pointer) return
    gesture.current = undefined
    dispatch({ type: 'cancel' }); setDragging(false)
    if (canvas.current?.hasPointerCapture(current.pointer)) canvas.current.releasePointerCapture(current.pointer)
  }, [])
  useEffect(() => { if (disabled) cancel() }, [disabled, cancel])
  useEffect(() => {
    const stop = () => cancel()
    window.addEventListener('blur', stop); window.addEventListener('resize', stop)
    return () => { window.removeEventListener('blur', stop); window.removeEventListener('resize', stop) }
  }, [cancel])
  useEffect(() => {
    if (sameSelection(previousRegion.current, initialRegion)) return
    previousRegion.current = initialRegion
    cancel(); setApplied(initialRegion)
    // 应用当前区域的回执不清空历史；外部配置变化才重新初始化选区。
    if (!sameSelection(history.present, initialRegion)) dispatch({ type: 'reset', value: initialRegion })
  }, [initialRegion, history.present, cancel])

  const position = (event: PointerEvent<HTMLElement>) => {
    // 手势期间固定显示坐标基准，避免窄布局中工具栏换行造成选区漂移。
    const rect = gesture.current?.rect ?? image.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return undefined
    return { x: (event.clientX - rect.left) * size.width / rect.width, y: (event.clientY - rect.top) * size.height / rect.height }
  }
  const pixel = (value: Point) => imagePoint(value, { left: 0, top: 0, ...size }, size)
  const start = (event: PointerEvent<HTMLElement>, action: Gesture['action']) => {
    if (disabled || event.button !== 0 || !event.isPrimary || gesture.current) return
    const rect = image.current?.getBoundingClientRect()
    const value = position(event)
    if (!value || !rect) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    gesture.current = { pointer: event.pointerId, action, start: value, rect, original: selection }
    canvas.current?.setPointerCapture(event.pointerId)
    if (mode !== 'point' && action === 'draw') dispatch({ type: 'preview', value: imageRegion(pixel(value), pixel(value)) })
    setDragging(true)
  }
  const update = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    const value = position(event)
    if (!current || current.pointer !== event.pointerId || !value || disabled || mode === 'point') return undefined
    const delta = { x: value.x - current.start.x, y: value.y - current.start.y }
    const next = current.action === 'draw' ? imageRegion(pixel(current.start), pixel(value))
      : current.original ? current.action === 'move' ? moveSelection(current.original, delta, size) : resizeSelection(current.original, current.action, delta, size) : undefined
    dispatch({ type: 'preview', value: next })
    return next
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return
    if (disabled) { cancel(event); return }
    if (mode === 'point') { const value = position(event); if (value) onPoint(pixel(value)) }
    else dispatch({ type: 'commit', value: update(event) })
    gesture.current = undefined; setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const nudge = (event: KeyboardEvent<HTMLButtonElement>, action: 'move' | ResizeHandle) => {
    if (!selection || disabled || gesture.current || event.ctrlKey || event.metaKey || event.altKey) return
    const distance = event.shiftKey ? 10 : 1
    const direction = { ArrowLeft: { x: -distance, y: 0 }, ArrowRight: { x: distance, y: 0 }, ArrowUp: { x: 0, y: -distance }, ArrowDown: { x: 0, y: distance } }[event.key]
    if (!direction) return
    event.preventDefault(); event.stopPropagation()
    dispatch({ type: 'commit', value: action === 'move' ? moveSelection(selection, direction, size) : resizeSelection(selection, action, direction, size) })
  }
  const edit = (type: 'undo' | 'redo' | 'delete' | 'reset') => {
    if (disabled || gesture.current || mode === 'point') return
    canvas.current?.focus({ preventScroll: true })
    if (type === 'delete' || type === 'reset') dispatch({ type: 'commit', value: type === 'reset' ? initialRegion : undefined })
    else dispatch({ type })
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); return }
    if (disabled || mode === 'point' || event.altKey || event.nativeEvent.isComposing) return
    const key = event.key.toLowerCase()
    const command = event.ctrlKey || event.metaKey
    const action = command && key === 'z' ? event.shiftKey ? 'redo' : 'undo'
      : command && key === 'y' ? 'redo' : !command && key === 'delete' ? 'delete' : undefined
    if (!action) return
    event.preventDefault(); event.stopPropagation()
    if (gesture.current) cancel()
    else edit(action)
  }
  return {
    canvas, image, selection, applied, setApplied, dragging, cancel, start, nudge, edit, keyDown,
    canUndo: history.past.length > 0, canRedo: history.future.length > 0,
    handlers: { onPointerDown: (event: PointerEvent<HTMLDivElement>) => start(event, 'draw'), onPointerMove: update, onPointerUp: finish, onPointerCancel: cancel, onLostPointerCapture: cancel },
  }
}
