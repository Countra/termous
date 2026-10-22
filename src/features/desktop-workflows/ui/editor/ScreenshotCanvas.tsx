import { Button, Spin, Tooltip } from 'antd'
import { Check, Crosshair, Move, RotateCcw } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Candidate, Point, Region } from '#entities/desktop-workflow'
import { useImageViewport } from '#shared/ui'
import { resizeHandles, sameSelection, type ImageSize } from '../../model/selection'
import type { PreviewMode } from './PreviewModeControl'
import { ScreenshotCanvasToolbar } from './ScreenshotCanvasToolbar'
import { useScreenshotSelection } from './useScreenshotSelection'
import styles from './ScreenshotCanvas.module.scss'

interface Props {
  url: string; size: ImageSize; mode: PreviewMode; disabled: boolean; busy: boolean
  initialRegion?: Region; point?: Point; matches?: Candidate[]; emptyHint?: string
  overlay?: ReactNode
  onPoint: (point: Point) => void
  onApply: (region: Region, image: HTMLImageElement) => Promise<boolean>
}

export function ScreenshotCanvas({ url, size, mode, disabled, busy, initialRegion, point, matches, emptyHint, overlay, onPoint, onApply }: Props) {
  const { t } = useTranslation()
  const [ready, setReady] = useState(false)
  const [control, setControl] = useState(false)
  const view = useImageViewport(size, true)
  const stopPanning = view.stopPanning
  const editor = useScreenshotSelection({ size, mode, disabled: disabled || !ready, initialRegion, onPoint })
  const { canvas, image, selection, applied, dragging, cancel } = editor
  useEffect(() => { cancel() }, [view.zoom, cancel])
  useEffect(() => {
    const release = () => setControl(false)
    const keyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Control') { release(); stopPanning() }
    }
    window.addEventListener('blur', release); window.addEventListener('keyup', keyUp)
    return () => { window.removeEventListener('blur', release); window.removeEventListener('keyup', keyUp) }
  }, [stopPanning])
  const pan = (event: PointerEvent<HTMLDivElement>) => {
    setControl(event.ctrlKey)
    if (!event.isPrimary || event.button !== 0 || !event.ctrlKey) return
    // Ctrl 拖动在捕获阶段统一交给视图，避免选框或调整柄抢占平移手势。
    event.preventDefault(); event.stopPropagation()
    cancel()
    if (ready && !busy) view.handlers.onPointerDown(event)
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]')) return
    if (event.nativeEvent.isComposing) return
    setControl(event.ctrlKey)
    if (event.key === 'Escape') stopPanning()
    editor.keyDown(event)
    if (!event.defaultPrevented && !dragging) view.handlers.onKeyDown(event)
  }
  const boxStyle = (box: Region) => ({ left: `${box.x * 100 / size.width}%`, top: `${box.y * 100 / size.height}%`, width: `${box.width * 100 / size.width}%`, height: `${box.height * 100 / size.height}%` })
  const changed = selection && !sameSelection(selection, applied)
  const recapture = mode === 'template' && !changed

  return <div className={styles.root} data-analysis={!!overlay} onKeyDown={keyDown} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setControl(false); cancel(); stopPanning() }
  }}>
    <div className={styles.stage}>
      {busy && <div className={styles.busy}><Spin size="small" /></div>}
      <div ref={view.viewport} className={styles.viewport} tabIndex={0} role="group" aria-label={t('desktopWorkflow.previewTools.viewport')}
        data-control={control} data-pannable={view.canPan} data-dragging={view.dragging}
        onPointerDownCapture={pan} onPointerMove={event => {
          setControl(event.ctrlKey)
          if (!event.ctrlKey) stopPanning()
          else view.handlers.onPointerMove(event)
        }} onPointerUp={view.handlers.onPointerUp}
        onPointerCancel={view.handlers.onPointerCancel} onLostPointerCapture={view.handlers.onLostPointerCapture}>
        <div ref={canvas} className={styles.canvas} style={{ width: size.width * view.scale, height: size.height * view.scale,
          transform: `translate(-50%, -50%) translate(${view.offset.x}px, ${view.offset.y}px)` }} data-disabled={disabled || !ready} data-dragging={dragging}
          tabIndex={disabled ? -1 : 0} role="group" aria-label={t('desktopWorkflow.selection.canvas')} {...editor.handlers}>
          <img ref={image} src={url} alt={t('desktopWorkflow.readonlyScreen')} draggable={false} onLoad={() => setReady(true)} />
          {ready && overlay}
          {mode !== 'point' && selection && <div className={styles.selection} style={boxStyle(selection)}>
            <button type="button" className={styles.move} aria-label={t('desktopWorkflow.selection.move')} disabled={disabled} onPointerDown={event => editor.start(event, 'move')} onKeyDown={event => editor.nudge(event, 'move')} />
            {resizeHandles.map(handle => <button key={handle} type="button" className={styles.handle} data-handle={handle} aria-label={t(`desktopWorkflow.selection.resize.${handle}`)} disabled={disabled}
              onPointerDown={event => editor.start(event, handle)} onKeyDown={event => editor.nudge(event, handle)} />)}
          </div>}
          {mode === 'point' && point && <span className={styles.point} style={{ left: `${(point.x + .5) * 100 / size.width}%`, top: `${(point.y + .5) * 100 / size.height}%` }}><Crosshair size={22} /></span>}
          {matches?.map((match, index) => <span key={index} className={styles.match} style={boxStyle(match)}><span>{match.score.toFixed(3)}</span></span>)}
        </div>
      </div>
    </div>
    <ScreenshotCanvasToolbar zoom={view.zoom} scale={view.scale} ready={ready && !busy} onZoom={view.changeZoom}
      selectionMode={mode !== 'point'} disabled={disabled || dragging} canUndo={editor.canUndo} canRedo={editor.canRedo} hasSelection={!!selection} onEdit={editor.edit} />
    {mode !== 'point' && <div className={styles.tools}>
      <div className={styles.measurement} aria-live="polite" aria-atomic="true">
        <Move size={13} />{selection ? <><span>X <b>{selection.x}</b></span><span>Y <b>{selection.y}</b></span><strong>{selection.width} × {selection.height}</strong></> : <span>{emptyHint ?? t('desktopWorkflow.selection.drawHint')}</span>}
      </div>
      {selection && <div className={styles.actions}>
        <Tooltip title={t('desktopWorkflow.selection.reset')}><Button type="text" size="small" icon={<RotateCcw size={14} />} aria-label={t('desktopWorkflow.selection.reset')} disabled={disabled || dragging} onClick={() => editor.edit('reset')} /></Tooltip>
        <Button size="small" type={changed ? 'primary' : 'default'} disabled={disabled || dragging || !changed && !recapture || !ready} icon={<Check size={13} />}
          onClick={async () => { canvas.current?.focus({ preventScroll: true }); if (image.current && await onApply(selection, image.current)) editor.setApplied(selection) }}>
          {t(`desktopWorkflow.selection.${changed ? mode === 'template' ? 'useTemplate' : 'useRegion' : recapture ? 'updateTemplate' : 'applied'}`)}
        </Button>
      </div>}
    </div>}
  </div>
}
