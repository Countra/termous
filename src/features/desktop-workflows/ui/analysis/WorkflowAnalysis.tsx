import { hostDesktopTargetKey } from '#common/contracts'
import { App, Button, Dropdown, Modal, Select, Tag, Tooltip } from 'antd'
import { Download, Info, MoreHorizontal, RotateCw, ScanSearch, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisModeParameters, type AnalysisMode, type AnalysisPresentation, type AnalysisRecord, type ScreenAnalysisParameters } from '#common/contracts'
import { AnalysisExplorer, AnalysisHistoryList, AnalysisToolsPanel, analysisMinimumFilter, analysisTerminal, useAnalysisError, useVisibleQuery } from '#entities/screen-analysis'
import { contextActionMenuPopupClassName } from '#shared/ui'
import type { Snapshot, Step } from '#entities/desktop-workflow'
import { findStep, editStep } from '../../model/steps'
import { stepOCR } from '../../model/ocr'
import { analysisError } from '../../model/messages'
import { isTargetAvailable, sessionTarget } from '../../model/target'
import type { ImageSlot } from '../../model/images'
import type { WorkflowMediaGateway, WorkflowSurfaceModel } from '../../model/workspace/types'
import { useAnalysisRuntime } from '../../model/analysis/useAnalysisRuntime'
import { AnalysisSession } from '../../model/analysis/AnalysisSession'
import { prepareAnalysisApplication, type AnalysisApplication } from '../../model/analysis/applyAnalysis'
import { AnalysisRuntimeStatusView } from '../shared/AnalysisRuntimeStatus'
import { stepLabel } from '../shared/stepPresentation'
import styles from './WorkflowAnalysis.module.scss'

const initial: AnalysisPresentation = { open: false, layer: 'elements', filter: {}, history: false }
type Context = { editingID: string; step: Step; slot: ImageSlot; target: string }
export interface AnalysisTransfer { editingID: string; stepID: string; slot: ImageSlot; snapshot: Snapshot }

export function WorkflowAnalysis({ model, gateway, slot, active, guided, onMediaTask, onApplied }: {
  model: WorkflowSurfaceModel; gateway: WorkflowMediaGateway; slot: ImageSlot; active: boolean; guided: boolean
  onMediaTask: (task: Promise<unknown>) => void; onApplied: (value: AnalysisTransfer) => void
}) {
  const { t } = useTranslation(); const { modal, message } = App.useApp()
  const feedbackKey = useId()
  const feedbackRevision = useRef(0)
  const clearFeedback = useCallback(() => {
    // 已销毁的消息可能仍在退出动画中，新一轮提示使用新的键。
    message.destroy(`${feedbackKey}:${feedbackRevision.current++}`)
  }, [message, feedbackKey])
  const runtime = useAnalysisRuntime(gateway, active && !guided)
  const presentation = model.state.presentation.analysis ?? initial
  const state = useMemo(() => ({ ...presentation, filter: analysisMinimumFilter(presentation.filter) }), [presentation])
  const session = useRef<AnalysisSession | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const cancelPending = useRef(false)
  const [expired, setExpired] = useState(false)
  const working = useRef(false)
  const [mode, setMode] = useState<AnalysisMode>()
  const [panel, setPanel] = useState<'parameters' | 'export' | 'details'>()
  const [crop, setCrop] = useState<[number, number, number, number]>()
  const [revision, setRevision] = useState(0)
  const context = useRef<Context | undefined>(undefined)
  const confirmation = useRef<ReturnType<typeof modal.confirm> | undefined>(undefined)
  const mounted = useRef(true)
  const closing = useRef(false)
  // 提示绑定本次可见窗口，旧操作的回执不能进入重新打开的窗口。
  const feedbackScope = useMemo(() => ({ gateway, active, open: state.open }), [gateway, active, state.open])
  const latest = useRef({ model, state, slot, onApplied, active, feedbackScope }); latest.current = { model, state, slot, onApplied, active, feedbackScope }
  const targetKey = JSON.stringify(model.target)
  const captureKey = model.target.host ? hostDesktopTargetKey(model.target.host) : `${model.target.id}:${model.target.connectionGeneration}`
  const liveTarget = session.current?.live?.key
  const reportError = useCallback((reason: unknown, retry?: () => void) => {
    const revision = feedbackRevision.current
    const current = () => mounted.current && !closing.current && latest.current.state.open && latest.current.active && latest.current.feedbackScope === feedbackScope
    if (!current()) return
    void message.error({ key: `${feedbackKey}:${revision}`, duration: 6, content: <span className={styles.feedback}><span className={styles['feedback-text']}>{analysisError(reason, t)}</span>{retry && <Button className={styles['feedback-retry']} type="link" size="small" onClick={() => {
      if (current() && feedbackRevision.current === revision) { clearFeedback(); retry() }
    }}>{t('app.retry')}</Button>}</span> })
  }, [message, feedbackKey, feedbackScope, clearFeedback, t])
  useEffect(() => {
    if (!state.open || !active) clearFeedback()
    return clearFeedback
  }, [state.open, active, clearFeedback, feedbackScope])
  useEffect(() => {
    const owner = new AnalysisSession(gateway)
    session.current = owner; mounted.current = true
    working.current = false; cancelPending.current = false; context.current = undefined
    setBusy(false); setApplying(false)
    return () => {
      mounted.current = false; session.current = undefined; confirmation.current?.destroy()
      confirmation.current = undefined
      void owner.dispose().catch(reason => console.warn('[termous:workflow] 分析预览清理失败', reason))
    }
  }, [gateway])
  useEffect(() => { if (liveTarget && liveTarget !== captureKey) void session.current?.release().catch(reportError) }, [liveTarget, captureKey, reportError])
  const change = useCallback((patch: Partial<AnalysisPresentation>) => {
    const current = latest.current
    // 独立窗口确认可能晚于关闭意图；迟到的布局回报不能重新打开弹层。
    if (closing.current && patch.open === undefined && !('id' in patch)) return
    // 退出动画期间画布仍可能回报视图偏好，不能让迟到回报覆盖随后发生的开关操作。
    if (patch.view && (!current.state.open || patch.view.zoom === current.state.view?.zoom && patch.view.boxes === current.state.view?.boxes)) return
    const next = { ...current.state, ...patch, ...(closing.current ? { open: false } : {}) }
    latest.current = { ...current, state: next }
    current.model.actions.presentation({ analysis: next })
  }, [])
  const query = useVisibleQuery(`${state.id}:${revision}`, signal => gateway.getAnalysis(state.id!, signal), state.open && active && !!state.id, value => !analysisTerminal(value.state))
  const record = query.data?.id === state.id ? query.data : undefined
  useAnalysisError(state.open && active ? query.error ?? record?.error : undefined, reportError, query.error ? query.reload : undefined)
  useEffect(() => {
    const remaining = record?.action_expires_at ? Date.parse(record.action_expires_at) - Date.now() : 0
    setExpired(!(remaining > 0))
    if (remaining > 0) { const timer = setTimeout(() => setExpired(true), remaining); return () => clearTimeout(timer) }
  }, [record?.id, record?.action_expires_at])
  const open = () => {
    closing.current = false
    const draft = model.state.draft; const step = findStep(draft?.definition.steps ?? [], model.state.selected)
    context.current = draft && step && model.state.view === 'scripts' ? { editingID: draft.editingID, step: structuredClone(step), slot, target: targetKey } : undefined
    setPanel(undefined); setCrop(undefined); change({ open: true })
  }
  const close = () => { if (!applying) { closing.current = true; setPanel(undefined); setCrop(undefined); change({ open: false }) } }
  const perform = (work: (owner: AnalysisSession) => Promise<void>, application = false) => {
    const owner = session.current
    if (working.current || !owner) return Promise.resolve()
    working.current = true; setBusy(true); setApplying(application); clearFeedback()
    const current = () => mounted.current && session.current === owner
    const task = work(owner).catch(reason => { if (current()) reportError(reason) }).finally(() => { if (current()) { working.current = false; setBusy(false); setApplying(false) } })
    onMediaTask(task); return task
  }
  const submitted = (value: AnalysisRecord, owner: AnalysisSession) => {
    // 网关交接后旧任务可以后台完成，但不能覆盖新会话的选择和忙碌状态。
    if (!mounted.current || session.current !== owner) return
    setPanel(undefined); setCrop(undefined); setRevision(v => v + 1)
    change({ id: value.id, layer: value.parameters.detector_enabled ? 'elements' : 'ocr', filter: {}, selected: undefined, history: false })
  }
  const analyze = () => perform(async owner => {
    if (!isTargetAvailable(model.target, model.environment.sessions, [], model.environment.hostSources)) throw new Error('analysis_target_unavailable')
    await owner.submit({ id: model.target.id ?? '', generation: model.target.connectionGeneration ?? 0, target: model.target.host }, mode ? analysisModeParameters(mode) : undefined, value => submitted(value, owner))
  })
  const reanalyze = (parameters: ScreenAnalysisParameters) => perform(async owner => { if (record) submitted(await owner.reanalyze(record.id, parameters), owner) })
  const cancel = () => {
    if (!record || cancelPending.current) return
    cancelPending.current = true
    const owner = session.current
    const current = () => mounted.current && session.current === owner
    const task = gateway.cancelAnalysis(record.id).then(() => { if (current()) { query.reload(); setRevision(value => value + 1) } })
      .catch(reason => { if (current()) reportError(reason) }).finally(() => { if (current()) cancelPending.current = false })
    onMediaTask(task)
  }
  const selectHistory = (value: AnalysisRecord) => {
    setPanel(undefined); setCrop(undefined); context.current = undefined
    change({ id: value.id, layer: value.parameters.detector_enabled ? 'elements' : 'ocr', filter: {}, selected: undefined, history: false })
  }
  const validateContext = () => {
    const bound = context.current; const current = latest.current.model
    const step = findStep(current.state.draft?.definition.steps ?? [], bound?.step.id)
    if (!bound || !mounted.current || current.state.draft?.editingID !== bound.editingID || current.state.selected !== bound.step.id
      || JSON.stringify(current.target) !== bound.target || JSON.stringify(step) !== JSON.stringify(bound.step) || latest.current.slot !== bound.slot) throw new Error('analysis_context_changed')
    return bound
  }
  const validContext = (() => { try { return validateContext() } catch { return undefined } })()
  const live = record && session.current?.live?.id === record.id && record.source.kind === 'preview' && record.source.id === session.current.live.preview
  const supportsRegion = !!validContext && (validContext.step.kind.startsWith('pointer.') || validContext.step.kind.startsWith('image.') || validContext.step.kind === 'if')
  const eligible = !expired && supportsRegion && !!record && record.state === 'succeeded' && !!live && !!validContext && state.layer === 'elements' && state.selected !== undefined && !stepOCR(validContext.step, validContext.slot)
  const applicationHint = () => {
    if (!validContext || !live || !record) return t('desktopWorkflow.analysisWorkspace.readonly')
    if (!analysisTerminal(record.state)) return t('desktopWorkflow.analysisWorkspace.pendingResult')
    if (record.state !== 'succeeded') return t('desktopWorkflow.analysisWorkspace.readonly')
    return expired ? t('desktopWorkflow.analysisWorkspace.expired') : t('desktopWorkflow.analysisWorkspace.applyTo', { name: validContext.step.name || stepLabel(validContext.step.kind, t), slot: t(`desktopWorkflow.analysisWorkspace.${validContext.slot}`) })
  }
  const apply = (kind: AnalysisApplication) => perform(async owner => {
    if (!eligible || !record || !owner.live || state.selected === undefined) return
    const preview = owner.live.preview
    const bound = validateContext()
    const validate = () => {
      if (session.current !== owner || context.current !== bound) throw new Error('analysis_context_changed')
      validateContext()
    }
    const element = await gateway.analysisElement(record.id, state.selected)
    const value = await prepareAnalysisApplication(gateway, record, preview, element, bound.step, bound.slot, kind, validate)
    const current = latest.current.model; const draft = current.state.draft!
    await current.actions.change({ definition: { ...draft.definition, schema_version: 2, steps: editStep(draft.definition.steps, bound.step.id, () => value.step) } })
    if (!mounted.current || session.current !== owner) return
    latest.current.onApplied({ editingID: bound.editingID, stepID: bound.step.id, slot: bound.slot, snapshot: value.snapshot })
    closing.current = true; change({ open: false }); context.current = undefined
  }, true)
  const remove = () => {
    if (!record || confirmation.current) return
    const owner = session.current
    confirmation.current = modal.confirm({ title: t('analysisCenter.delete'), content: t('analysisCenter.deleteHint'), okButtonProps: { danger: true }, afterClose: () => { confirmation.current = undefined }, onOk: async () => {
      try { await gateway.deleteAnalysis(record.id) }
      catch (reason) { if (mounted.current && session.current === owner) reportError(reason); throw reason }
      if (!mounted.current || session.current !== owner) return
      if (latest.current.state.id === record.id) change({ id: undefined, selected: undefined })
      setRevision(v => v + 1)
    } })
  }
  return <>
    <Button size="small" type="text" icon={<ScanSearch size={15} />} onClick={open} disabled={guided}>{t('desktopWorkflow.analysisWorkspace.title')}</Button>
    <Modal open={state.open && active} width="min(1600px, calc(100vw - 48px))" centered footer={null} title={<div className={styles.title}>
      <span>{t('desktopWorkflow.analysisWorkspace.title')}</span>
      {validContext && <Tooltip title={applicationHint()}><div className={styles.apply}>
        <Button size="small" disabled={busy || !eligible || !validContext.step.kind.startsWith('pointer.')} onClick={() => void apply('point')}>{t('desktopWorkflow.analysis.usePoint')}</Button>
        <Button size="small" disabled={busy || !eligible} onClick={() => void apply('template')}>{t('desktopWorkflow.analysis.useTemplate')}</Button>
        <Button size="small" disabled={busy || !eligible} onClick={() => void apply('region')}>{t('desktopWorkflow.analysis.useRegion')}</Button>
      </div></Tooltip>}
    </div>}
      classNames={{ container: styles.dialog, body: styles.body, header: styles.header }} onCancel={close} mask={{ closable: false }} destroyOnHidden closable={!applying} keyboard={!applying}>
      {state.open && active && <>
        <div className={styles.toolbar}>
          <Select className={styles.sessions} aria-label={t('desktopWorkflow.selectSession')} placeholder={t('desktopWorkflow.selectSession')} value={model.target.host ? hostDesktopTargetKey(model.target.host) : model.target.mode === 'session' ? model.target.id : undefined} disabled={busy}
            options={[...(model.environment.hostSources ?? []).map(source => ({ value: hostDesktopTargetKey(source.target), label: `${t('hostDesktop.localDesktop')} · ${source.name}` })), ...model.environment.sessions.filter(s => s.connection_generation > 0 && !['failed', 'stopping'].includes(s.status)).map(s => ({ value: s.id, label: [s.host_name, s.profile_name].filter(Boolean).join(' · ') || s.id }))]}
            onChange={id => { const source = model.environment.hostSources?.find(source => hostDesktopTargetKey(source.target) === id); model.actions.target(source ? { mode: 'host', id, host: source.target } : sessionTarget(model.environment.sessions, id)) }} />
          <Select className={styles.mode} value={mode} allowClear disabled={busy} placeholder={t('desktopWorkflow.analysisWorkspace.settingsMode')} aria-label={t('settings.screenAnalysis.mode')}
            options={(['combined', 'detector', 'ocr'] as const).map(value => ({ value, label: t(`settings.screenAnalysis.modes.${value}`) }))} onChange={setMode} />
          <Button type="primary" icon={<ScanSearch size={15} />} loading={busy} disabled={!isTargetAvailable(model.target, model.environment.sessions, [], model.environment.hostSources) || !!record && !analysisTerminal(record.state)} onClick={() => void analyze()}>{t('desktopWorkflow.analysisWorkspace.analyze')}</Button>
          <div className={styles.spacer} /><AnalysisRuntimeStatusView gateway={gateway} state={runtime} onError={reportError} />
          <Dropdown trigger={['click']} placement="bottomRight" classNames={{ root: contextActionMenuPopupClassName }} menu={{ rootClassName: contextActionMenuPopupClassName, items: [
            { key: 'parameters', icon: <RotateCw size={14} />, label: t('analysisCenter.reanalyze'), disabled: busy || !record?.sha256 || !analysisTerminal(record.state) },
            { key: 'export', icon: <Download size={14} />, label: t('desktopWorkflow.analysisWorkspace.export'), disabled: !record?.sha256 },
            { key: 'details', icon: <Info size={14} />, label: t('desktopWorkflow.analysisWorkspace.details'), disabled: !record },
            { type: 'divider' }, { key: 'delete', icon: <Trash2 size={14} />, label: t('analysisCenter.delete'), danger: true, disabled: busy || !record || !analysisTerminal(record.state) },
          ], onClick: ({ key }) => { if (key === 'delete') remove(); else { setPanel(key as typeof panel); setCrop(undefined); change({ history: false, resultsVisible: true }) } } }}><Button icon={<MoreHorizontal size={16} />} aria-label={t('desktopWorkflow.analysisWorkspace.more')} /></Dropdown>
        </div>
        <div className={styles.summary} role="status">
          {record ? <><Tag>{t(`analysisCenter.states.${record.state}`)}</Tag><span>{record.source.name}</span><time>{new Date(record.metadata?.captured_at ?? record.created_at).toLocaleString()}</time>
            {record.summary && <strong>{t('desktopWorkflow.analysis.counts', { regions: record.summary.region_count, texts: record.summary.text_count, spans: record.summary.ocr_span_count })}</strong>}
            {!analysisTerminal(record.state) && <><span>{t(`analysisCenter.stages.${record.stage}`)}</span><Button size="small" disabled={applying || record.state === 'cancelling'} onClick={cancel}>{t('desktopWorkflow.analysis.cancel')}</Button></>}
          </> : <span>{t('desktopWorkflow.analysisWorkspace.emptyResult')}</span>}
        </div>
        <div className={styles.content}><AnalysisExplorer gateway={gateway} record={record} state={state} onChange={change} onError={reportError} crop={crop}
          history={<AnalysisHistoryList gateway={gateway} selected={state.id} revision={revision} onSelect={selectHistory} onError={reportError} onCleared={() => { change({ id: undefined, selected: undefined }); setRevision(v => v + 1) }} />}
          panel={panel && record ? { key: `${record.id}:${panel}`, content: <AnalysisToolsPanel key={`${record.id}:${panel}`} kind={panel} gateway={gateway} record={record} state={state} busy={busy} onError={reportError} onReanalyze={reanalyze} onCrop={setCrop} onClose={() => { setPanel(undefined); setCrop(undefined) }} /> } : undefined} /></div>
      </>}
    </Modal>
  </>
}
