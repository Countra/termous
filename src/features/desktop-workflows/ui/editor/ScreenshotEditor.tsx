import { Alert, Button, Select, Spin, Tooltip } from 'antd'
import { ImagePlus, LockKeyhole, Monitor, RefreshCw, ScanSearch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisElement, Located, Point, Region, Snapshot, Step } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway, WorkflowSession } from '../../model/workspace/types'
import { blankImage, setStepImage, stepImage, type ImageSlot } from '../../model/images'
import { workflowError } from '../../model/messages'
import { isTargetAvailable, sessionTarget, type WorkflowTarget } from '../../model/target'
import styles from './ScreenshotEditor.module.scss'
import { PreviewModeControl, type PreviewMode } from './PreviewModeControl'
import { ScreenshotCanvas } from './ScreenshotCanvas'
import { ScreenshotTemplatePreview } from './ScreenshotTemplatePreview'
import { AnalysisOverlay } from './AnalysisOverlay'
import { AnalysisPanel } from './AnalysisPanel'
import { useScreenAnalysis } from './useScreenAnalysis'
import { analysisRegion } from '../../model/analysis'
import { AnalysisRuntimeStatus } from './AnalysisRuntimeStatus'

interface Props { enabled?: boolean; target: WorkflowTarget; onTargetChange: (target: WorkflowTarget) => void; gateway: WorkflowMediaGateway; sessions: WorkflowSession[]; step?: Step; onChange: (id: string, edit: (step: Step) => Step) => void; onMediaTask?: (task: Promise<unknown>) => void }

export function ScreenshotEditor({ target: desktopTarget, onTargetChange, gateway, sessions, step, onChange, onMediaTask, enabled = true }: Props) {
  const { t } = useTranslation()
  const session = desktopTarget.mode === 'session' ? desktopTarget.id : undefined
  const [preview, setPreview] = useState<string>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [url, setURL] = useState<string>()
  const [mode, setMode] = useState<{ context: string; value: PreviewMode }>()
  const [slot, setSlot] = useState<ImageSlot>('target')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [matched, setMatched] = useState<Located>()
  const [previewRevision, setPreviewRevision] = useState(0)
  const request = useRef<AbortController | undefined>(undefined)
  const working = useRef(false)
  const epoch = useRef(0)
  const selectionVersion = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const generation = isTargetAvailable(desktopTarget, sessions) ? desktopTarget.connectionGeneration : undefined
  const activeSlot: ImageSlot = step?.kind.startsWith('image.') || step?.kind === 'if' ? 'image' : step?.kind === 'pointer.drag' ? slot : 'target'
  const target = step && stepImage(step, activeSlot)
  const pointTarget = step?.[activeSlot === 'end_target' ? 'end_target' : 'target']
  const selectable = !!step && (step.kind.startsWith('pointer.') || step.kind.startsWith('image.') || step.kind === 'if')
  // 手动切换仅针对当前步骤和目标，优先还原模板来源，再还原查找区域。
  const modeContext = JSON.stringify([step?.id, step?.kind, activeSlot, pointTarget?.kind])
  const defaultMode: PreviewMode = target?.template_source ? 'template' : target?.region ? 'region' : step?.kind.startsWith('pointer.') && pointTarget?.kind !== 'image' ? 'point' : 'template'
  if (mode && mode.context !== modeContext) setMode(undefined)
  const selectionMode = mode?.context === modeContext ? mode.value : defaultMode

  useEffect(() => { ++selectionVersion.current }, [step?.id, activeSlot, snapshot])

  useEffect(() => {
    let closed = false; let id: string | undefined
    const close = () => {
      if (!id) return
      const closing = id; id = undefined
      void gateway.closePreview(closing).catch(() => { console.warn('[termous:workflow] 截图观察清理失败，将由预览租约回收') })
    }
    const controller = new AbortController(); const version = ++epoch.current
    request.current?.abort(); request.current = controller
    working.current = false
    setPreview(undefined); setSnapshot(undefined); setMatched(undefined); setError(undefined)
    if (!enabled || !session || !generation) { setBusy(false); return () => { closed = true; epoch.current = version + 1; request.current?.abort(); controller.abort() } }
    setBusy(true)
    void gateway.openPreview(session, generation).then(async (value) => {
      id = value.id
      if (closed) return
      setPreview(id)
      const shot = await gateway.capture(id, controller.signal)
      if (!closed) setSnapshot(shot)
    }).catch((reason) => { if (!closed) setError(reason) }).finally(() => {
      if (!closed) setBusy(false)
      else close()
    })
    return () => { closed = true; epoch.current = version + 1; request.current?.abort(); controller.abort(); close() }
  }, [enabled, gateway, session, generation, previewRevision])

  useEffect(() => {
    if (!snapshot) { setURL(undefined); return }
    const value = URL.createObjectURL(snapshot.blob); setURL(value)
    return () => URL.revokeObjectURL(value)
  }, [snapshot])

  const perform = (work: (signal: AbortSignal) => Promise<void>) => {
    if (busy || working.current) return Promise.resolve(false)
    working.current = true
    const version = epoch.current; const controller = new AbortController()
    request.current?.abort(); request.current = controller; setBusy(true); setError(undefined)
    const task = (async () => {
      try { await work(controller.signal); return !controller.signal.aborted && version === epoch.current }
      catch (reason) { if (!controller.signal.aborted && version === epoch.current) setError(reason); return false }
      finally { if (version === epoch.current) { working.current = false; setBusy(false) } }
    })()
    // 窗口交接需等待裁剪编码、上传和草稿写入全部完成，不能只等待网络上传。
    onMediaTask?.(task)
    return task
  }
  const upload = (blob: Blob) => {
    if (!step || !selectable) return
    const savedStep = step; const savedSlot = activeSlot; const version = epoch.current
    void perform(async (signal) => {
      const asset = await gateway.upload(blob)
      if (!signal.aborted && version === epoch.current) onChange(savedStep.id, (existing) => setStepImage(existing, savedSlot, { ...(stepImage(existing, savedSlot) ?? blankImage()), asset_id: asset.id, anchor: undefined, template_source: undefined }))
    })
  }
  const selectPoint = (point: Point) => {
    if (!step || !snapshot || !selectable || busy) return
    const field = activeSlot === 'end_target' ? 'end_target' : 'target'
    const meta = snapshot.metadata
    onChange(step.id, (existing) => ({ ...existing, [field]: { kind: 'point', ...point, reference_width: meta.desktop_width, reference_height: meta.desktop_height } }))
  }
  const analysis = useScreenAnalysis(gateway, preview, perform, value => { setSnapshot(value); setMatched(undefined) })
  const applySelection = async (region: Region, image?: HTMLImageElement, kind: PreviewMode = selectionMode) => {
    if (!step || !selectable || !snapshot || busy) return false
    const meta = snapshot.metadata
    if (kind === 'region') {
      onChange(step.id, (existing) => setStepImage(existing, activeSlot, { ...(stepImage(existing, activeSlot) ?? blankImage()), region, reference_width: meta.desktop_width, reference_height: meta.desktop_height }))
      return true
    }
    const version = epoch.current; const selection = selectionVersion.current; const stepID = step.id; const selectedSlot = activeSlot
    return perform(async (signal) => {
      // 解码也属于媒体任务；切换步骤或画面后不能把旧区域应用到新上下文。
      let sourceImage = image
      if (!sourceImage) {
        if (!url) throw new Error(t('desktopWorkflow.cropFailed'))
        sourceImage = new Image(); sourceImage.src = url
        await sourceImage.decode()
      }
      if (signal.aborted || version !== epoch.current || selection !== selectionVersion.current) return
      const canvas = document.createElement('canvas'); canvas.width = region.width; canvas.height = region.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error(t('desktopWorkflow.cropFailed'))
      context.drawImage(sourceImage, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (signal.aborted || version !== epoch.current || selection !== selectionVersion.current) return
      if (!blob) throw new Error(t('desktopWorkflow.cropFailed'))
      const asset = await gateway.upload(blob)
      if (!signal.aborted && version === epoch.current && selection === selectionVersion.current) onChange(stepID, (existing) => setStepImage(existing, selectedSlot, { ...(stepImage(existing, selectedSlot) ?? blankImage()), asset_id: asset.id, anchor: undefined,
        template_source: { region, reference_width: meta.desktop_width, reference_height: meta.desktop_height } }))
    })
  }
  const applyElement = (kind: 'point' | 'template' | 'region', element: AnalysisElement) => {
    if (!snapshot || !url || busy) return
    if (kind === 'point') {
      selectPoint({ x: Math.min(snapshot.metadata.width - 1, Math.floor(element.center_xy[0])), y: Math.min(snapshot.metadata.height - 1, Math.floor(element.center_xy[1])) })
      return
    }
    void applySelection(analysisRegion(element, snapshot.metadata.width, snapshot.metadata.height), undefined, kind)
  }
  const sameFrame = matched && snapshot && matched.capture.metadata.frame_sequence === snapshot.metadata.frame_sequence && matched.capture.metadata.display_epoch === snapshot.metadata.display_epoch
  // Core 在参考桌面尺寸变化后拒绝旧坐标；画面中也不能将旧选区伪装成当前坐标。
  const referenceMatches = (value?: { reference_width?: number; reference_height?: number }) => !!snapshot && value?.reference_width === snapshot.metadata.desktop_width && value.reference_height === snapshot.metadata.desktop_height
  const source = selectionMode === 'template' ? target?.template_source : selectionMode === 'region' ? target : undefined
  const region = referenceMatches(source) ? source?.region : undefined
  const validRegion = region && snapshot && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.x + region.width <= snapshot.metadata.width && region.y + region.height <= snapshot.metadata.height ? region : undefined
  const point = pointTarget?.kind === 'point' && referenceMatches(pointTarget) && pointTarget.x != null && pointTarget.y != null ? { x: pointTarget.x, y: pointTarget.y } : undefined
  const canvasKey = [url, step?.id, activeSlot, selectionMode].join(':')
  return <section data-tour="automation-preview" data-analysis={!!analysis.analysis} className={styles['screen-panel']} aria-label={t('desktopWorkflow.screen')}>
    <header className={styles['screen-toolbar']}>
      <Monitor size={16} className={styles['screen-icon']} />
      <Select aria-label={t('desktopWorkflow.selectSession')} className={styles['session-select']} allowClear placeholder={t('desktopWorkflow.selectSession')} value={session || undefined} options={sessions.filter((item) => item.connection_generation > 0 && !['failed', 'stopping'].includes(item.status)).map((item) => ({ value: item.id, label: `${item.profile_name} · ${item.protocol.toUpperCase()} · ${item.id.slice(-8)}` }))} onSelect={(value) => onTargetChange(sessionTarget(sessions, value))} onClear={() => onTargetChange({ mode: 'session' })} />
      <Tooltip title={t('desktopWorkflow.refresh')}><Button type="text" aria-label={t('desktopWorkflow.refresh')} icon={<RefreshCw size={15} />} disabled={!preview || busy} onClick={() => { analysis.clear(); void perform(async (signal) => { const shot = await gateway.capture(preview!, signal); if (!signal.aborted) { setSnapshot(shot); setMatched(undefined) } }) }} /></Tooltip>
      <Button size="small" icon={<ScanSearch size={14} />} disabled={!preview || busy} onClick={analysis.analyze}>{t('desktopWorkflow.analysis.analyze')}</Button>
      <AnalysisRuntimeStatus gateway={gateway} active={enabled && !!preview} onError={setError} />
    </header>
    {session && !generation && <Alert type="warning" title={t('desktopWorkflow.targetUnavailable')} />}
    {error != null && <Alert type="error" title={workflowError(error, t)} closable onClose={() => setError(undefined)} action={<Button size="small" disabled={busy || !session} onClick={() => setPreviewRevision((v) => v + 1)}>{t('desktopWorkflow.refresh')}</Button>} />}
    <div className={styles['screen-tools']}>
      {analysis.analyzing && <Alert type="info" title={t('desktopWorkflow.analysis.loading')} action={<Button size="small" onClick={() => { request.current?.abort(); analysis.clear() }}>{t('desktopWorkflow.analysis.cancel')}</Button>} />}
      {step?.kind === 'pointer.drag' && <Select aria-label={t('desktopWorkflow.target')} value={slot} options={['target', 'end_target'].map((value) => ({ value, label: t(`desktopWorkflow.${value === 'target' ? 'target' : 'endTarget'}`) }))} onChange={setSlot} />}
      <PreviewModeControl disabled={!selectable || busy} value={selectionMode} pointDisabled={!step?.kind.startsWith('pointer.')} onChange={value => setMode({ context: modeContext, value })} />
      <div className={styles['tool-actions']}>
      <Tooltip title={t('desktopWorkflow.importTemplate')}><Button type="text" size="small" aria-label={t('desktopWorkflow.importTemplate')} icon={<ImagePlus size={15} />} disabled={!selectable || busy} onClick={() => fileInput.current?.click()} /></Tooltip>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
      <Tooltip title={t('desktopWorkflow.testMatch')}><Button type="text" size="small" aria-label={t('desktopWorkflow.testMatch')} icon={<ScanSearch size={15} />} disabled={!preview || !target?.asset_id || busy} onClick={() => { analysis.clear(); void perform(async (signal) => { const value = await gateway.match(preview!, target!, signal); if (!signal.aborted) { setMatched(value); setSnapshot({ metadata: value.capture.metadata, blob: value.image }) } }) }} /></Tooltip>
      </div>
    </div>
    {url && snapshot ? <ScreenshotCanvas key={canvasKey} url={url} size={snapshot.metadata} mode={selectionMode} disabled={!selectable || busy} busy={busy}
      initialRegion={validRegion} point={point} matches={sameFrame ? matched.result.candidates : undefined} onPoint={selectPoint} onApply={applySelection}
      overlay={analysis.analysis && <AnalysisOverlay elements={analysis.analysis.result.elements} selected={analysis.selected} hovered={analysis.hovered} disabled={busy} onSelect={analysis.setSelected} onHover={analysis.setHovered} />}
      emptyHint={selectionMode === 'template' && target?.asset_id && !target.template_source ? t('desktopWorkflow.selection.templateSourceMissing') : undefined} />
      : <div className={styles['canvas-scroll']}>{busy && <Spin size="small" />}<div className={styles['screen-empty']}><span><Monitor size={30} strokeWidth={1.2} /></span><strong>{t('desktopWorkflow.screenPreview')}</strong><p>{t('desktopWorkflow.previewHint')}</p></div></div>}
    {analysis.analysis && <AnalysisPanel analysis={analysis.analysis} selected={analysis.selected} hovered={analysis.hovered} busy={busy} canPoint={!!step?.kind.startsWith('pointer.')} canRegion={selectable}
      onSelect={analysis.setSelected} onHover={analysis.setHovered} onApply={applyElement} onExport={analysis.download} onError={setError} />}
    <footer className={styles['screen-footer']}>
      <span className={styles['readonly-badge']}><LockKeyhole size={12} />{t('desktopWorkflow.readonly')}</span>
      {target?.asset_id && <ScreenshotTemplatePreview key={target.asset_id} assetID={target.asset_id} gateway={gateway} />}
      <div className={styles.hint} role="status">{matched ? <>{t(`desktopWorkflow.match.${matched.result.state}`)}{matched.result.candidates.map((c, i) => <span key={i}> · {c.x}, {c.y} ({c.score.toFixed(3)})</span>)}{!sameFrame && <div>{t('desktopWorkflow.frameChanged')}</div>}</> : t('desktopWorkflow.readonlyHint')}</div>
    </footer>
  </section>
}
