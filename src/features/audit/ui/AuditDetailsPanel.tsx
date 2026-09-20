import { Alert, Button, Descriptions, Drawer, Spin } from 'antd'
import { ListTree } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditEvent } from '#entities/audit'
import type { AuditGateway } from '../api/auditGateway.ts'
import { decodeAuditDetails } from '../model/auditProtocol.ts'
import { auditActionLabel, auditScopeLabel } from '../model/auditLabels.ts'
import { AuditRelatedEvents } from './AuditRelatedEvents.tsx'
import styles from './AuditWorkspace.module.scss'

export function AuditDetailsPanel({ api, id, onClose, onSelect }: { api: AuditGateway; id: string | null; onClose: () => void; onSelect: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const [loaded, setLoaded] = useState<{ id: string; event?: AuditEvent; failed?: boolean }>({ id: '' })
  const [selection, setSelection] = useState<{ id: string; correlationId: string } | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const related = useRef<HTMLDivElement>(null)
  const focusSelection = useRef(false)
  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    void api.event(id, controller.signal).then((event) => {
      if (controller.signal.aborted) return
      setLoaded({ id, event })
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ id, failed: true }) })
    return () => { controller.abort() }
  }, [api, id])

  const current = loaded.id === id ? loaded : undefined
  const event = current?.event
  const details = event ? decodeAuditDetails(event) : null
  useEffect(() => {
    if (!id) focusSelection.current = false
    if (current && focusSelection.current) {
      content.current?.scrollIntoView({ block: 'start' })
      content.current?.focus({ preventScroll: true })
      focusSelection.current = false
    }
  }, [id, current])
  // 同一调用内切换只更新详情，关联列表的分页与滚动位置保留到关闭或换链。
  const correlationId = id ? current?.event?.correlation_id ?? (selection?.id === id ? selection.correlationId : undefined) : undefined

  return (
    <Drawer open={Boolean(id)} onClose={onClose} title={t('audit.detail')} size="large" className={styles.drawer} extra={correlationId ? <Button type="text" size="small" icon={<ListTree size={15} aria-hidden="true" />} onClick={() => { related.current?.scrollIntoView({ block: 'start' }); related.current?.focus({ preventScroll: true }) }}>{t('audit.related')}</Button> : null}>
      <div ref={content} tabIndex={-1} className={styles['detail-content']} aria-label={t('audit.detail')}>
      {current?.failed ? <Alert type="error" title={t('audit.loadFailed')} /> : !event ? <Spin /> : (
        <div className={styles.details}>
          <Descriptions column={1} size="small" items={[
            { key: 'id', label: t('audit.eventId'), children: event.id },
            { key: 'action', label: t('audit.action'), children: <div>{auditActionLabel(t, event.action)}<div className={styles.identifier}>{event.action}</div></div> },
            { key: 'scope', label: t('audit.scope'), children: auditScopeLabel(t, event.scope) },
            { key: 'type', label: t('audit.type'), children: t(`audit.types.${event.type}`) },
            { key: 'outcome', label: t('audit.outcome'), children: t(`audit.outcomes.${event.outcome}`, { defaultValue: event.outcome }) },
            { key: 'source', label: t('audit.source'), children: t(`audit.sources.${event.source}`) },
            { key: 'producer', label: t('audit.producer'), children: t(`audit.producers.${event.producer}`, { defaultValue: event.producer }) },
            { key: 'actor', label: t('audit.actor'), children: `${event.actor_name} (${event.actor_id})` },
            { key: 'target', label: t('audit.target'), children: [event.resource_type, event.resource_id].filter(Boolean).join(' / ') || '—' },
            { key: 'occurred', label: t('audit.occurred'), children: new Date(event.occurred_at).toLocaleString(i18n.language) },
            { key: 'received', label: t('audit.received'), children: new Date(event.received_at).toLocaleString(i18n.language) },
            { key: 'duration', label: t('audit.duration'), children: `${event.duration_ms} ms` },
            { key: 'correlation', label: t('audit.correlation'), children: event.correlation_id || '—' },
            { key: 'request', label: t('audit.requestId'), children: event.request_id || '—' },
            { key: 'ua', label: 'User-Agent', children: event.user_agent || '—' },
          ]} />
          {event.summary ? <p>{event.summary}</p> : null}
          {details?.kind === 'unknown' ? <Alert type="info" title={t('audit.unknownVersion', { version: event.details_version })} /> : details?.truncated ? <Alert type="warning" title={t('audit.truncated')} /> : null}
          {details && details.kind !== 'unknown' ? (['context', 'parameters', 'result'] as const).map((key) => Object.keys(details[key]).length > 0 ? (
            <section key={key}>
              <h3>{t(`audit.${key}`)}</h3>
              <dl className={styles.fields}>{Object.entries(details[key]).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</dd></div>)}</dl>
            </section>
          ) : null) : null}
          <details><summary>{t('audit.json')}</summary><pre className={styles.json}>{JSON.stringify(event.details ?? {}, null, 2)}</pre></details>
        </div>
      )}
      </div>
      {correlationId && id ? <div ref={related} tabIndex={-1} className={styles['related-content']}><AuditRelatedEvents key={correlationId} api={api} correlationId={correlationId} selectedId={id} onSelect={(nextId) => { focusSelection.current = true; setSelection({ id: nextId, correlationId }); onSelect(nextId) }} /></div> : null}
    </Drawer>
  )
}
