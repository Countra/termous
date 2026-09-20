import { Alert, Button, Empty, Spin, Tag, Typography } from 'antd'
import { Eye, RefreshCw } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditPage } from '#entities/audit'
import type { AuditGateway } from '../api/auditGateway.ts'
import { auditActionLabel } from '../model/auditLabels.ts'
import styles from './AuditRelatedEvents.module.scss'
import shared from './AuditWorkspace.module.scss'

export function AuditRelatedEvents({ api, correlationId, selectedId, onSelect }: {
  api: AuditGateway
  correlationId: string
  selectedId: string
  onSelect: (id: string) => void
}) {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const [state, setState] = useState<{ page?: AuditPage; busy: boolean; failed?: 'initial' | 'more' }>({ busy: true })
  const [revision, setRevision] = useState(0)
  const request = useRef<AbortController | null>(null)
  const query = { correlation_id: correlationId, from: new Date(0).toISOString(), limit: 50, sort_by: 'received_at', sort_order: 'asc' } as const

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    void api.events({ correlation_id: correlationId, from: new Date(0).toISOString(), limit: 50, sort_by: 'received_at', sort_order: 'asc' }, controller.signal)
      .then((page) => { if (!controller.signal.aborted) setState({ page, busy: false }) })
      .catch(() => { if (!controller.signal.aborted) setState((value) => ({ ...value, busy: false, failed: 'initial' })) })
    return () => { controller.abort(); request.current = null }
  }, [api, correlationId, revision])

  const refresh = () => {
    setState((value) => ({ ...value, busy: true, failed: undefined }))
    setRevision((value) => value + 1)
  }
  const more = async () => {
    const signal = request.current?.signal
    if (state.busy || !state.page?.next_cursor || !signal || signal.aborted) return
    setState((value) => ({ ...value, busy: true, failed: undefined }))
    try {
      const next = await api.events({ ...query, cursor: state.page.next_cursor }, signal)
      if (!signal.aborted) setState((value) => {
        const items = new Map(value.page?.items.map((item) => [item.id, item]))
        next.items.forEach((item) => items.set(item.id, item))
        return { page: { ...next, items: [...items.values()] }, busy: false }
      })
    } catch {
      if (!signal.aborted) setState((value) => ({ ...value, busy: false, failed: 'more' }))
    }
  }

  return (
    <section className={styles.section} aria-labelledby={titleId} aria-busy={state.busy}>
      <header className={styles.header}>
        <div>
          <div className={styles.heading}><h3 id={titleId}>{t('audit.related')}</h3>{state.page ? <span className={styles.count}>{t('audit.relatedCount', { count: state.page.items.length })}</span> : null}</div>
          <p>{t('audit.relatedOrder')}</p>
        </div>
        <Button type="text" size="small" icon={<RefreshCw size={14} aria-hidden="true" />} aria-label={t('audit.refreshRelated')} title={t('audit.refreshRelated')} disabled={state.busy} onClick={refresh} />
      </header>
      {state.failed ? <Alert type="warning" showIcon title={t('audit.relatedFailed')} action={<Button size="small" onClick={() => state.failed === 'more' ? void more() : refresh()}>{t('audit.retry')}</Button>} /> : null}
      {!state.page && state.busy ? <div className={styles.loading} role="status"><Spin size="small" /><span>{t('audit.loadingRelated')}</span></div> : null}
      {state.page?.items.length ? (
        <ol className={styles.list} aria-label={t('audit.related')} tabIndex={0}>
          {state.page.items.map((item) => {
            const selected = item.id === selectedId
            const label = auditActionLabel(t, item.action)
            const meta = `${t(`audit.types.${item.type}`)} · ${t(`audit.producers.${item.producer}`, { defaultValue: item.producer })}`
            return (
              <li key={item.id} className={styles.item} aria-current={selected ? 'step' : undefined} data-outcome={item.outcome}>
                <div className={styles.content}>
                  <div className={styles.title}>
                    <Typography.Text className={styles.action} ellipsis={{ tooltip: label }}>{label}</Typography.Text>
                    <Tag className={shared.outcome} data-outcome={item.outcome}>{t(`audit.outcomes.${item.outcome}`, { defaultValue: item.outcome })}</Tag>
                  </div>
                  <Typography.Text className={styles.meta} ellipsis={{ tooltip: meta }}>{meta}</Typography.Text>
                  <div className={styles.time}><time dateTime={item.received_at}>{new Date(item.received_at).toLocaleString(i18n.language)}</time>{item.outcome !== 'started' ? <span>{item.duration_ms} ms</span> : null}</div>
                </div>
                <div className={styles.selection}>
                  {selected ? <span className={styles.current}>{t('audit.currentEvent')}</span> : <Button type="text" size="small" className={shared['detail-button']} icon={<Eye size={14} aria-hidden="true" />} onClick={() => onSelect(item.id)}>{t('audit.viewEvent')}</Button>}
                </div>
              </li>
            )
          })}
        </ol>
      ) : state.page && !state.busy && !state.failed ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('audit.noRelated')} /> : null}
      {state.page?.next_cursor ? <div className={styles.footer}><Button size="small" loading={state.busy} onClick={() => void more()}>{t('audit.loadMore')}</Button></div> : null}
    </section>
  )
}
