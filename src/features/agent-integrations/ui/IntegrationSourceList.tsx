import { Button, Dropdown, Input, Pagination, Skeleton, Switch, Tooltip } from 'antd'
import { BookOpen, Ellipsis, Files, LogIn, Search, Settings2, Trash2, Unplug, PlugZap, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIntegrationSource } from '#entities/agent-integrations'
import type { IntegrationConnectionStatus } from '#common/agent-integrations'
import { contextActionMenuPopupClassName } from '#shared/ui'
import { IntegrationEmptyState } from './IntegrationEmptyState'
import styles from './IntegrationSourceList.module.scss'

export type IntegrationSourceAction = 'edit' | 'test' | 'login' | 'reconnect' | 'remove' | 'update'
export function IntegrationSourceList({ sources, connections, kind, loading, busy, toggling = false, onInspect, onToggle, onAction }: {
  sources: AgentIntegrationSource[]; connections: IntegrationConnectionStatus[]; kind: 'mcp' | 'skill'; loading: boolean; busy: string; toggling?: boolean
  onInspect(source: AgentIntegrationSource): void; onToggle(source: AgentIntegrationSource, enabled: boolean): void
  onAction(source: AgentIntegrationSource, action: IntegrationSourceAction): void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const values = sources.filter(source => `${source.name} ${source.skill?.description ?? ''} ${source.mcp?.command ?? ''} ${source.mcp?.url ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const currentPage = Math.min(page, Math.max(1, Math.ceil(values.length / 12)))
  return <div className={styles.root}>
    <div className={styles.filter}><Input prefix={<Search size={14} />} value={query} allowClear aria-label={t('extensions.filter')} placeholder={t('extensions.filter')}
      onChange={event => { setQuery(event.target.value); setPage(1) }} /><span>{t('extensions.sourceCount', { count: sources.length })}</span></div>
    {loading && !sources.length ? <div className={styles.skeleton} aria-label={t('extensions.loading')} role="status"><Skeleton active paragraph={{ rows: 3 }} /></div> : !values.length ?
      <IntegrationEmptyState kind={query.trim() ? 'search' : kind}
        title={t(query.trim() ? 'extensions.noMatches' : kind === 'mcp' ? 'extensions.emptyMCP' : 'extensions.emptySkills')}
        description={t(query.trim() ? 'extensions.noMatchesHint' : kind === 'mcp' ? 'extensions.emptyMCPHint' : 'extensions.emptySkillsHint')}
        action={query.trim() ? <Button size="small" onClick={() => { setQuery(''); setPage(1) }}>{t('extensions.clearSearch')}</Button> : undefined} /> :
      <ul className={styles.list} aria-label={t(kind === 'mcp' ? 'extensions.mcpTab' : 'extensions.skillTab')} aria-busy={loading}>
        {values.slice((currentPage - 1) * 12, currentPage * 12).map(source => {
          const statuses = connections.filter(value => value.source === source.id && value.revision === source.revision)
          const connection = statuses.find(value => value.state === 'connected') ?? statuses.sort((a, b) => (b.status_revision ?? 0) - (a.status_revision ?? 0))[0]
          const status = !source.enabled ? 'extensions.disabled' : source.auth_state === 'required' ? 'extensions.loginRequired' : connection ? `mcpPreparation.connectionStates.${connection.state}` : 'extensions.idle'
          const description = source.kind === 'skill' ? source.skill?.description : source.mcp?.transport === 'http' ? source.mcp.url : [source.mcp?.command, ...(source.mcp?.args ?? [])].join(' ')
          const items = source.kind === 'mcp' ? [
            { key: 'test', label: t('extensions.test'), icon: <PlugZap size={15} /> },
            ...(source.mcp?.auth === 'oauth' ? [{ key: 'login', label: t(source.auth_state === 'authorized' ? 'extensions.relogin' : 'extensions.login'), icon: <LogIn size={15} /> }] : []),
            ...(source.enabled ? [{ key: 'reconnect', label: t('extensions.reconnect'), icon: <RefreshCw size={15} /> }] : []),
          ] : [{ key: 'update', label: t('extensions.updateSkill'), icon: <RefreshCw size={15} /> }]
          return <li key={source.id} className={styles.row} aria-busy={busy === source.id}>
            <span className={styles.icon}>{source.kind === 'skill' ? <BookOpen size={20} /> : <Unplug size={20} />}</span>
            <div className={styles.identity}><button className={styles.name} onClick={() => onInspect(source)}>{source.name}</button>
              <p title={description}>{description || t('extensions.noDescription')}</p>
              <div className={styles.meta}><span>{source.kind === 'skill' ? t('extensions.fileCount', { count: source.skill?.files.length ?? 0 }) : t(source.mcp?.transport === 'http' ? 'extensions.remoteHTTP' : source.mcp?.mode === 'managed_npm' ? 'mcpPreparation.managed' : 'extensions.localProcess')}</span>
                {source.kind === 'mcp' && <Tooltip title={connection?.diagnostic?.message}><span className={styles.connection} data-connected={source.enabled && connection?.state === 'connected' || undefined}>{t(status)}</span></Tooltip>}</div>
            </div>
            <div className={styles.controls}>
              <Switch size="small" checked={source.enabled} loading={toggling && busy === source.id} disabled={Boolean(busy)} aria-label={`${t('extensions.enabled')} ${source.name}`} onChange={value => onToggle(source, value)} />
              <Button type="text" icon={source.kind === 'mcp' ? <Settings2 size={16} /> : <Files size={16} />} disabled={Boolean(busy)} onClick={() => source.kind === 'mcp' ? onAction(source, 'edit') : onInspect(source)}>{t(source.kind === 'mcp' ? 'extensions.configure' : 'extensions.viewFiles')}</Button>
              <Dropdown trigger={['click']} placement="bottomRight" classNames={{ root: contextActionMenuPopupClassName }} menu={{ rootClassName: contextActionMenuPopupClassName, items: [...items, { type: 'divider' }, { key: 'remove', label: t('extensions.delete'), icon: <Trash2 size={15} />, danger: true }], onClick: ({ key }) => onAction(source, key as IntegrationSourceAction) }}>
                <Button type="text" aria-label={`${t('extensions.moreActions')} ${source.name}`} aria-haspopup="menu" icon={<Ellipsis size={17} />} disabled={Boolean(busy)} />
              </Dropdown>
            </div>
          </li>
        })}
      </ul>}
    {values.length > 12 && <Pagination className={styles.pagination} size="small" current={currentPage} pageSize={12} total={values.length} showSizeChanger={false} onChange={setPage} />}
  </div>
}
