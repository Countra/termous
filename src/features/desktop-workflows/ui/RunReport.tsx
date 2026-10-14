import { Alert, Button, Empty, Tag } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Run, StepResult, WorkflowGateway } from '#entities/desktop-workflow'
import { ImagePreview, ImageThumbnail, type ImagePreviewSource } from '#shared/ui'
import { isRunActive, wasRequestRejected, workflowError } from '../model/messages'
import { workflowAuthor } from '../model/author'
import styles from './WorkflowWorkspace.module.scss'

export function RunReport({ gateway, id, revision, onView }: { gateway: WorkflowGateway; id?: string; revision: number; onView: (session: string) => void | Promise<void> }) {
  const { t } = useTranslation()
  const [value, setValue] = useState<{ run: Run; steps: StepResult[] }>()
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [image, setImage] = useState<ImagePreviewSource>()
  const pending = useRef(new Map<string, string>())
  const inFlight = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    if (!id) { setValue(undefined); return }
    void gateway.run(id, controller.signal).then((data) => { if (!controller.signal.aborted) { setValue(data); setError(undefined) } }).catch((reason) => { if (!controller.signal.aborted) setError(reason) })
    return () => controller.abort()
  }, [gateway, id, revision, refresh])
  const run = value && value.run.id === id ? value.run : undefined
  const command = async (action: 'pause' | 'resume' | 'step' | 'cancel') => {
    if (!id || inFlight.current) return
    const key = `${id}:${action}`
    const requestID = pending.current.get(key) ?? crypto.randomUUID()
    pending.current.set(key, requestID)
    inFlight.current = true
    setBusy(true); setError(undefined)
    try { await gateway.control(id, requestID, action); pending.current.delete(key); setRefresh((v) => v + 1) }
    catch (reason) { if (wasRequestRejected(reason)) pending.current.delete(key); setError(reason) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <section className={styles.report} aria-label={t('desktopWorkflow.report')}>
    {error != null && <Alert type="error" title={workflowError(error, t)} />}
    {run ? <>
      <header className={styles['report-header']}>
        <div><h3>{run.name} <span className={styles.hint}>v{run.version}</span></h3><p>{run.target_name || '—'} · {run.protocol?.toUpperCase() || '—'}</p><p className={styles.hint}>{t('desktopWorkflow.initiator', { name: workflowAuthor(run.initiator, t) })}</p></div>
        <Tag>{t(`desktopWorkflow.states.${run.state}`)}</Tag>
        {run.session_id && <Button onClick={() => { void Promise.resolve().then(() => onView(run.session_id!)).catch(setError) }}>{t('desktopWorkflow.viewDesktop')}</Button>}
      </header>
      <div className={styles.toolbar}>
        {isRunActive(run.state) && <>
          <Button disabled={busy || run.state === 'preparing'} onClick={() => void command(run.state === 'paused' ? 'resume' : 'pause')}>{t(run.state === 'paused' ? 'desktopWorkflow.resume' : 'desktopWorkflow.pause')}</Button>
          <Button disabled={busy || run.state !== 'paused'} onClick={() => void command('step')}>{t('desktopWorkflow.singleStep')}</Button>
          <Button danger disabled={busy} onClick={() => void command('cancel')}>{t('desktopWorkflow.cancel')}</Button>
        </>}
        <span className={styles.hint}>{t('desktopWorkflow.runProgress', { count: run.executed, assertions: run.assertions })} · {t(`desktopWorkflow.phases.${run.phase}`)}</span>
      </div>
      {run.state === 'completed' && <Alert type="success" title={t(run.assertions ? 'desktopWorkflow.assertionsPassed' : 'desktopWorkflow.executionCompleted')} />}
      {run.error_code && <Alert type="error" title={workflowError({ code: run.error_code }, t)} description={run.state === 'uncertain' ? t('desktopWorkflow.uncertainHint') : undefined} />}
      {run.cleanup_error && <Alert type="warning" title={t('desktopWorkflow.cleanupFailed')} description={workflowError({ code: run.cleanup_error }, t)} />}
      <p className={styles.hint}>{new Date(run.started_at).toLocaleString()}{run.finished_at && ` — ${new Date(run.finished_at).toLocaleString()}`}</p>
      <ol className={styles['result-list']}>
        {value?.steps.map((step) => <li key={step.index}>
          <span className={styles['step-number']}>{step.index}</span><div className={styles['result-text']}><strong>{t(`desktopWorkflow.kinds.${step.kind.replace(/\./g, '_')}`)}</strong><span>{t(`desktopWorkflow.states.${step.state}`)}{step.error_code && ` · ${workflowError({ code: step.error_code }, t)}`}</span><span className={styles.hint}>{step.finished_at && `${Math.max(0, Date.parse(step.finished_at) - Date.parse(step.started_at))} ms`}</span></div>
          {step.asset_id && <button className={styles['evidence-button']} aria-label={t('desktopWorkflow.viewEvidence')} onClick={() => setImage({ id: step.asset_id!, title: t('desktopWorkflow.evidence'), load: (signal) => gateway.asset(step.asset_id!, signal) })}><ImageThumbnail source={{ kind: 'remote', key: step.asset_id, load: (signal) => gateway.asset(step.asset_id!, signal) }} alt={t('desktopWorkflow.evidence')} /></button>}
          {step.evidence_cleared && <span className={styles.hint}>{t('desktopWorkflow.evidenceCleared')}</span>}
        </li>)}
      </ol>
    </> : <Empty description={t('desktopWorkflow.selectRun')} />}
    <ImagePreview source={image} onClose={() => setImage(undefined)} />
  </section>
}
