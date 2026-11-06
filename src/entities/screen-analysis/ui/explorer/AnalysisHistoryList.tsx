import { App, Button, Tag } from 'antd'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisRecord, AnalysisRecordQuery } from '#common/contracts'
import { analysisTerminal, useVisibleQuery } from '../../model/useVisibleQuery'
import { useAnalysisError, type AnalysisErrorReporter } from '../../model/useAnalysisError'
import { AnalysisFilterPopover } from './AnalysisFilterPopover'
import { AnalysisHistoryFilters } from './AnalysisHistoryFilters'
import { AnalysisSearch } from './AnalysisSearch'
import styles from './Explorer.module.scss'

export function AnalysisHistoryList({ gateway, selected, revision, onSelect, onCleared, onError }: {
  gateway: AnalysisGateway; selected?: string; revision: number; onSelect: (record: AnalysisRecord) => void; onCleared: () => void; onError: AnalysisErrorReporter
}) {
  const { t } = useTranslation(); const { modal } = App.useApp()
  const [filter, setFilter] = useState<AnalysisRecordQuery>({})
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const confirmation = useRef<ReturnType<typeof modal.confirm> | undefined>(undefined)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; confirmation.current?.destroy(); confirmation.current = undefined }
  }, [])
  const query = { ...filter, cursor: cursors[cursors.length - 1], limit: 20 }
  const list = useVisibleQuery(JSON.stringify([query, revision]), signal => gateway.listAnalyses(query, signal), true, page => page.items.some(item => !analysisTerminal(item.state)))
  useAnalysisError(list.error, onError, list.reload)
  const update = (patch: AnalysisRecordQuery) => { setFilter(current => ({ ...current, ...patch })); setCursors([undefined]) }
  const count = Object.entries(filter).filter(([key, value]) => key !== 'q' && value !== undefined).length
  const clear = () => {
    if (confirmation.current) return
    confirmation.current = modal.confirm({ title: t('analysisCenter.clear'), content: t('analysisCenter.clearHint'), okButtonProps: { danger: true }, afterClose: () => { confirmation.current = undefined }, onOk: async () => {
      if (!mounted.current) return
      try {
        await gateway.clearAnalyses()
        if (mounted.current) { setCursors([undefined]); list.reload(); onCleared() }
      } catch (error) { if (mounted.current) onError(error); throw error }
    } })
  }
  return <section className={styles.history}>
    <header><strong>{t('desktopWorkflow.analysisWorkspace.history')}</strong><div className={styles.actions}><Button type="text" size="small" icon={<RefreshCw size={15} />} onClick={list.reload} aria-label={t('desktopWorkflow.refresh')} /></div></header>
    <div className={styles['history-filters']}>
      <AnalysisSearch value={filter.q} placeholder={t('desktopWorkflow.analysisWorkspace.historySearch')} onChange={q => update({ q })} />
      <AnalysisFilterPopover count={count} onReset={() => { setFilter({ q: filter.q }); setCursors([undefined]) }}><AnalysisHistoryFilters value={filter} onChange={update} /></AnalysisFilterPopover>
    </div>
    <div className={styles['history-list']} aria-busy={list.loading}>
      {list.data?.items.map(record => <button type="button" key={record.id} aria-current={selected === record.id} onClick={() => onSelect(record)}>
        <strong>{record.source.name || record.id}</strong><time>{new Date(record.created_at).toLocaleString()}</time>
        <span><Tag>{t(`analysisCenter.states.${record.state}`)}</Tag>{record.summary && <small>{t('analysisCenter.elementCount', { count: record.summary.element_count })}</small>}</span>
      </button>)}
      {list.data?.items.length === 0 && <p className={styles.hint}>{t('desktopWorkflow.analysisWorkspace.noHistory')}</p>}
    </div>
    <div className={styles.pagination}><Button disabled={cursors.length === 1 || list.loading} onClick={() => setCursors(cursors.slice(0, -1))}>{t('desktopWorkflow.analysis.previous')}</Button><span>{list.data?.total ?? 0}</span><Button disabled={!list.data?.next_cursor || list.loading} onClick={() => setCursors([...cursors, list.data!.next_cursor])}>{t('desktopWorkflow.analysis.next')}</Button></div>
    <Button type="text" danger onClick={clear}>{t('analysisCenter.clear')}</Button>
  </section>
}
