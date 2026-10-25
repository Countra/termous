import { Alert, Button, Dropdown, Empty, Tooltip } from 'antd'
import { ChevronDown, Crosshair, Eye, EyeOff, Maximize, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGeometry, AnalysisImage, AnalysisLabelMode, AnalysisPresentation } from '#common/contracts'
import { contextActionMenuPopupClassName, useImageViewport } from '#shared/ui'
import { useCanvasSelection } from '../../model/useCanvasSelection'
import { AnalysisCandidates } from './AnalysisCandidates'
import { AnalysisOverlay } from '../AnalysisOverlay'
import styles from './Explorer.module.scss'

export function AnalysisCanvas({ blob, image, geometry, selected, onSelect, crop, preference, onViewChange, disabled = false, contextKey = '' }: {
  disabled?: boolean; contextKey?: string
  blob?: Blob; image?: AnalysisImage; geometry: AnalysisGeometry[]; selected?: number; onSelect: (id: number) => void; crop?: [number, number, number, number]
  preference?: AnalysisPresentation['view']; onViewChange?: (view: NonNullable<AnalysisPresentation['view']>) => void
}) {
  const { t } = useTranslation()
  const [url, setURL] = useState<string>()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [visible, setVisible] = useState(preference?.boxes ?? true)
  const [labelMode, setLabelMode] = useState<AnalysisLabelMode>(preference?.labelMode ?? 'auto')
  const view = useImageViewport(image, ready, preference?.zoom)
  const selection = useCanvasSelection(geometry, selected, disabled || !ready || !visible, view.scale, contextKey, view.viewport, onSelect)
  const preferenceCallback = useRef(onViewChange); preferenceCallback.current = onViewChange
  useEffect(() => {
    if (!ready || preference?.zoom === view.zoom && preference.boxes === visible && (preference.labelMode ?? 'auto') === labelMode) return
    const timer = setTimeout(() => preferenceCallback.current?.({ zoom: view.zoom, boxes: visible, labelMode }), 200)
    return () => clearTimeout(timer)
  }, [ready, view.zoom, visible, preference?.zoom, preference?.boxes, preference?.labelMode, labelMode])
  useEffect(() => {
    setReady(false); setFailed(false)
    if (!blob) { setURL(undefined); return }
    const value = URL.createObjectURL(blob); setURL(value)
    return () => URL.revokeObjectURL(value)
  }, [blob, revision])
  const chosen = geometry.find(item => item.id === selected)
  return <section className={styles.canvas} aria-label={t('desktopWorkflow.analysisWorkspace.canvas')}>
    {failed && <Alert type="error" title={t('imagePreview.failed')} action={<Button onClick={() => setRevision(value => value + 1)}>{t('app.retry')}</Button>} />}
    <div className={styles.viewport} ref={view.viewport} tabIndex={0} {...view.handlers} {...selection.handlers}>
      {url && image ? <div className={styles.image} ref={selection.image} style={{ width: image.width * view.scale, height: image.height * view.scale,
        transform: `translate(-50%, -50%) translate(${view.offset.x}px, ${view.offset.y}px)` }}>
        <img src={url} alt={t('analysisCenter.originalImage')} draggable={false} onLoad={() => setReady(true)} onError={() => { setReady(false); setFailed(true) }} />
        {ready && visible && <AnalysisOverlay elements={geometry} image={image} selected={selected} hovered={selection.hovered} scale={view.scale} mode={labelMode} onSelect={onSelect} onHover={selection.setHovered} disabled={disabled} />}
        {crop && <div className={styles.crop} style={{ left: `${crop[0] / image.width * 100}%`, top: `${crop[1] / image.height * 100}%`,
          width: `${(crop[2] - crop[0]) / image.width * 100}%`, height: `${(crop[3] - crop[1]) / image.height * 100}%` }} />}
      </div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('desktopWorkflow.analysisWorkspace.emptyImage')} />}
      {selection.menu && <AnalysisCandidates menu={selection.menu} selected={selected} onSelect={onSelect} onHover={selection.setHovered} onClose={selection.close} />}
    </div>
    <div className={styles['canvas-tools']}>
      <Tooltip title={t('desktopWorkflow.analysisWorkspace.fit')}><Button icon={<Maximize size={15} />} disabled={!ready} onClick={() => view.changeZoom('fit')} aria-label={t('desktopWorkflow.analysisWorkspace.fit')} /></Tooltip>
      <Button disabled={!ready} onClick={() => view.changeZoom(1)}>1:1</Button>
      <Button icon={<Minus size={15} />} disabled={!ready || !view.canZoomOut} onClick={() => view.adjustZoom(-1)} aria-label={t('imagePreview.zoomOut')} />
      <span>{Math.round(view.scale * 100)}%</span>
      <Button icon={<Plus size={15} />} disabled={!ready || !view.canZoomIn} onClick={() => view.adjustZoom(1)} aria-label={t('imagePreview.zoomIn')} />
      <Tooltip title={t('desktopWorkflow.analysisWorkspace.locate')}><Button icon={<Crosshair size={15} />} disabled={!ready || !chosen} onClick={() => chosen && view.reveal(chosen.bbox_xyxy)} aria-label={t('desktopWorkflow.analysisWorkspace.locate')} /></Tooltip>
      <Button icon={visible ? <Eye size={15} /> : <EyeOff size={15} />} disabled={!ready} onClick={() => setVisible(!visible)} aria-label={t('desktopWorkflow.analysisWorkspace.boxes')} aria-pressed={visible} />
      <Dropdown trigger={['click']} classNames={{ root: contextActionMenuPopupClassName }} menu={{ rootClassName: contextActionMenuPopupClassName, selectable: true, selectedKeys: [labelMode], onClick: ({ key }) => setLabelMode(key as AnalysisLabelMode),
        items: (['auto', 'all', 'none'] as const).map(key => ({ key, label: t(`desktopWorkflow.analysisWorkspace.labels.${key}`) })) }}>
        <Button disabled={!ready || !visible} icon={<ChevronDown size={12} />} iconPlacement="end">{t(`desktopWorkflow.analysisWorkspace.labels.${labelMode}`)}</Button>
      </Dropdown>
      <small>{image ? `${image.width} × ${image.height}` : ''}</small>
    </div>
  </section>
}
