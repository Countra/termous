import { Button, Input, Segmented, Tooltip } from 'antd'
import { ArrowLeft, ArrowUpRight, FileCode2, History, Plus, RefreshCw, Search, Workflow } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Run, Script } from '#entities/desktop-workflow'
import { isRunActive } from '../../model/messages'
import { WorkflowOrigin } from '../shared/WorkflowOrigin'
import { WorkflowRunStatus } from '../shared/WorkflowRunStatus'
import styles from './WorkflowCatalog.module.scss'

interface Props {
  scripts: Script[]
  runs: Run[]
  view: 'scripts' | 'runs'
  selectedScript?: string
  selectedRun?: string
  busy: boolean
  loading: boolean
  onCreate: () => void
  onSelectScript: (id: string) => void
  onSelectRun: (id: string) => void
  onViewChange: (view: 'scripts' | 'runs') => void
  onRefresh: () => void
}

export function WorkflowCatalog(props: Props) {
  const { t } = useTranslation()
  const [queries, setQueries] = useState({ scripts: '', runs: '' })
  const search = queries[props.view]
  const [runFilter, setRunFilter] = useState<'all' | 'active'>('all')
  const query = search.trim().toLocaleLowerCase()
  const scripts = props.scripts.filter((item) => `${item.name} ${item.description} ${(item.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query))
  const runs = props.runs.filter((run) => `${run.name} ${run.target_name ?? ''}`.toLocaleLowerCase().includes(query) && (runFilter === 'all' || isRunActive(run.state)))
  const activeCount = props.runs.filter((run) => isRunActive(run.state)).length
  const history = props.view === 'runs'

  return <aside className={styles.catalog} aria-label={t(history ? 'desktopWorkflow.runs' : 'desktopWorkflow.library')}>
    <header className={styles.header}>
      <div className={styles.title}>
        {history ? <Button type="text" size="small" aria-label={t('desktopWorkflow.backToEditor')} icon={<ArrowLeft size={16} />} onClick={() => props.onViewChange('scripts')} /> : <Workflow size={17} />}
        <strong>{t(history ? 'desktopWorkflow.runs' : 'desktopWorkflow.library')}</strong>
        <span className={styles.count}>{history ? props.runs.length : props.scripts.length}</span>
      </div>
      <Tooltip title={t('desktopWorkflow.refresh')}><Button type="text" size="small" aria-label={t('desktopWorkflow.refresh')} loading={props.loading} icon={<RefreshCw size={14} />} onClick={props.onRefresh} /></Tooltip>
    </header>
    <div className={styles.tools}>
      {!history && <Button type="primary" block icon={<Plus size={16} />} disabled={props.busy} onClick={props.onCreate}>{t('desktopWorkflow.createWorkflow')}</Button>}
      <Input aria-label={t('desktopWorkflow.search')} prefix={<Search size={14} />} placeholder={t('desktopWorkflow.search')} value={search} allowClear onChange={(event) => setQueries((current) => ({ ...current, [props.view]: event.target.value }))} />
      {history && <Segmented block size="small" value={runFilter} options={[{ value: 'all', label: t('desktopWorkflow.allRuns') }, { value: 'active', label: t('desktopWorkflow.activeRuns', { count: activeCount }) }]} onChange={setRunFilter} />}
    </div>
    <div className={styles.list} aria-busy={props.loading}>
      {history ? runs.map((run) => <button type="button" key={run.id} className={styles.item} aria-current={props.selectedRun === run.id ? 'true' : undefined} onClick={() => props.onSelectRun(run.id)}>
        <span className={styles['item-title']}><span className={styles.name}>{run.name}</span><span className={styles.version}>v{run.version}</span></span>
        <WorkflowRunStatus state={run.state} />
        <span className={styles.detail}>{run.target_name || '—'}</span>
        <time className={styles.detail} dateTime={run.started_at}>{new Date(run.started_at).toLocaleString()}</time>
      </button>) : scripts.map((script) => <button type="button" key={script.id} className={styles.item} aria-current={props.selectedScript === script.id ? 'true' : undefined} disabled={props.busy} onClick={() => props.onSelectScript(script.id)}>
        <span className={styles['item-title']}><FileCode2 size={16} /><span className={styles.name}>{script.name}</span><WorkflowOrigin author={script.creator} /></span>
        {script.description && <span className={styles.description}>{script.description}</span>}
        <span className={styles.detail}><span className={styles.version}>v{script.revision}</span>{script.tags?.slice(0, 2).map((tag) => <span key={tag} className={styles.tag}>{tag}</span>)}</span>
      </button>)}
      {!props.loading && (history ? runs : scripts).length === 0 && <div className={styles.empty}><Search size={22} /><span>{t(query ? 'desktopWorkflow.noResults' : history ? 'desktopWorkflow.noRuns' : 'desktopWorkflow.noWorkflows')}</span></div>}
    </div>
    {!history && <button type="button" className={styles['history-button']} onClick={() => props.onViewChange('runs')}>
      <History size={17} /><span>{t('desktopWorkflow.executionHistory')}</span>{activeCount > 0 ? <span className={styles.active}>{activeCount}</span> : <ArrowUpRight size={14} />}
    </button>}
  </aside>
}
