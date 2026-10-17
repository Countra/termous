import { Button, Spin, Tooltip } from 'antd'
import { Check, Crosshair, Move, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Candidate, Point, Region } from '#entities/desktop-workflow'
import { imagePoint, imageRegion } from '../../model/coordinates'
import { moveSelection, resizeHandles, resizeSelection, sameSelection, type ImageSize, type ResizeHandle } from '../../model/selection'
import type { PreviewMode } from './PreviewModeControl'
import styles from './ScreenshotCanvas.module.scss'

interface Props {
  url: string; size: ImageSize; zoom: string; mode: PreviewMode; disabled: boolean; busy: boolean
  initialRegion?: Region; point?: Point; matches?: Candidate[]
  onPoint: (point: Point) => void
  onApply: (region: Region, image: HTMLImageElement) => Promise<boolean>
}
interface Gesture { pointer: number; action: 'draw' | 'move' | ResizeHandle; start: Point; original?: Region }

export function ScreenshotCanvas({ url, size, zoom, mode, disabled, busy, initialRegion, point, matches, onPoint, onApply }: Props) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const gesture = useRef<Gesture | undefined>(undefined)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [selection, setSelection] = useState(initialRegion)
  const [applied, setApplied] = useState(initialRegion)
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    if (viewport.current) observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])

  const cancel = useCallback((event?: { pointerId: number }) => {
    const current = gesture.current
    if (!current || event && event.pointerId !== current.pointer) return
    gesture.current = undefined
    setSelection(current.original)
    setDragging(false)
    if (canvas.current?.hasPointerCapture(current.pointer)) canvas.current.releasePointerCapture(current.pointer)
  }, [])
  useEffect(() => { if (disabled) cancel() }, [disabled, cancel])
  useEffect(() => {
    const blur = () => cancel()
    window.addEventListener('blur', blur)
    window.addEventListener('resize', blur)
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('resize', blur) }
  }, [cancel])
  useEffect(() => { cancel() }, [zoom, cancel])

  const position = (event: PointerEvent<HTMLElement>) => {
    const rect = image.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return undefined
    return { x: (event.clientX - rect.left) * size.width / rect.width, y: (event.clientY - rect.top) * size.height / rect.height }
  }
  const pixel = (value: Point) => imagePoint(value, { left: 0, top: 0, ...size }, size)
  const start = (event: PointerEvent<HTMLElement>, action: Gesture['action']) => {
    if (disabled || !ready || event.button !== 0 || !event.isPrimary || gesture.current) return
    const value = position(event)
    if (!value) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    gesture.current = { pointer: event.pointerId, action, start: value, original: selection }
    canvas.current?.setPointerCapture(event.pointerId)
    if (mode !== 'point' && action === 'draw') setSelection(imageRegion(pixel(value), pixel(value)))
    setDragging(true)
  }
  const update = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    const value = position(event)
    if (!current || current.pointer !== event.pointerId || !value || disabled || mode === 'point') return undefined
    const delta = { x: value.x - current.start.x, y: value.y - current.start.y }
    const next = current.action === 'draw' ? imageRegion(pixel(current.start), pixel(value))
      : current.original ? current.action === 'move' ? moveSelection(current.original, delta, size) : resizeSelection(current.original, current.action, delta, size) : undefined
    setSelection(next)
    return next
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return
    if (disabled) { cancel(event); return }
    if (mode === 'point') { const value = position(event); if (value) onPoint(pixel(value)) }
    else update(event)
    gesture.current = undefined; setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const nudge = (event: KeyboardEvent<HTMLButtonElement>, action: 'move' | ResizeHandle) => {
    if (!selection || disabled || gesture.current) return
    const distance = event.shiftKey ? 10 : 1
    const direction = { ArrowLeft: { x: -distance, y: 0 }, ArrowRight: { x: distance, y: 0 }, ArrowUp: { x: 0, y: -distance }, ArrowDown: { x: 0, y: distance } }[event.key]
    if (!direction) return
    event.preventDefault(); event.stopPropagation()
    setSelection(action === 'move' ? moveSelection(selection, direction, size) : resizeSelection(selection, action, direction, size))
  }
  const boxStyle = (box: Region) => ({ left: `${box.x * 100 / size.width}%`, top: `${box.y * 100 / size.height}%`, width: `${box.width * 100 / size.width}%`, height: `${box.height * 100 / size.height}%` })
  const fitScale = viewportSize.width > 0 && viewportSize.height > 0 ? Math.min(1, viewportSize.width / size.width, viewportSize.height / size.height) : undefined
  const changed = selection && !sameSelection(selection, applied)

  return <div className={styles.root}>
    <div ref={viewport} className={styles.viewport}>
      {busy && <div className={styles.busy}><Spin size="small" /></div>}
      <div ref={canvas} className={styles.canvas} style={{ width: zoom === 'fit' ? fitScale == null ? '100%' : size.width * fitScale : size.width * Number(zoom), maxWidth: zoom === 'fit' ? size.width : undefined }} data-disabled={disabled || !ready} data-dragging={dragging}
        tabIndex={disabled ? -1 : 0} role="group" aria-label={t('desktopWorkflow.selection.canvas')}
        onPointerDown={event => start(event, 'draw')} onPointerMove={update} onPointerUp={finish}
        onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel() } }}>
        <img ref={image} src={url} alt={t('desktopWorkflow.readonlyScreen')} draggable={false} onLoad={() => setReady(true)} />
        {mode !== 'point' && selection && <div className={styles.selection} style={boxStyle(selection)}>
          <button type="button" className={styles.move} aria-label={t('desktopWorkflow.selection.move')} disabled={disabled} onPointerDown={event => start(event, 'move')} onKeyDown={event => nudge(event, 'move')} />
          {resizeHandles.map(handle => <button key={handle} type="button" className={styles.handle} data-handle={handle} aria-label={t(`desktopWorkflow.selection.resize.${handle}`)} disabled={disabled}
            onPointerDown={event => start(event, handle)} onKeyDown={event => nudge(event, handle)} />)}
        </div>}
        {mode === 'point' && point && <span className={styles.point} style={{ left: `${(point.x + .5) * 100 / size.width}%`, top: `${(point.y + .5) * 100 / size.height}%` }}><Crosshair size={22} /></span>}
        {matches?.map((match, index) => <span key={index} className={styles.match} style={boxStyle(match)}><span>{match.score.toFixed(3)}</span></span>)}
      </div>
    </div>
    {mode !== 'point' && <div className={styles.tools}>
      <div className={styles.measurement} aria-live="polite" aria-atomic="true">
        <Move size={13} />{selection ? <><span>X <b>{selection.x}</b></span><span>Y <b>{selection.y}</b></span><strong>{selection.width} × {selection.height}</strong></> : <span>{t('desktopWorkflow.selection.drawHint')}</span>}
      </div>
      {selection && <div className={styles.actions}>
        <Tooltip title={t('desktopWorkflow.selection.reset')}><Button type="text" size="small" icon={<X size={14} />} aria-label={t('desktopWorkflow.selection.reset')} disabled={disabled || dragging} onClick={() => { setSelection(initialRegion); setApplied(initialRegion) }} /></Tooltip>
        <Button size="small" type={changed ? 'primary' : 'default'} disabled={disabled || dragging || !changed || !ready} icon={<Check size={13} />}
          onClick={async () => { if (image.current && await onApply(selection, image.current)) setApplied(selection) }}>
          {t(`desktopWorkflow.selection.${changed ? mode === 'template' ? 'useTemplate' : 'useRegion' : 'applied'}`)}
        </Button>
      </div>}
    </div>}
  </div>
}
