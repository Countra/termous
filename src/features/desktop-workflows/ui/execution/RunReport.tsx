import { Alert, Button, Empty, Spin } from 'antd'
import { ClipboardList, Monitor, Pause, Play, Square, StepForward } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Run, StepResult, WorkflowGateway } from '#entities/desktop-workflow'
import { ImagePreview, ImageThumbnail, type ImagePreviewSource } from '#shared/ui'
import { isRunActive, wasRequestRejected, workflowError } from '../../model/messages'
import { workflowAuthor } from '../../model/author'
import { WorkflowRunStatus } from '../shared/WorkflowRunStatus'
import styles from './RunReport.module.scss'

export function RunReport({ gateway, id, revision, active = true, onView }: { gateway: WorkflowGateway; id?: string; revision: number; active?: boolean; onView: (session: string) => void | Promise<void> }) {
  const { t } = useTranslation()
  const [value, setValue] = useState<{ run: Run; steps: StepResult[] }>()
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [image, setImage] = useState<ImagePreviewSource>()
  const pending = useRef(new Map<string, string>())
  const inFlight = useRef(false)
  const scope = useRef(0)
  useEffect(() => {
    const version = ++scope.current
    setImage(undefined)
    return () => { scope.current = version + 1 }
  }, [gateway, id, active])
  useEffect(() => {
    const controller = new AbortController()
    setError(undefined)
    if (!id) setValue(undefined)
    if (!active || !id) { setLoading(false); return }
    setLoading(true)
    void gateway.run(id, controller.signal).then((data) => { if (!controller.signal.aborted) { setValue(data); setError(undefined) } }).catch((reason) => { if (!controller.signal.aborted) setError(reason) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [gateway, id, revision, refresh, active])
  const run = value && value.run.id === id ? value.run : undefined
  const command = async (action: 'pause' | 'resume' | 'step' | 'cancel') => {
    if (!id || inFlight.current) return
    const key = `${id}:${action}`
    const requestID = pending.current.get(key) ?? crypto.randomUUID()
    const version = scope.current
    pending.current.set(key, requestID)
    inFlight.current = true
    setBusy(true); setError(undefined)
    try { await gateway.control(id, requestID, action); pending.current.delete(key); if (version === scope.current) setRefresh((v) => v + 1) }
    catch (reason) { if (wasRequestRejected(reason)) pending.current.delete(key); if (version === scope.current) setError(reason) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const viewDesktop = async (session: string) => {
    const version = scope.current
    try { await onView(session) }
    catch (reason) { if (version === scope.current) setError(reason) }
  }
  return <section className={styles.report} hidden={!active} inert={!active} aria-label={t('desktopWorkflow.report')}>
    {error != null && <Alert type="error" title={workflowError(error, t)} action={<Button size="small" onClick={() => setRefresh((value) => value + 1)}>{t('desktopWorkflow.refresh')}</Button>} />}
    {run ? <>
      <header className={styles['report-header']}>
        <div><h3>{run.name} <span className={styles.hint}>v{run.version}</span></h3><p>{run.target_name || '—'} · {run.protocol?.toUpperCase() || '—'}</p><p className={styles.hint}>{t('desktopWorkflow.initiator', { name: workflowAuthor(run.initiator, t) })}</p></div>
        <WorkflowRunStatus state={run.state} />
        {run.session_id && <Button icon={<Monitor size={15} />} onClick={() => { void viewDesktop(run.session_id!) }}>{t('desktopWorkflow.viewDesktop')}</Button>}
      </header>
      <div className={styles.metrics}>
        <div><span>{t('desktopWorkflow.executedSteps')}</span><strong>{run.executed}</strong></div>
        <div><span>{t('desktopWorkflow.assertionCount')}</span><strong>{run.assertions}</strong></div>
        <div><span>{t('desktopWorkflow.runTarget')}</span><strong className={styles['target-name']}>{run.target_name || '—'}</strong></div>
      </div>
      <div className={styles.toolbar}>
        {isRunActive(run.state) && <>
          <Button icon={run.state === 'paused' ? <Play size={14} /> : <Pause size={14} />} disabled={busy || run.state === 'preparing'} onClick={() => void command(run.state === 'paused' ? 'resume' : 'pause')}>{t(run.state === 'paused' ? 'desktopWorkflow.resume' : 'desktopWorkflow.pause')}</Button>
          <Button icon={<StepForward size={14} />} disabled={busy || run.state !== 'paused'} onClick={() => void command('step')}>{t('desktopWorkflow.singleStep')}</Button>
          <Button icon={<Square size={13} />} danger disabled={busy} onClick={() => void command('cancel')}>{t('desktopWorkflow.cancel')}</Button>
        </>}
        <span className={styles.hint}>{t('desktopWorkflow.runProgress', { count: run.executed, assertions: run.assertions })} · {t(`desktopWorkflow.phases.${run.phase}`)}</span>
      </div>
      {run.state === 'completed' && <Alert type="success" title={t(run.assertions ? 'desktopWorkflow.assertionsPassed' : 'desktopWorkflow.executionCompleted')} />}
      {run.error_code && <Alert type="error" title={workflowError({ code: run.error_code }, t)} description={run.state === 'uncertain' ? t('desktopWorkflow.uncertainHint') : undefined} />}
      {run.cleanup_error && <Alert type="warning" title={t('desktopWorkflow.cleanupFailed')} description={workflowError({ code: run.cleanup_error }, t)} />}
      <p className={styles.hint}>{new Date(run.started_at).toLocaleString()}{run.finished_at && ` — ${new Date(run.finished_at).toLocaleString()}`}</p>
      <h4 className={styles['results-title']}>{t('desktopWorkflow.stepResults')}<span>{value?.steps.length ?? 0}</span></h4>
      <ol className={styles['result-list']}>
        {value?.steps.map((step) => <li key={step.index}>
          <span className={styles['step-number']}>{step.index}</span><div className={styles['result-text']}><strong>{t(`desktopWorkflow.kinds.${step.kind.replace(/\./g, '_')}`)}</strong><span>{t(`desktopWorkflow.states.${step.state}`)}{step.error_code && ` · ${workflowError({ code: step.error_code }, t)}`}</span><span className={styles.hint}>{step.finished_at && `${Math.max(0, Date.parse(step.finished_at) - Date.parse(step.started_at))} ms`}</span></div>
          {step.asset_id && <button className={styles['evidence-button']} aria-label={t('desktopWorkflow.viewEvidence')} onClick={() => setImage({ id: step.asset_id!, title: t('desktopWorkflow.evidence'), load: (signal) => gateway.asset(step.asset_id!, signal) })}><ImageThumbnail source={{ kind: 'remote', key: step.asset_id, load: (signal) => gateway.asset(step.asset_id!, signal) }} alt={t('desktopWorkflow.evidence')} /></button>}
          {step.evidence_cleared && <span className={styles.hint}>{t('desktopWorkflow.evidenceCleared')}</span>}
        </li>)}
      </ol>
      {!value?.steps.length && <p className={styles.hint}>{t('desktopWorkflow.noStepResults')}</p>}
    </> : <div className={styles.empty}>{loading ? <Spin description={t('desktopWorkflow.loading')} /> : <><ClipboardList size={36} strokeWidth={1.2} /><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('desktopWorkflow.selectRun')} /><p>{t('desktopWorkflow.runSelectionHint')}</p></>}</div>}
    <ImagePreview source={image} onClose={() => setImage(undefined)} />
  </section>
}
