import { Button } from 'antd'
import { ArrowRight, Crosshair, Layers2, ListChecks, Play, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Run } from '#entities/desktop-workflow'
import { isRunActive } from '../../model/messages'
import { WorkflowRunStatus } from '../shared/WorkflowRunStatus'
import styles from './WorkflowOverview.module.scss'

export function WorkflowOverview({ scriptCount, runs, onCreate, onRun }: { scriptCount: number; runs: Run[]; onCreate: () => void; onRun: (id: string) => void }) {
  const { t } = useTranslation()
  const active = runs.filter((run) => isRunActive(run.state))
  const recent = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 4)
  return <div className={styles.overview}>
    <div className={styles.intro}>
      <div className={styles.mark}><Workflow size={28} strokeWidth={1.4} /></div>
      <h2>{t('desktopWorkflow.overviewTitle')}</h2>
      <p>{t('desktopWorkflow.overviewDescription')}</p>
      <Button type="primary" icon={<ArrowRight size={16} />} iconPlacement="end" onClick={onCreate}>{t('desktopWorkflow.create')}</Button>
    </div>
    <div className={styles.summary}>
      <div><strong>{scriptCount}</strong><span>{t('desktopWorkflow.library')}</span></div>
      <div><strong>{active.length}</strong><span>{t('desktopWorkflow.runningNow')}</span></div>
      <div><strong>{runs.length}</strong><span>{t('desktopWorkflow.executionHistory')}</span></div>
    </div>
    {recent.length > 0 ? <section className={styles.recent}>
      <h3>{t('desktopWorkflow.recentRuns')}</h3>
      {recent.map((run) => <button type="button" key={run.id} className={styles.run} onClick={() => onRun(run.id)}><Play size={14} /><span className={styles['run-name']}>{run.name}</span><WorkflowRunStatus state={run.state} /><ArrowRight size={14} /></button>)}
    </section> : <div className={styles.guide}>
      {([{ Icon: Layers2, key: 'compose' }, { Icon: Crosshair, key: 'locate' }, { Icon: ListChecks, key: 'review' }] as const).map(({ Icon, key }) => <div key={key}><Icon size={18} /><strong>{t(`desktopWorkflow.guide.${key}`)}</strong><p>{t(`desktopWorkflow.guide.${key}Hint`)}</p></div>)}
    </div>}
  </div>
}
