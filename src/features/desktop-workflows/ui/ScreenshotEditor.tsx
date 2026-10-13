import { Alert, Button, Empty, Select, Segmented, Spin } from 'antd'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Located, Point, Region, Snapshot, Step, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { ImagePreview, ImageThumbnail, type ImagePreviewSource } from '#shared/ui'
import { imagePoint, imageRegion } from '../model/coordinates'
import { blankImage, setStepImage, stepImage, type ImageSlot } from '../model/images'
import { workflowError } from '../model/messages'
import styles from './WorkflowWorkspace.module.scss'

interface Props { gateway: WorkflowGateway; sessions: RemoteDesktopSession[]; step?: Step; onChange: (id: string, edit: (step: Step) => Step) => void }
type Mode = 'point' | 'template' | 'region'

export function ScreenshotEditor({ gateway, sessions, step, onChange }: Props) {
  const { t } = useTranslation()
  const [session, setSession] = useState('')
  const [preview, setPreview] = useState<string>()
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [url, setURL] = useState<string>()
  const [mode, setMode] = useState<Mode>('point')
  const [slot, setSlot] = useState<ImageSlot>('target')
  const [zoom, setZoom] = useState('fit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [selection, setSelection] = useState<Region>()
  const [matched, setMatched] = useState<Located>()
  const [large, setLarge] = useState<ImagePreviewSource>()
  const [previewRevision, setPreviewRevision] = useState(0)
  const drag = useRef<Point | undefined>(undefined)
  const image = useRef<HTMLImageElement>(null)
  const request = useRef<AbortController | undefined>(undefined)
  const working = useRef(false)
  const epoch = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const current = sessions.find((item) => item.id === session)
  const generation = current?.connection_generation
  const activeSlot: ImageSlot = step?.kind.startsWith('image.') || step?.kind === 'if' ? 'image' : step?.kind === 'pointer.drag' ? slot : 'target'
  const target = step && stepImage(step, activeSlot)
  const selectable = !!step && (step.kind.startsWith('pointer.') || step.kind.startsWith('image.') || step.kind === 'if')
  const selectionMode = mode === 'point' && !step?.kind.startsWith('pointer.') ? 'template' : mode

  useEffect(() => {
    let closed = false; let id: string | undefined
    const controller = new AbortController(); const version = ++epoch.current
    request.current?.abort(); request.current = controller
    working.current = false
    setPreview(undefined); setSnapshot(undefined); setMatched(undefined); setSelection(undefined); setError(undefined)
    if (!session || !generation) { setBusy(false); return () => { closed = true; epoch.current = version + 1; request.current?.abort(); controller.abort() } }
    setBusy(true)
    void gateway.openPreview(session, generation).then(async (value) => {
      id = value.id
      if (closed) return
      setPreview(id)
      const shot = await gateway.capture(id, controller.signal)
      if (!closed) setSnapshot(shot)
    }).catch((reason) => { if (!closed) setError(reason) }).finally(() => {
      if (!closed) setBusy(false)
      else if (id) void gateway.closePreview(id).catch(() => undefined)
    })
    return () => { closed = true; epoch.current = version + 1; request.current?.abort(); controller.abort(); if (id) void gateway.closePreview(id).catch(() => undefined) }
  }, [gateway, session, generation, previewRevision])

  useEffect(() => {
    if (!snapshot) { setURL(undefined); return }
    const value = URL.createObjectURL(snapshot.blob); setURL(value)
    return () => URL.revokeObjectURL(value)
  }, [snapshot])

  const perform = async (work: (signal: AbortSignal) => Promise<void>) => {
    if (busy || working.current) return
    working.current = true
    const version = epoch.current; const controller = new AbortController()
    request.current?.abort(); request.current = controller; setBusy(true); setError(undefined)
    try { await work(controller.signal) } catch (reason) { if (!controller.signal.aborted && version === epoch.current) setError(reason) }
    finally { if (version === epoch.current) { working.current = false; setBusy(false) } }
  }
  const upload = (blob: Blob) => {
    if (!step || !selectable) return
    const savedStep = step; const savedSlot = activeSlot; const version = epoch.current
    void perform(async (signal) => {
      const asset = await gateway.upload(blob)
      if (!signal.aborted && version === epoch.current) onChange(savedStep.id, (existing) => setStepImage(existing, savedSlot, { ...(stepImage(existing, savedSlot) ?? blankImage()), asset_id: asset.id, anchor: undefined }))
    })
  }
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const rect = image.current?.getBoundingClientRect()
    return rect && snapshot ? imagePoint({ x: event.clientX, y: event.clientY }, rect, snapshot.metadata) : undefined
  }
  const select = async (event: PointerEvent<HTMLDivElement>) => {
    const end = position(event); const start = drag.current; drag.current = undefined
    if (!step || !selectable || !snapshot || !end || !start || busy) return
    const meta = snapshot.metadata; const region = imageRegion(start, end)
    if (selectionMode === 'point') {
      const field = activeSlot === 'end_target' ? 'end_target' : 'target'
      onChange(step.id, (existing) => ({ ...existing, [field]: { kind: 'point', ...end, reference_width: meta.desktop_width, reference_height: meta.desktop_height } }))
      setSelection({ ...end, width: 1, height: 1 }); return
    }
    setSelection(region)
    if (selectionMode === 'region') {
      onChange(step.id, (existing) => setStepImage(existing, activeSlot, { ...(stepImage(existing, activeSlot) ?? blankImage()), region, reference_width: meta.desktop_width, reference_height: meta.desktop_height })); return
    }
    if (!image.current) return
    const canvas = document.createElement('canvas'); canvas.width = region.width; canvas.height = region.height
    const context = canvas.getContext('2d')
    if (!context) { setError(new Error(t('desktopWorkflow.cropFailed'))); return }
    context.drawImage(image.current, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    const version = epoch.current; const stepID = step.id; const selectedSlot = activeSlot
    void perform(async (signal) => {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (signal.aborted || version !== epoch.current) return
      if (!blob) throw new Error(t('desktopWorkflow.cropFailed'))
      const asset = await gateway.upload(blob)
      if (!signal.aborted && version === epoch.current) onChange(stepID, (existing) => setStepImage(existing, selectedSlot, { ...(stepImage(existing, selectedSlot) ?? blankImage()), asset_id: asset.id, anchor: undefined }))
    })
  }
  const sameFrame = matched && snapshot && matched.capture.metadata.frame_sequence === snapshot.metadata.frame_sequence && matched.capture.metadata.display_epoch === snapshot.metadata.display_epoch
  const boxStyle = (box: Region) => ({ left: `${box.x * 100 / snapshot!.metadata.width}%`, top: `${box.y * 100 / snapshot!.metadata.height}%`, width: `${Math.max(2, box.width) * 100 / snapshot!.metadata.width}%`, height: `${Math.max(2, box.height) * 100 / snapshot!.metadata.height}%` })
  return <section className={styles['screen-panel']} aria-label={t('desktopWorkflow.screen')}>
    <header className={styles['screen-toolbar']}>
      <Select className={styles['session-select']} allowClear placeholder={t('desktopWorkflow.selectSession')} value={session || undefined} options={sessions.filter((item) => item.connection_generation > 0 && item.status !== 'failed').map((item) => ({ value: item.id, label: `${item.profile_name} · ${item.protocol.toUpperCase()}` }))} onChange={(value) => setSession(value ?? '')} />
      <Button disabled={!preview || busy} onClick={() => void perform(async (signal) => { const shot = await gateway.capture(preview!, signal); if (!signal.aborted) { setSnapshot(shot); setMatched(undefined); setSelection(undefined) } })}>{t('desktopWorkflow.refresh')}</Button>
      <Select aria-label={t('desktopWorkflow.zoom')} value={zoom} options={['fit', '0.5', '1', '2'].map((value) => ({ value, label: value === 'fit' ? t('desktopWorkflow.fit') : `${Number(value) * 100}%` }))} onChange={setZoom} />
    </header>
    {error != null && <Alert type="error" title={workflowError(error, t)} closable onClose={() => setError(undefined)} action={<Button size="small" disabled={busy || !session} onClick={() => setPreviewRevision((v) => v + 1)}>{t('desktopWorkflow.refresh')}</Button>} />}
    <div className={styles['screen-tools']}>
      {step?.kind === 'pointer.drag' && <Select aria-label={t('desktopWorkflow.target')} value={slot} options={['target', 'end_target'].map((value) => ({ value, label: t(`desktopWorkflow.${value === 'target' ? 'target' : 'endTarget'}`) }))} onChange={setSlot} />}
      <Segmented size="small" disabled={!selectable || busy} value={selectionMode} options={(['point', 'template', 'region'] as const).map((value) => ({ value, label: t(`desktopWorkflow.select_${value}`), disabled: value === 'point' && !step?.kind.startsWith('pointer.') }))} onChange={setMode} />
      <Button size="small" disabled={!selectable || busy} onClick={() => fileInput.current?.click()}>{t('desktopWorkflow.importTemplate')}</Button>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = '' }} />
      <Button size="small" disabled={!preview || !target?.asset_id || busy} onClick={() => void perform(async (signal) => { const value = await gateway.match(preview!, target!, signal); if (!signal.aborted) { setMatched(value); setSnapshot({ metadata: value.capture.metadata, blob: value.image }); setSelection(undefined) } })}>{t('desktopWorkflow.testMatch')}</Button>
    </div>
    <div className={styles['canvas-scroll']}>
      {busy && <div className={styles['canvas-busy']}><Spin /></div>}
      {url && snapshot ? <div className={styles.canvas} style={{ width: zoom === 'fit' ? '100%' : snapshot.metadata.width * Number(zoom), maxWidth: zoom === 'fit' ? snapshot.metadata.width : undefined }}
        onPointerDown={(event) => { if (event.button !== 0 || !selectable || busy) return; drag.current = position(event); event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={(event) => { const point = position(event); if (drag.current && point && selectionMode !== 'point') setSelection(imageRegion(drag.current, point)) }}
        onPointerUp={(event) => void select(event)} onPointerCancel={() => { drag.current = undefined }}>
        <img ref={image} src={url} alt={t('desktopWorkflow.readonlyScreen')} draggable={false} />
        {selection && <span className={styles.selection} style={boxStyle(selection)} />}
        {sameFrame && matched.result.candidates.map((candidate, index) => <span key={index} className={styles['match-box']} style={boxStyle(candidate)}><span>{candidate.score.toFixed(3)}</span></span>)}
      </div> : <Empty description={t('desktopWorkflow.previewHint')} />}
    </div>
    <footer className={styles['screen-footer']}>
      {target?.asset_id && <button className={styles['template-button']} onClick={() => setLarge({ id: target.asset_id, title: t('desktopWorkflow.template'), load: (signal) => gateway.asset(target.asset_id, signal) })}><ImageThumbnail source={{ kind: 'remote', key: target.asset_id, load: (signal) => gateway.asset(target.asset_id, signal) }} alt={t('desktopWorkflow.template')} /></button>}
      <div className={styles.hint} role="status">{matched ? <>{t(`desktopWorkflow.match.${matched.result.state}`)}{matched.result.candidates.map((c, i) => <span key={i}> · {c.x}, {c.y} ({c.score.toFixed(3)})</span>)}{!sameFrame && <div>{t('desktopWorkflow.frameChanged')}</div>}</> : t('desktopWorkflow.readonlyHint')}</div>
    </footer>
    <ImagePreview source={large} onClose={() => setLarge(undefined)} />
  </section>
}
