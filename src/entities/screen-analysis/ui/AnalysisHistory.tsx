import { Alert, Button, Empty, Input, Select, Tag } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisRecordQuery, AnalysisState } from '#common/contracts'
import { useVisibleQuery } from '../model/useVisibleQuery'
import { AnalysisRecordDetail } from './AnalysisRecordDetail'
import styles from './History.module.scss'

export function AnalysisHistory({ gateway, active }: { gateway: AnalysisGateway; active: boolean }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState<AnalysisRecordQuery>({})
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [selected, setSelected] = useState<string>()
  const filter = { ...query, cursor: cursors[cursors.length - 1] }
  const list = useVisibleQuery(JSON.stringify(filter), signal => gateway.listAnalyses(filter, signal), active, () => true)
  const change = (patch: Partial<AnalysisRecordQuery>) => { setQuery({ ...query, ...patch }); setCursors([undefined]) }
  return <div className={styles.history}>
    <aside aria-label={t('analysisCenter.title')}>
      <header><strong>{t('analysisCenter.title')}</strong><Button size="small" onClick={list.reload}>{t('desktopWorkflow.refresh')}</Button></header>
      <Input.Search allowClear placeholder={t('analysisCenter.search')} aria-label={t('analysisCenter.search')} onSearch={q => change({ q })} />
      <Select aria-label={t('analysisCenter.state')} value={query.state ?? 'all'} options={['all', 'preparing', 'queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'].map(state => ({ value: state, label: t(`analysisCenter.states.${state}`) }))}
        onChange={state => change({ state: state === 'all' ? undefined : state as AnalysisState })} />
      <Select aria-label={t('analysisCenter.source')} value={query.source ?? 'all'} options={['all', 'preview', 'analysis', 'attachment'].map(source => ({ value: source, label: t(`analysisCenter.sources.${source}`) }))}
        onChange={source => change({ source: source === 'all' ? undefined : source as AnalysisRecordQuery['source'] })} />
      {(['after', 'before'] as const).map(key => <label key={key}>{t(`analysisCenter.${key}`)}<Input type="datetime-local" aria-label={t(`analysisCenter.${key}`)} onChange={event => change({ [key]: event.target.value ? new Date(event.target.value).toISOString() : undefined })} /></label>)}
      {list.error != null && <Alert type="error" title={t('analysisCenter.readFailed')} action={<Button onClick={list.reload}>{t('app.retry')}</Button>} />}
      <div className={styles.records}>
        {list.data?.items.map(record => <button key={record.id} type="button" aria-current={selected === record.id ? 'true' : undefined} onClick={() => setSelected(record.id)}>
          <strong>{record.source.name || record.id}</strong><Tag>{t(`analysisCenter.states.${record.state}`)}</Tag>
          <small>{new Date(record.created_at).toLocaleString()}</small>
          <small>{record.summary ? t('analysisCenter.elementCount', { count: record.summary.element_count }) : t(`analysisCenter.stages.${record.stage}`)}{record.reused && ` · ${t('analysisCenter.reused')}`}</small>
        </button>)}
        {list.data?.items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('analysisCenter.empty')} />}
      </div>
      <footer><Button size="small" disabled={cursors.length === 1} onClick={() => setCursors(cursors.slice(0, -1))}>{t('desktopWorkflow.analysis.previous')}</Button>
        <span>{list.data?.total ?? 0}</span><Button size="small" disabled={!list.data?.next_cursor} onClick={() => setCursors([...cursors, list.data!.next_cursor])}>{t('desktopWorkflow.analysis.next')}</Button></footer>
    </aside>
    {selected ? <AnalysisRecordDetail key={selected} id={selected} gateway={gateway} active={active} onSelect={id => { setSelected(id); list.reload() }} onDeleted={() => { setSelected(undefined); list.reload() }} />
      : <Empty description={t('analysisCenter.selectRecord')} />}
  </div>
}
