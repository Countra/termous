import { Alert, Badge, Button, Drawer, Pagination, Select, Spin, Tooltip } from 'antd'
import { Bell, Bot, CheckCheck, Cloud, FolderSync, ShieldCheck, Trash2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { notificationText, type NotificationMessage, type NotificationKind, type NotificationState } from '#entities/notification'
import { customSelectStyles, ManagementFilterTabs, uiStyles, WorkspaceEmptyState } from '#shared/ui'
import styles from './NotificationCenter.module.scss'

export interface NotificationCenterProps {
  state: NotificationState
  open: boolean
  filter: NotificationKind | 'all'
  selected: NotificationMessage | null
  unavailable: boolean
  busy: boolean
  error: boolean
  onOpen(open: boolean): void
  onFilter(filter: NotificationKind | 'all'): void
  onView(message: NotificationMessage): void
  onReadAll(): void
  onClearRead(): void
  onDismiss(message: NotificationMessage): void
}

export function NotificationCenter(props: NotificationCenterProps) {
  const { state, open, filter, selected, busy, error, unavailable } = props
  const { t, i18n } = useTranslation()
  const trigger = useRef<HTMLButtonElement>(null)
  const [unread, setUnread] = useState(false)
  const [page, setPage] = useState(1)
  const filtered = state.items.filter((m) => (filter === 'all' || m.kind === filter) && (!unread || !m.read))
  const currentPage = Math.max(1, Math.min(page, Math.ceil(filtered.length / 30)))
  const selectedText = selected ? notificationText(selected, i18n.language) : null
  const hasFilters = unread || filter !== 'all'
  const emptyTitle = !state.items.length ? 'notifications.empty' : unread ? 'notifications.emptyUnread' : 'notifications.emptyFiltered'
  return <>
    <Tooltip title={t('notifications.title')}>
      <Badge count={state.unread} size="small" overflowCount={99} offset={[-2, 2]}>
        <Button ref={trigger} type="text" className={styles.bell} aria-label={t('notifications.title')} aria-expanded={open}
          icon={<Bell size={18} aria-hidden="true" />} onClick={() => props.onOpen(true)} />
      </Badge>
    </Tooltip>
    <Drawer
      title={<span className={styles.heading}><Bell size={17} aria-hidden="true" /><span>{t('notifications.title')}</span>
        {state.unread > 0 && <span className={styles.count} aria-label={t('notifications.unread')}>{state.unread}</span>}
      </span>}
      open={open} size={440} onClose={() => props.onOpen(false)} closeIcon={<X size={18} aria-hidden="true" />}
      closable={{ placement: 'end', 'aria-label': t('app.close') }} rootClassName={styles.root}
      afterOpenChange={(visible) => { if (!visible) trigger.current?.focus({ preventScroll: true }) }}
      classNames={{ section: styles.panel, header: styles.header, body: styles.body, footer: styles.footer, close: styles.close }}
      footer={filtered.length > 30 ? <Pagination size="small" current={currentPage} pageSize={30} total={filtered.length} showSizeChanger={false} onChange={setPage} /> : null}>
      <div className={styles.controls}>
        <div className={styles.toolbar}>
          <ManagementFilterTabs className={styles.filters} activeKey={unread ? 'unread' : 'all'}
            items={[{ key: 'all', label: t('notifications.all') }, { key: 'unread', label: t('notifications.unread') }]}
            onChange={(value) => { setUnread(value === 'unread'); setPage(1) }} />
          <Select aria-label={t('notifications.source')} value={filter} className={`${customSelectStyles.select} ${styles.source}`}
            classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
            options={(['all', 'agent', 'file', 'approval', 'cloud'] as const).map((value) => ({ value, label: t(`notifications.sources.${value}`) }))}
            onChange={(value) => { props.onFilter(value); setPage(1) }} />
        </div>
        <div className={styles.actions}>
          <span className={styles.result}>{t('notifications.resultCount', { count: filtered.length })}</span>
          <Button size="small" type="text" className={uiStyles['inline-management-action']} icon={<CheckCheck size={14} aria-hidden="true" />} disabled={busy || !state.unread} onClick={props.onReadAll}>{t('notifications.readAll')}</Button>
          <Button size="small" type="text" className={uiStyles['inline-management-action']} icon={<Trash2 size={14} aria-hidden="true" />} disabled={busy || !state.items.some((m) => m.read)} onClick={props.onClearRead}>{t('notifications.clearRead')}</Button>
        </div>
      </div>
      <div className={styles.scroll}>
        {(error || state.error) && <Alert className={styles.notice} type="warning" title={t(error ? 'notifications.operationFailed' : 'notifications.reconnecting')} />}
        {unavailable && selectedText && <Alert className={styles.notice} type="info" title={selectedText.title} description={<>{selectedText.body}<br /><span>{t(selected?.kind === 'approval' ? 'notifications.approvalMissing' : 'notifications.targetMissing')}</span></>} />}
        {!state.loaded && !state.error ? <div className={styles.loading}><Spin /></div> : filtered.length === 0 ? state.loaded && <div className={styles.empty}>
          <WorkspaceEmptyState className={styles['empty-state']} icon={<Bell size={22} strokeWidth={1.6} aria-hidden="true" />}
            title={t(emptyTitle)} description={t(state.items.length ? 'notifications.emptyFilteredHint' : 'notifications.emptyHint')}
            action={state.items.length > 0 && hasFilters ? <Button type="text" className={uiStyles['inline-management-action']}
              onClick={() => { setUnread(false); setPage(1); props.onFilter('all') }}>{t('notifications.viewAll')}</Button> : undefined} />
        </div> :
        <ul className={styles.list}>
          {filtered.slice((currentPage - 1) * 30, currentPage * 30).map((message) => {
            const text = notificationText(message, i18n.language)
            const Icon = message.kind === 'cloud' ? Cloud : message.kind === 'approval' ? ShieldCheck : message.kind === 'agent' ? Bot : FolderSync
            return <li key={message.id} className={`${styles.item} ${!message.read ? styles.unread : ''}`}>
              <button type="button" className={styles.content} onClick={() => props.onView(message)} disabled={busy}>
                <span className={`${styles.icon} ${message.outcome === 'failed' ? styles.failed : message.outcome !== 'success' ? styles.attention : ''}`}><Icon size={16} aria-hidden="true" /></span>
                <span className={styles.copy}>
                  <span className={styles.title}>{text.title}{!message.read && <span className={styles.dot} aria-label={t('notifications.unread')} />}</span>
                  <span className={styles.subject}>{text.subject}</span>
                  {text.summary && <span className={styles.summary}>{text.summary}</span>}
                  <time dateTime={message.occurred_at}>{new Date(message.occurred_at).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                </span>
              </button>
              <Tooltip title={t('notifications.dismiss')}><Button type="text" size="small" className={`${uiStyles['inline-management-action']} ${styles.dismiss}`} icon={<X size={14} aria-hidden="true" />} disabled={busy}
                aria-label={`${t('notifications.dismiss')} · ${text.title}`} onClick={() => props.onDismiss(message)} /></Tooltip>
            </li>
          })}
        </ul>}
      </div>
    </Drawer>
  </>
}
