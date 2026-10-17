import { CircleCheck, CircleDashed, CirclePause, CircleStop, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Run } from '#entities/desktop-workflow'
import { workflowAuthor } from '../../model/author'
import { isRunActive, workflowError } from '../../model/messages'
import { runDuration, runTime, runTone } from '../shared/runPresentation'
import styles from './RunSummary.module.scss'

export function RunSummary({ run, controls }: { run: Run; controls?: ReactNode }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  const active = isRunActive(run.state)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active, run.id])
  const tone = runTone(run.state)
  const Icon = run.state === 'paused' ? CirclePause : run.state === 'cancelled' ? CircleStop
    : tone === 'success' ? CircleCheck : tone === 'error' ? CircleX : tone === 'warning' ? TriangleAlert : tone === 'active' ? LoaderCircle : CircleDashed
  const title = t(`desktopWorkflow.states.${run.state}`, { defaultValue: run.state })
  const description = run.error_code ? workflowError({ code: run.error_code }, t)
    : run.state === 'completed' ? t(run.assertions ? 'desktopWorkflow.assertionsPassed' : 'desktopWorkflow.executionCompleted')
      : run.state === 'paused' ? t('desktopWorkflow.pausedHint')
        : run.state === 'cancelled' ? t('desktopWorkflow.cancelledHint')
      : t(`desktopWorkflow.phases.${run.phase}`, { defaultValue: run.phase })
  return <section className={styles.summary} data-tone={tone} aria-label={t('desktopWorkflow.executionSummary')}>
    <div className={styles.outcome}>
      <span className={styles.icon}><Icon size={21} strokeWidth={1.6} /></span>
      <div className={styles.message}><strong>{title}</strong><p>{description}</p>{run.state === 'uncertain' && <p className={styles.caution}>{t('desktopWorkflow.uncertainHint')}</p>}</div>
    </div>
    <div className={styles.metrics}>
      <div><span>{t('desktopWorkflow.executedSteps')}</span><strong>{run.executed}<small>{t('desktopWorkflow.stepUnit')}</small></strong></div>
      <div><span>{t('desktopWorkflow.assertionCount')}</span><strong>{run.assertions}</strong></div>
      <div><span>{t('desktopWorkflow.elapsed')}</span><strong className={styles.duration}>{runDuration(run.started_at, run.finished_at ?? (active ? new Date(now).toISOString() : undefined))}</strong></div>
    </div>
    {controls && <div className={styles.controls}>{controls}<span>{t('desktopWorkflow.runProgress', { count: run.executed, assertions: run.assertions })}</span></div>}
    <dl className={styles.metadata}>
      <div><dt>{t('desktopWorkflow.runTarget')}</dt><dd>{run.target_name || '—'}{run.protocol && <small>{run.protocol.toUpperCase()}</small>}</dd></div>
      <div><dt>{t('desktopWorkflow.runInitiator')}</dt><dd>{workflowAuthor(run.initiator, t)}</dd></div>
      <div><dt>{t('desktopWorkflow.startedAt')}</dt><dd>{runTime(run.started_at)}</dd></div>
      <div><dt>{t('desktopWorkflow.finishedAt')}</dt><dd>{runTime(run.finished_at)}</dd></div>
    </dl>
  </section>
}
