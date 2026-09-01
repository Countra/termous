import { Archive, MessageSquarePlus, MessageSquareText, MoreHorizontal, PanelLeftClose, Search, Trash2 } from 'lucide-react'
import { Button, Dropdown, Input, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { contextActionMenuPopupClassName } from '#shared/ui'
import type { AgentWorkspaceSession } from '../model/types.ts'
import styles from './AgentSessionSidebar.module.scss'

export function AgentSessionSidebar({
  sessions,
  selectedSessionId,
  disabled,
  queuedSessionId,
  onCreate,
  onSelect,
  onArchive,
  onDelete,
  onClose,
}: {
  sessions: AgentWorkspaceSession[]
  selectedSessionId?: string
  disabled: boolean
  queuedSessionId?: string
  onCreate: () => void
  onSelect: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onClose?: () => void
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
        <div className={styles['session-sidebar-title']}>
          <span><MessageSquareText size={15} aria-hidden="true" /><strong>{t('agent.sessions.title')}</strong></span>
          <span>
            <Tooltip title={t('agent.sessions.new')}>
              <Button type="text" aria-label={t('agent.sessions.new')} icon={<MessageSquarePlus size={16} />} onClick={onCreate} />
            </Tooltip>
            {onClose ? (
              <Tooltip title={t('app.close')}>
                <Button type="text" aria-label={t('app.close')} icon={<PanelLeftClose size={16} />} onClick={onClose} />
              </Tooltip>
            ) : null}
          </span>
        </div>
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
        {visible.length === 0 ? <p className={styles['session-list-empty']}>{t('agent.sessions.empty')}</p> : visible.map((session) => {
          const runActive = ['queued', 'starting', 'running', 'waiting_approval', 'stopping'].includes(session.run_status)
          const archiveDisabled = disabled || runActive || session.id === queuedSessionId
          const deleteDisabled = disabled || runActive
          return (
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
              <span className={styles['session-meta']}>
                <span className={styles['session-model']}>
                  <i data-status={session.run_status.replace('_', '-')} aria-hidden="true" />
                  <span>{session.provider_name
                    ? `${session.model_alias ?? session.model_name} · ${session.provider_name}`
                    : session.model_alias ?? session.model_name}</span>
                </span>
                <time dateTime={session.updated_at}>{formatRelative(session.updated_at, i18n?.resolvedLanguage)}</time>
              </span>
            </button>
            <div className={styles['session-actions']}>
              <Dropdown
                trigger={['click']}
                disabled={archiveDisabled && deleteDisabled}
                classNames={{ root: contextActionMenuPopupClassName }}
                menu={{
                  items: [
                    { key: 'archive', icon: <Archive size={14} />, label: t('agent.sessions.archive'), disabled: archiveDisabled },
                    { key: 'delete', icon: <Trash2 size={14} />, label: t('app.delete'), danger: true, disabled: deleteDisabled },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'archive') onArchive(session.id)
                    if (key === 'delete') onDelete(session.id)
                  },
                }}
              >
                <Tooltip title={t('agent.sessions.more')}>
                  <Button
                    type="text"
                    size="small"
                    disabled={archiveDisabled && deleteDisabled}
                    aria-label={t('agent.sessions.more')}
                    icon={<MoreHorizontal size={15} />}
                  />
                </Tooltip>
              </Dropdown>
            </div>
          </div>
          )
        })}
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
