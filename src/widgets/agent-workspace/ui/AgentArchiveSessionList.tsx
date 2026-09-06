import { Input, Button, Spin, type InputRef } from 'antd'
import { Archive, Folder, Search } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSession, AgentSessionGroup } from '#entities/agent'
import styles from './AgentArchiveManager.module.scss'

interface AgentArchiveSessionListProps {
  sessions: AgentSession[]
  groups?: AgentSessionGroup[]
  query: string
  loading: boolean
  failed: boolean
  selectedId?: string
  onQueryChange: (query: string) => void
  onSelect: (id: string) => void
}

export function AgentArchiveSessionList({
  sessions, groups, query, loading, failed, selectedId, onQueryChange, onSelect,
}: AgentArchiveSessionListProps) {
  const { t, i18n } = useTranslation()
  const searchRef = useRef<InputRef>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const previousSelected = useRef(selectedId)
  const groupNames = useMemo(() => new Map(groups?.map(({ id, name }) => [id, name])), [groups])
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    year: 'numeric', month: 'short', day: 'numeric',
  }), [i18n.resolvedLanguage])
  const fullDateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'full', timeStyle: 'short',
  }), [i18n.resolvedLanguage])

  useEffect(() => {
    const previous = previousSelected.current
    previousSelected.current = selectedId
    if (selectedId || !previous || document.activeElement === searchRef.current?.input) return
    // 返回时定位刚查看的会话；恢复或删除后优先回到剩余记录，空列表回到搜索。
    const target = rowRefs.current.get(previous) ?? rowRefs.current.values().next().value
    if (target) target.focus()
    else searchRef.current?.focus()
  }, [selectedId])

  return (
    <>
      <div className={styles.search}>
        <Input
          ref={searchRef}
          allowClear
          prefix={<Search size={15} aria-hidden="true" />}
          value={query}
          placeholder={t('agent.archives.search')}
          aria-label={t('agent.archives.search')}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className={styles['list-heading']}>
        <span>{t(query.trim() ? 'agent.archives.results' : 'agent.archives.all')}</span>
        <span>{!loading && !failed ? sessions.length : null}</span>
      </div>
      <div className={styles.list} role="list" aria-busy={loading}>
        {loading ? <div className={styles.loading} role="status"><Spin size="small" /><span>{t('agent.archives.loading')}</span></div> : null}
        {!loading && !failed && sessions.length === 0 ? (
          <div className={styles.placeholder}>
            {query.trim() ? <Search size={22} aria-hidden="true" /> : <Archive size={22} aria-hidden="true" />}
            <p>{t(query.trim() ? 'agent.archives.noResults' : 'agent.archives.empty')}</p>
            {query.trim() ? <Button size="small" onClick={() => onQueryChange('')}>{t('agent.archives.clearSearch')}</Button> : null}
          </div>
        ) : null}
        {sessions.map((session) => {
          const groupName = (session.group_id && groupNames.get(session.group_id)) || t('agent.sessions.ungrouped')
          const archivedAt = session.archived_at ? new Date(session.archived_at) : undefined
          const validDate = archivedAt && Number.isFinite(archivedAt.getTime()) ? archivedAt : undefined
          return (
            <div role="listitem" key={session.id}>
              <button
                ref={(element) => { if (element) rowRefs.current.set(session.id, element); else rowRefs.current.delete(session.id) }}
                type="button"
                className={styles.row}
                aria-current={session.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(session.id)}
              >
                <strong title={session.title}>{session.title}</strong>
                <span className={styles['row-meta']}>
                  <span className={styles['row-group']} title={groupName}><Folder size={12} aria-hidden="true" /><span>{groupName}</span></span>
                  {validDate ? <time dateTime={session.archived_at} title={t('agent.archives.archivedAt', { date: fullDateFormatter.format(validDate) })}>{dateFormatter.format(validDate)}</time> : null}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
