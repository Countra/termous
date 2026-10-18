import { Alert, Button, Empty, Spin } from 'antd'
import { ClipboardList, Monitor, Pause, Play, Square, StepForward } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePreview, type ImagePreviewSource } from '#shared/ui'
import { isRunActive, workflowError } from '../../model/messages'
import { RunStepTimeline } from './RunStepTimeline'
import { RunSummary } from './RunSummary'
import type { WorkflowExecution } from '../../model/workspace/WorkflowExecution'
import type { WorkflowMediaGateway, WorkflowReport, WorkflowReportExpansion } from '../../model/workspace/types'
import styles from './RunReport.module.scss'

export function RunReportView({ gateway, id, active = true, report, onControl, onRefresh, onView, expansion, onExpansionChange }: {
  gateway: Pick<WorkflowMediaGateway, 'asset'>; id?: string; active?: boolean; report: WorkflowReport
  onControl: WorkflowExecution['control']; onRefresh: () => Promise<void>; onView: (session: string) => void | Promise<void>
  expansion?: WorkflowReportExpansion; onExpansionChange?: (value: WorkflowReportExpansion) => void
}) {
  const { t } = useTranslation()
  const { value, error, busy, loading } = report
  const root = useRef<HTMLElement>(null)
  const [image, setImage] = useState<ImagePreviewSource>()
  useEffect(() => { setImage(undefined) }, [gateway, id, active])
  useLayoutEffect(() => { if (root.current) root.current.scrollTop = 0 }, [id])
  const run = value && value.run.id === id ? value.run : undefined
  const definition = report.definition?.runID === id ? report.definition : undefined
  const command = onControl
  const viewDesktop = onView
  return <section ref={root} className={styles.report} hidden={!active} inert={!active} aria-label={t('desktopWorkflow.report')}>
    {error != null && <Alert type="error" title={workflowError(error, t)} action={<Button size="small" onClick={() => void onRefresh()}>{t('desktopWorkflow.refresh')}</Button>} />}
    {run ? <>
      <header className={styles['report-header']}>
        <div><p className={styles.eyebrow}>{t('desktopWorkflow.report')}</p><h3>{run.name}<span className={styles.version}>v{run.version}</span></h3></div>
        {run.session_id && <Button icon={<Monitor size={15} />} onClick={() => { void viewDesktop(run.session_id!) }}>{t('desktopWorkflow.viewDesktop')}</Button>}
      </header>
      <RunSummary run={run} controls={isRunActive(run.state) && <>
          <Button icon={run.state === 'paused' ? <Play size={14} /> : <Pause size={14} />} disabled={busy || run.state === 'preparing'} onClick={() => void command(run.state === 'paused' ? 'resume' : 'pause')}>{t(run.state === 'paused' ? 'desktopWorkflow.resume' : 'desktopWorkflow.pause')}</Button>
          <Button icon={<StepForward size={14} />} disabled={busy || run.state !== 'paused'} onClick={() => void command('step')}>{t('desktopWorkflow.singleStep')}</Button>
          <Button icon={<Square size={13} />} danger disabled={busy} onClick={() => void command('cancel')}>{t('desktopWorkflow.cancel')}</Button>
      </>} />
      {run.cleanup_error && <Alert type="warning" title={t('desktopWorkflow.cleanupFailed')} description={workflowError({ code: run.cleanup_error }, t)} />}
      {definition && <div className={styles['definition-hint']} role="status"><span>{t(`desktopWorkflow.definitionStatus.${definition.status}`, { version: run.version })}</span>{['failed', 'unavailable'].includes(definition.status) && <Button type="text" size="small" disabled={loading} onClick={() => void onRefresh()}>{t('desktopWorkflow.refresh')}</Button>}</div>}
      <RunStepTimeline key={run.id} steps={value?.steps ?? []} definition={definition?.value} gateway={gateway} onImage={setImage}
        expansion={onExpansionChange ? expansion?.runID === run.id ? expansion : { allExpanded: false, exceptions: [] } : undefined}
        onExpansionChange={onExpansionChange ? next => onExpansionChange({ ...next, runID: run.id }) : undefined} />
    </> : <div className={styles.empty}>{loading ? <Spin description={t('desktopWorkflow.loading')} /> : <><ClipboardList size={36} strokeWidth={1.2} /><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('desktopWorkflow.selectRun')} /><p>{t('desktopWorkflow.runSelectionHint')}</p></>}</div>}
    <ImagePreview source={image} onClose={() => setImage(undefined)} />
  </section>
}
