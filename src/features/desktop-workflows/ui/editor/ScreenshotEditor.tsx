import { hostDesktopTargetKey, type HostDesktopSource } from '#common/contracts'
import { Alert, Button, Select, Spin, Tooltip } from 'antd'
import { ImagePlus, Monitor, RefreshCw, ScanSearch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Located, OCRObservation, OCRSpan, Point, Region, Snapshot, Step } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway, WorkflowSession } from '../../model/workspace/types'
import { blankImage, setStepImage, stepImage, type ImageSlot } from '../../model/images'
import { workflowError } from '../../model/messages'
import { isTargetAvailable, sessionTarget, type WorkflowTarget } from '../../model/target'
import styles from './ScreenshotEditor.module.scss'
import { PreviewModeControl, type PreviewMode } from './PreviewModeControl'
import { ScreenshotCanvas } from './ScreenshotCanvas'
import { ScreenshotTemplatePreview } from './ScreenshotTemplatePreview'
import type { AnalysisTransfer } from '../analysis/WorkflowAnalysis'
import { stepOCR, setStepOCR } from '../../model/ocr'
import { useOCRPreview } from './useOCRPreview'
import { OCRPreviewPanel } from './OCRPreviewPanel'
import { OCROverlay } from './OCROverlay'
import { OCRScopeControl } from './OCRScopeControl'

interface Props { hostSources?: HostDesktopSource[]; slot?: ImageSlot; onSlotChange?: (slot: ImageSlot) => void; analysisTransfer?: AnalysisTransfer; onTransferApplied?: () => void; enabled?: boolean; target: WorkflowTarget; onTargetChange: (target: WorkflowTarget) => void; gateway: WorkflowMediaGateway; sessions: WorkflowSession[]; step?: Step; onChange: (id: string, edit: (step: Step) => Step) => void; onMediaTask?: (task: Promise<unknown>) => void }

export function ScreenshotEditor({ hostSources = [], slot: externalSlot, onSlotChange, analysisTransfer, onTransferApplied, target: desktopTarget, onTargetChange, gateway, sessions, step, onChange, onMediaTask, enabled = true }: Props) {
  const { t } = useTranslation()
  const session = desktopTarget.mode === 'session' ? desktopTarget.id : undefined
  const [preview, setPreview] = useState<string>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [url, setURL] = useState<string>()
  const [mode, setMode] = useState<{ context: string; value: PreviewMode }>()
  const [editingOCR, setEditingOCR] = useState<string>()
  const [localSlot, setLocalSlot] = useState<ImageSlot>('target')
  const slot = externalSlot ?? localSlot
  const setSlot = (value: ImageSlot) => { setLocalSlot(value); onSlotChange?.(value) }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [matched, setMatched] = useState<Located>()
  const [ocrSelection, setOCRSelection] = useState<{ observation: OCRObservation; id: number }>()
  const [previewRevision, setPreviewRevision] = useState(0)
  const request = useRef<AbortController | undefined>(undefined)
  const working = useRef(false)
  const epoch = useRef(0)
  const selectionVersion = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const host = desktopTarget.mode === 'host' && isTargetAvailable(desktopTarget, sessions, [], hostSources) ? desktopTarget.host : undefined
  const generation = isTargetAvailable(desktopTarget, sessions) ? desktopTarget.connectionGeneration : undefined
  const activeSlot: ImageSlot = step?.kind.startsWith('image.') || step?.kind.startsWith('ocr.') || step?.kind === 'if' ? 'image' : step?.kind === 'pointer.drag' ? slot : 'target'
  const target = step && stepImage(step, activeSlot)
  const ocrQuery = step && stepOCR(step,activeSlot)
  const ocrBound = !!step?.bindings?.[activeSlot === 'image' ? 'ocr_text' : activeSlot === 'target' ? 'target_ocr_text' : 'end_target_ocr_text']
  const pointTarget = step?.[activeSlot === 'end_target' ? 'end_target' : 'target']
  const selectable = !!step && (step.kind.startsWith('pointer.') || step.kind.startsWith('image.') || step.kind.startsWith('ocr.') || step.kind === 'if')
  // 手动切换仅针对当前步骤和目标，优先还原模板来源，再还原查找区域。
  const modeContext = JSON.stringify([step?.id, step?.kind, activeSlot, pointTarget?.kind])
  const defaultMode: PreviewMode = ocrQuery ? 'region' : target?.template_source ? 'template' : target?.region ? 'region' : step?.kind.startsWith('pointer.') && pointTarget?.kind !== 'image' ? 'point' : 'template'
  if (mode && mode.context !== modeContext) setMode(undefined)
  const selectionMode = ocrQuery ? 'region' : mode?.context === modeContext ? mode.value : defaultMode
  const scopeContext = JSON.stringify([modeContext, preview, ocrQuery?.region, ocrQuery?.reference_width, ocrQuery?.reference_height])
  if (editingOCR && (editingOCR !== scopeContext || !ocrQuery)) setEditingOCR(undefined)
  const ocrEditing = !!ocrQuery && editingOCR === scopeContext

  useEffect(() => { ++selectionVersion.current }, [step?.id, activeSlot, snapshot])
  useEffect(() => {
    if (!analysisTransfer || analysisTransfer.stepID !== step?.id || analysisTransfer.slot !== activeSlot) return
    request.current?.abort()
    setSnapshot(analysisTransfer.snapshot); setMatched(undefined); setBusy(false)
    onTransferApplied?.()
  }, [analysisTransfer, activeSlot, step?.id, onTransferApplied])

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
    if (!enabled || (!host && (!session || !generation))) { setBusy(false); return () => { closed = true; epoch.current = version + 1; request.current?.abort(); controller.abort() } }
    setBusy(true)
    void (host ? gateway.openPreview('', 0, host) : gateway.openPreview(session!, generation!)).then(async (value) => {
      id = value.id
      if (closed) return
      setPreview(id)
      const shot = await gateway.capture(id, controller.signal)
      if (!closed && !controller.signal.aborted) setSnapshot(shot)
    }).catch((reason) => { if (!closed && !controller.signal.aborted) setError(reason) }).finally(() => {
      if (!closed) setBusy(false)
      else close()
    })
    return () => { closed = true; epoch.current = version + 1; request.current?.abort(); controller.abort(); close() }
  }, [enabled, gateway, session, generation, host, previewRevision])

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
  const ocr = useOCRPreview(gateway,preview,`${step?.id}:${activeSlot}`,ocrQuery,value => {setSnapshot(value);setMatched(undefined)})
  const currentOCR = !ocrEditing && ocr.value?.image === snapshot?.blob ? ocr.value : undefined
  // 列表和覆盖层使用同一组服务端匹配结果，保留原始编号与完整观察统计。
  const ocrSpans = currentOCR?.observation.spans.filter(span => span.matched) ?? []
  const selectedOCR = ocrSelection?.observation === currentOCR?.observation ? ocrSelection?.id : undefined
  useEffect(() => { if (!currentOCR) setOCRSelection(undefined) }, [currentOCR])
  const selectOCR = (span: OCRSpan) => {
    if (!currentOCR || busy || !step || !ocrQuery) return
    setOCRSelection({ observation: currentOCR.observation, id: span.id })
    if (ocrBound) return
    ocr.retainText(span.text)
    onChange(step.id, existing => {
      const query = stepOCR(existing, activeSlot)
      const binding = activeSlot === 'image' ? 'ocr_text' : activeSlot === 'target' ? 'target_ocr_text' : 'end_target_ocr_text'
      return query && !existing.bindings?.[binding] ? setStepOCR(existing, activeSlot, { ...query, text: span.text }) : existing
    })
  }
  const applySelection = async (region: Region, image?: HTMLImageElement, kind: PreviewMode = selectionMode) => {
    if (!step || !selectable || !snapshot || busy) return false
    const meta = snapshot.metadata
    if (kind === 'region') {
      if (ocrQuery) {
        if (!ocrEditing) return false
        onChange(step.id,existing => setStepOCR(existing,activeSlot,{...ocrQuery,region,reference_width:meta.desktop_width,reference_height:meta.desktop_height}))
        setEditingOCR(undefined)
        return true
      }
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
  const sameFrame = matched && snapshot && matched.capture.metadata.frame_sequence === snapshot.metadata.frame_sequence && matched.capture.metadata.display_epoch === snapshot.metadata.display_epoch
  // Core 在参考桌面尺寸变化后拒绝旧坐标；画面中也不能将旧选区伪装成当前坐标。
  const referenceMatches = (value?: { reference_width?: number; reference_height?: number }) => !!snapshot && value?.reference_width === snapshot.metadata.desktop_width && value.reference_height === snapshot.metadata.desktop_height
  const source = selectionMode === 'template' ? target?.template_source : selectionMode === 'region' ? ocrQuery ?? target : undefined
  const region = referenceMatches(source) ? source?.region : undefined
  const validRegion = region && snapshot && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 && region.x + region.width <= snapshot.metadata.width && region.y + region.height <= snapshot.metadata.height ? region : undefined
  const point = pointTarget?.kind === 'point' && referenceMatches(pointTarget) && pointTarget.x != null && pointTarget.y != null ? { x: pointTarget.x, y: pointTarget.y } : undefined
  const staleOCRScope = !!(snapshot && ocrQuery?.region && !validRegion)
  const canvasKey = [url, step?.id, activeSlot, selectionMode, ocrEditing].join(':')
  return <section data-tour="automation-preview" data-analysis={!!currentOCR} className={styles['screen-panel']} aria-label={t('desktopWorkflow.screen')}>
    <header className={styles['screen-toolbar']}>
      <Monitor size={16} className={styles['screen-icon']} />
      <Select aria-label={t('desktopWorkflow.selectSession')} className={styles['session-select']} allowClear placeholder={t('desktopWorkflow.selectSession')} value={host ? hostDesktopTargetKey(host) : session || undefined} options={[...hostSources.map(source => ({ value: hostDesktopTargetKey(source.target), label: `${t('hostDesktop.localDesktop')} · ${source.name}` })), ...sessions.filter((item) => item.connection_generation > 0 && !['failed', 'stopping'].includes(item.status)).map((item) => ({ value: item.id, label: `${item.profile_name} · ${item.protocol.toUpperCase()} · ${item.id.slice(-8)}` }))]} onSelect={(value) => { const source = hostSources.find(source => hostDesktopTargetKey(source.target) === value); onTargetChange(source ? { mode: 'host', id: value, host: source.target } : sessionTarget(sessions, value)) }} onClear={() => onTargetChange({ mode: 'session' })} />
      <Tooltip title={t('desktopWorkflow.refresh')}><Button type="text" aria-label={t('desktopWorkflow.refresh')} icon={<RefreshCw size={15} />} disabled={!preview || busy} onClick={() => { void perform(async (signal) => { const shot = await gateway.capture(preview!, signal); if (!signal.aborted) { setSnapshot(shot); setMatched(undefined) } }) }} /></Tooltip>
      {ocrQuery && <Button size="small" disabled={!preview || busy || ocrBound || ocrEditing || staleOCRScope} onClick={() => {void perform(ocr.test)}}>{t('desktopWorkflow.ocr.test')}</Button>}
    </header>
    {session && !generation && <Alert type="warning" title={t('desktopWorkflow.targetUnavailable')} />}
    {error != null && <Alert type="error" title={workflowError(error, t)} closable onClose={() => setError(undefined)} action={<Button size="small" disabled={busy || !session} onClick={() => setPreviewRevision((v) => v + 1)}>{t('desktopWorkflow.refresh')}</Button>} />}
    <div className={styles['screen-tools']}>
      {step?.kind === 'pointer.drag' && <Select aria-label={t('desktopWorkflow.target')} value={slot} options={['target', 'end_target'].map((value) => ({ value, label: t(`desktopWorkflow.${value === 'target' ? 'target' : 'endTarget'}`) }))} onChange={setSlot} />}
      {ocrQuery ? <OCRScopeControl region={ocrQuery.region} editing={ocrEditing} stale={staleOCRScope} disabled={busy} canEdit={!!snapshot}
        onEdit={() => setEditingOCR(scopeContext)} onCancel={() => setEditingOCR(undefined)}
        onClear={() => { if (step) onChange(step.id, existing => setStepOCR(existing, activeSlot, { ...ocrQuery, region: undefined, reference_width: undefined, reference_height: undefined })); setEditingOCR(undefined) }} />
        : <PreviewModeControl disabled={!selectable || busy} value={selectionMode} pointDisabled={!step?.kind.startsWith('pointer.')} onChange={value => setMode({ context: modeContext, value })} />}
      {!ocrQuery && <div className={styles['tool-actions']}>
      {target?.asset_id && <ScreenshotTemplatePreview key={target.asset_id} assetID={target.asset_id} gateway={gateway} />}
      <Tooltip title={t('desktopWorkflow.importTemplate')}><Button type="text" size="small" aria-label={t('desktopWorkflow.importTemplate')} icon={<ImagePlus size={15} />} disabled={!selectable || busy} onClick={() => fileInput.current?.click()} /></Tooltip>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
      <Tooltip title={t('desktopWorkflow.testMatch')}><Button type="text" size="small" aria-label={t('desktopWorkflow.testMatch')} icon={<ScanSearch size={15} />} disabled={!preview || !target?.asset_id || busy} onClick={() => { void perform(async (signal) => { const value = await gateway.match(preview!, target!, signal); if (!signal.aborted) { setMatched(value); setSnapshot({ metadata: value.capture.metadata, blob: value.image }) } }) }} /></Tooltip>
      {matched && <Tooltip title={<>{matched.result.candidates.map((c, i) => <div key={i}>{c.x}, {c.y} ({c.score.toFixed(3)})</div>)}{!sameFrame && <div>{t('desktopWorkflow.frameChanged')}</div>}</>}>
        <span className={styles['match-status']} role="status">{t(`desktopWorkflow.match.${matched.result.state}`)}</span>
      </Tooltip>}
      </div>}
    </div>
    {url && snapshot ? <ScreenshotCanvas key={canvasKey} url={url} size={snapshot.metadata} mode={selectionMode} editing={!ocrQuery || ocrEditing} disabled={!selectable || busy} busy={busy}
      initialRegion={validRegion} point={point} matches={sameFrame ? matched.result.candidates : undefined} onPoint={selectPoint} onApply={applySelection}
      overlay={currentOCR ? <OCROverlay spans={ocrSpans} selected={selectedOCR} disabled={busy} onSelect={selectOCR} width={currentOCR.observation.width} height={currentOCR.observation.height} /> : undefined}
      emptyHint={ocrEditing ? t('desktopWorkflow.ocr.drawScopeHint') : selectionMode === 'template' && target?.asset_id && !target.template_source ? t('desktopWorkflow.selection.templateSourceMissing') : undefined} />
      : <div className={styles['canvas-scroll']}>{busy && <Spin size="small" />}<div className={styles['screen-empty']}><span><Monitor size={30} strokeWidth={1.2} /></span><strong>{t('desktopWorkflow.screenPreview')}</strong><p>{t('desktopWorkflow.previewHint')}</p></div></div>}
    {currentOCR && <OCRPreviewPanel observation={currentOCR.observation} spans={ocrSpans} selected={selectedOCR} disabled={busy} bound={ocrBound} onSelect={selectOCR} />}
  </section>
}
