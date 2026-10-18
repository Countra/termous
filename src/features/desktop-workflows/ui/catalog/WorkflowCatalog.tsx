import { Button, Input, Segmented, Tooltip } from 'antd'
import { ArrowLeft, ArrowUpRight, FileCode2, History, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Run, Script } from '#entities/desktop-workflow'
import { isRunActive } from '../../model/messages'
import { WorkflowOrigin } from '../shared/WorkflowOrigin'
import { WorkflowRunList } from './WorkflowRunList'
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
  collapsed: boolean
  onToggle: () => void
  queries: { scripts: string; runs: string }
  runFilter: 'all' | 'active'
  onQueriesChange: (queries: { scripts: string; runs: string }) => void
  onRunFilterChange: (filter: 'all' | 'active') => void
}

export function WorkflowCatalog(props: Props) {
  const { t } = useTranslation()
  const { queries, runFilter } = props
  const search = queries[props.view]
  const query = search.trim().toLocaleLowerCase()
  const scripts = props.scripts.filter((item) => `${item.name} ${item.description} ${(item.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query))
  const runs = props.runs.filter((run) => `${run.name} ${run.target_name ?? ''}`.toLocaleLowerCase().includes(query) && (runFilter === 'all' || isRunActive(run.state)))
  const activeCount = props.runs.filter((run) => isRunActive(run.state)).length
  const history = props.view === 'runs'

  return <aside className={styles.catalog} data-collapsed={props.collapsed || undefined} aria-label={t(history ? 'desktopWorkflow.runs' : 'desktopWorkflow.library')}>
    <div className={styles.rail} hidden={!props.collapsed}>
      <Tooltip title={t('desktopWorkflow.expandLibrary')} placement="right"><Button type="text" aria-label={t('desktopWorkflow.expandLibrary')} aria-expanded={false} icon={<PanelLeftOpen size={18} />} onClick={props.onToggle} /></Tooltip>
      <span className={styles['rail-divider']} />
      <Tooltip title={t('desktopWorkflow.library')} placement="right"><Button type={history ? 'text' : 'default'} aria-label={t('desktopWorkflow.library')} icon={<Workflow size={18} />} onClick={() => { props.onViewChange('scripts'); props.onToggle() }} /></Tooltip>
      <Tooltip title={t('desktopWorkflow.createWorkflow')} placement="right"><Button type="text" aria-label={t('desktopWorkflow.createWorkflow')} disabled={props.busy} icon={<Plus size={18} />} onClick={props.onCreate} /></Tooltip>
      <Tooltip title={t('desktopWorkflow.executionHistory')} placement="right"><Button type={history ? 'default' : 'text'} aria-label={t('desktopWorkflow.executionHistory')} icon={<History size={18} />} onClick={() => { props.onViewChange('runs'); props.onToggle() }} /></Tooltip>
    </div>
    <div className={styles.expanded} hidden={props.collapsed}>
      <header className={styles.header}>
        <div className={styles.title}>
          {history ? <Button type="text" size="small" aria-label={t('desktopWorkflow.backToEditor')} icon={<ArrowLeft size={16} />} onClick={() => props.onViewChange('scripts')} /> : <Workflow size={17} />}
          <strong>{t(history ? 'desktopWorkflow.runs' : 'desktopWorkflow.library')}</strong>
          <span className={styles.count}>{history ? props.runs.length : props.scripts.length}</span>
        </div>
        <Tooltip title={t('desktopWorkflow.collapseLibrary')}><Button type="text" size="small" aria-label={t('desktopWorkflow.collapseLibrary')} aria-expanded={true} icon={<PanelLeftClose size={16} />} onClick={props.onToggle} /></Tooltip>
      </header>
      <div className={styles.tools}>
        {!history && <Button type="primary" block icon={<Plus size={16} />} disabled={props.busy} onClick={props.onCreate}>{t('desktopWorkflow.createWorkflow')}</Button>}
        <Input size="small" aria-label={t('desktopWorkflow.search')} prefix={<Search size={14} />} placeholder={t('desktopWorkflow.search')} value={search} allowClear onChange={(event) => props.onQueriesChange({ ...queries, [props.view]: event.target.value })} />
        {history && <Segmented block size="small" value={runFilter} options={[{ value: 'all', label: t('desktopWorkflow.allRuns') }, { value: 'active', label: t('desktopWorkflow.activeRuns', { count: activeCount }) }]} onChange={props.onRunFilterChange} />}
      </div>
      <div className={styles.list} aria-busy={props.loading}>
        {history ? <WorkflowRunList runs={runs} selected={props.selectedRun} onSelect={props.onSelectRun} /> : scripts.map((script) => <button type="button" key={script.id} className={styles.item} aria-current={props.selectedScript === script.id ? 'true' : undefined} disabled={props.busy} onClick={() => props.onSelectScript(script.id)}>
          <span className={styles['item-title']}><span className={styles['item-icon']}><FileCode2 size={16} /></span><span className={styles.name}>{script.name}</span><span className={styles.version}>v{script.revision}</span></span>
          {script.description && <span className={styles.description}>{script.description}</span>}
          <span className={styles.detail}><WorkflowOrigin author={script.creator} />{script.tags?.slice(0, 2).map((tag) => <span key={tag} className={styles.tag}>{tag}</span>)}</span>
        </button>)}
        {!props.loading && (history ? runs : scripts).length === 0 && <div className={styles.empty}><Search size={22} /><span>{t(query ? 'desktopWorkflow.noResults' : history ? 'desktopWorkflow.noRuns' : 'desktopWorkflow.noWorkflows')}</span></div>}
      </div>
      {!history && <button type="button" className={styles['history-button']} onClick={() => props.onViewChange('runs')}>
        <History size={17} /><span>{t('desktopWorkflow.executionHistory')}</span>{activeCount > 0 ? <span className={styles.active}>{activeCount}</span> : <ArrowUpRight size={14} />}
      </button>}
      <footer className={styles.footer}><span>{t('desktopWorkflow.libraryCount', { count: history ? props.runs.length : props.scripts.length })}</span><Tooltip title={t('desktopWorkflow.refresh')}><Button type="text" size="small" aria-label={t('desktopWorkflow.refresh')} loading={props.loading} icon={<RefreshCw size={13} />} onClick={props.onRefresh} /></Tooltip></footer>
    </div>
  </aside>
}
