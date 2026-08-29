import { Archive, MessageSquarePlus, Search, Trash2 } from 'lucide-react'
import { Button, Input, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentWorkspaceSession } from '../model/types.ts'
import styles from './AgentSessionSidebar.module.scss'

export function AgentSessionSidebar({
  sessions,
  selectedSessionId,
  disabled,
  onCreate,
  onSelect,
  onArchive,
  onDelete,
}: {
  sessions: AgentWorkspaceSession[]
  selectedSessionId?: string
  disabled: boolean
  onCreate: () => void
  onSelect: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return keyword ? sessions.filter((session) => session.title.toLocaleLowerCase().includes(keyword)) : sessions
  }, [query, sessions])

  return (
    <aside className={styles['session-sidebar']} data-agent-panel aria-label={t('agent.sessions.title')}>
      <div className={styles['session-sidebar-header']}>
        <Button type="primary" block icon={<MessageSquarePlus size={16} />} onClick={onCreate}>
          {t('agent.sessions.new')}
        </Button>
        <Input
          allowClear
          prefix={<Search size={14} aria-hidden="true" />}
          value={query}
          aria-label={t('agent.sessions.search')}
          placeholder={t('agent.sessions.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className={styles['session-list']} role="list">
        {visible.length === 0 ? <p className={styles['session-list-empty']}>{t('agent.sessions.empty')}</p> : visible.map((session) => (
          <div
            key={session.id}
            className={`${styles['session-row']} ${selectedSessionId === session.id ? styles['is-selected'] : ''}`}
            role="listitem"
          >
            <button
              type="button"
              aria-current={selectedSessionId === session.id ? 'page' : undefined}
              onClick={() => onSelect(session.id)}
            >
              <strong>{session.title}</strong>
              <span>
                <span>{session.provider_name
                  ? `${session.model_name} · ${session.provider_name}`
                  : session.model_name}</span>
                <time dateTime={session.updated_at}>{formatRelative(session.updated_at, i18n?.resolvedLanguage)}</time>
              </span>
            </button>
            <div className={styles['session-actions']}>
              <Tooltip title={t('agent.sessions.archive')}>
                <Button type="text" size="small" disabled={disabled} aria-label={t('agent.sessions.archive')} icon={<Archive size={14} />} onClick={() => onArchive(session.id)} />
              </Tooltip>
              <Tooltip title={t('app.delete')}>
                <Button type="text" size="small" danger disabled={disabled} aria-label={t('app.delete')} icon={<Trash2 size={14} />} onClick={() => onDelete(session.id)} />
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function formatRelative(value: string, locale?: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' })
  if (minutes < 1) return relative.format(0, 'minute')
  if (minutes < 60) return relative.format(-minutes, 'minute')
  if (minutes < 1_440) return relative.format(-Math.floor(minutes / 60), 'hour')
  return relative.format(-Math.floor(minutes / 1_440), 'day')
}
