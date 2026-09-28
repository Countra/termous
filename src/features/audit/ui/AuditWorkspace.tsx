import { Alert, Button, ConfigProvider, Empty, Space, Table, Tag, Typography, type TableProps } from 'antd'
import { ClipboardList, Eye, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditEvent, AuditPage, AuditQuery, AuditSortField, AuditStatus } from '#entities/audit'
import type { AuditGateway } from '../api/auditGateway.ts'
import { auditActionLabel, auditScopeLabel } from '../model/auditLabels.ts'
import type { AuditFilterValues } from '../model/useAuditFilters.ts'
import { AuditFilters } from './AuditFilters.tsx'
import { AuditDetailsPanel } from './AuditDetailsPanel.tsx'
import { AuditResizableHeaderCell, type AuditResizableHeaderCellProps } from './AuditResizableHeaderCell.tsx'
import styles from './AuditWorkspace.module.scss'

const defaultColumnWidths = { received_at: 175, source: 130, action: 220, scope: 105, outcome: 135, actor_name: 135, resource_id: 140, duration_ms: 95, details: 90 }
type AuditColumnKey = keyof typeof defaultColumnWidths

export function AuditWorkspace({ api }: { api: AuditGateway }) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState<AuditQuery>({ limit: 50 })
  const [page, setPage] = useState<AuditPage>({ items: [] })
  const [status, setStatus] = useState<AuditStatus | null>(null)
  const [busy, setBusy] = useState(true)
  const [failed, setFailed] = useState(false)
  const [statusFailed, setStatusFailed] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [columnWidths, setColumnWidths] = useState(defaultColumnWidths)
  const [tableHeight, setTableHeight] = useState(240)
  const tableShell = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const shell = tableShell.current
    const header = shell?.querySelector<HTMLElement>('.ant-table-header')
    if (!shell || !header) return
    const syncHeight = () => setTableHeight(Math.max(80, shell.clientHeight - header.offsetHeight))
    const observer = new ResizeObserver(syncHeight)
    observer.observe(shell)
    observer.observe(header)
    syncHeight()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void api.events(query, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setPage(value); setFailed(false) }
    }).catch(() => { if (!controller.signal.aborted) { setFailed(true); setPage({ items: [] }) } })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    void api.status(controller.signal).then((value) => {
      if (!controller.signal.aborted) { setStatus(value); setStatusFailed(false) }
    }).catch(() => { if (!controller.signal.aborted) setStatusFailed(true) })
    return () => controller.abort()
  }, [api, query, revision])

  const changeFilters = useCallback((values: AuditFilterValues) => {
    setBusy(true)
    setHistory([])
    setQuery(({ sort_by, sort_order }) => ({ limit: 50, ...(sort_by ? { sort_by, sort_order } : {}), ...values, ...(Object.keys(values).length ? { cursor: undefined } : {}) }))
  }, [])
  const sortColumn = (field: AuditSortField) => ({
    key: field,
    sorter: true,
    sortOrder: query.sort_by === field ? (query.sort_order === 'asc' ? 'ascend' as const : 'descend' as const) : null,
    ellipsis: { showTitle: false },
  })
  const resizeColumn = (key: AuditColumnKey, label: string) => ({
    width: columnWidths[key],
    onHeaderCell: (): AuditResizableHeaderCellProps => ({
      columnWidth: columnWidths[key],
      minimumWidth: key === 'received_at' || key === 'action' ? 140 : 90,
      maximumWidth: key === 'details' ? 220 : 640,
      resizeLabel: t('audit.resizeColumn', { column: label }),
      resizeFromStart: key === 'details',
      onColumnResize: (width) => setColumnWidths((current) => current[key] === width ? current : { ...current, [key]: width }),
    }),
  })
  const changeSorting: TableProps<AuditEvent>['onChange'] = (_pagination, _filters, sorter, extra) => {
    if (extra.action !== 'sort') return
    const selectedSort = Array.isArray(sorter) ? sorter[0] : sorter
    setBusy(true)
    setHistory([])
    setQuery((current) => ({
      ...current,
      cursor: undefined,
      sort_by: selectedSort.order ? selectedSort.columnKey as AuditSortField : undefined,
      sort_order: selectedSort.order ? (selectedSort.order === 'ascend' ? 'asc' : 'desc') : undefined,
    }))
  }

  return (
    <section className={styles.page} aria-label={t('nav.audit')}>
      <header className={styles.header} data-tour="audit-workspace">
        <div className={styles.heading}><span className={styles['heading-icon']}><ClipboardList size={18} aria-hidden="true" /></span><div><h1>{t('nav.audit')}</h1><p>{t('audit.description')}</p></div></div>
        <Button icon={<RefreshCw size={15} />} loading={busy} onClick={() => { setBusy(true); setRevision((value) => value + 1) }}>{t('app.reload')}</Button>
      </header>
      {statusFailed || (status && status.state !== 'ready') || (status?.dropped ?? 0) > 0 ? <Alert type="warning" showIcon title={t('audit.degraded')} description={statusFailed ? t('audit.statusFailed') : t('audit.health', { queued: status?.queued ?? 0, dropped: status?.dropped ?? 0, failures: status?.write_failures ?? 0 })} /> : null}
      {status?.last_error ? <p className={styles.warning}>{status.last_error}</p> : null}
      <AuditFilters onChange={changeFilters} />
      {failed ? <Alert type="error" showIcon title={t('audit.loadFailed')} /> : null}
      <div ref={tableShell} className={styles.table} data-empty={page.items.length === 0}>
        <ConfigProvider theme={{ components: { Table: { headerBorderRadius: 0 } } }}>
        <Table<AuditEvent> size="small" rowKey="id" tableLayout="fixed" loading={busy} dataSource={page.items} pagination={false} components={{ header: { cell: AuditResizableHeaderCell } }} onChange={changeSorting} sortDirections={['ascend', 'descend']} scroll={{ x: Object.values(columnWidths).reduce((total, width) => total + width, 0), y: tableHeight }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('audit.empty')} /> }} columns={[
          { ...sortColumn('received_at'), ...resizeColumn('received_at', t('audit.received')), title: t('audit.received'), render: (_, event) => <CellText value={new Date(event.received_at).toLocaleString(i18n.language)} /> },
          { ...sortColumn('source'), ...resizeColumn('source', t('audit.source')), title: t('audit.source'), render: (_, event) => <div><CellText value={t(`audit.sources.${event.source}`)} /><CellText className={styles.secondary} value={t(`audit.producers.${event.producer}`, { defaultValue: event.producer })} /></div> },
          { ...sortColumn('action'), ...resizeColumn('action', t('audit.action')), title: t('audit.action'), render: (_, event) => <div><CellText className={styles.action} value={auditActionLabel(t, event.action)} /><CellText className={styles.secondary} value={t(`audit.types.${event.type}`)} /></div> },
          { ...sortColumn('scope'), ...resizeColumn('scope', t('audit.scope')), title: t('audit.scope'), render: (_, event) => <CellText value={auditScopeLabel(t, event.scope)} /> },
          { ...sortColumn('outcome'), ...resizeColumn('outcome', t('audit.outcome')), title: t('audit.outcome'), render: (_, event) => <Tag className={styles.outcome} data-outcome={event.outcome}><CellText value={t(`audit.outcomes.${event.outcome}`, { defaultValue: event.outcome })} /></Tag> },
          { ...sortColumn('actor_name'), ...resizeColumn('actor_name', t('audit.actor')), title: t('audit.actor'), render: (_, event) => <CellText value={event.actor_name || '—'} /> },
          { ...sortColumn('resource_id'), ...resizeColumn('resource_id', t('audit.target')), title: t('audit.target'), render: (_, event) => <CellText value={event.resource_id || '—'} /> },
          { ...sortColumn('duration_ms'), ...resizeColumn('duration_ms', t('audit.duration')), title: t('audit.duration'), render: (_, event) => <CellText value={event.outcome === 'started' ? '—' : `${event.duration_ms} ms`} /> },
          { ...resizeColumn('details', t('audit.detailsColumn')), title: t('audit.detailsColumn'), key: 'details', fixed: 'right', align: 'center', render: (_, event) => <Button type="text" size="small" className={styles['detail-button']} icon={<Eye size={14} aria-hidden="true" />} onClick={() => setSelected(event.id)}>{t('audit.detailsColumn')}</Button> },
        ]} />
        </ConfigProvider>
      </div>
      <footer className={styles.footer}><span>{t('audit.pageInfo', { page: history.length + 1, count: page.items.length })}</span><Space><Button disabled={busy || history.length === 0} onClick={() => { setBusy(true); setQuery((value) => ({ ...value, cursor: history[history.length - 1] || undefined })); setHistory((value) => value.slice(0, -1)) }}>{t('audit.previous')}</Button><Button disabled={busy || !page.next_cursor} onClick={() => { setBusy(true); setHistory((value) => [...value, query.cursor ?? '']); setQuery((value) => ({ ...value, cursor: page.next_cursor })) }}>{t('audit.next')}</Button></Space></footer>
      <AuditDetailsPanel api={api} id={selected} onClose={() => setSelected(null)} onSelect={setSelected} />
    </section>
  )
}

function CellText({ value, className }: { value: string; className?: string }) {
  return <Typography.Text className={[styles['cell-text'], className].filter(Boolean).join(' ')} ellipsis={{ tooltip: value }}>{value}</Typography.Text>
}
