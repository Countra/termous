import { Button, Input, Tooltip } from 'antd'
import { ChevronLeft, ChevronRight, KeyRound, MapPin, Search, Tags, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthMethodBadge, HostAvatar, type Host, type HostGroup } from '#entities/host'
import { EmptyState, sidePanelStyles } from '#shared/ui'
import styles from './HostContextPanel.module.scss'

interface HostContextPanelProps {
  hosts: Host[]
  groups: HostGroup[]
  selectedHostId?: string
  collapsed: boolean
  title?: string
  collapsedTitle: string
  subtitle?: string
  emptyDescription: string
  searchPlaceholder?: string
  className?: string
  contentBefore?: ReactNode
  resizing?: boolean
  onToggleCollapsed: () => void
  onResizePointerDown?: (event: PointerEvent<HTMLDivElement>) => void
  getHostIconUrl?: (iconId: string) => string
  onSelectHost: (hostId: string) => void
}

const contentExpandDelayMs = 0

export function HostContextPanel({
  hosts,
  groups,
  selectedHostId,
  collapsed,
  title,
  collapsedTitle,
  subtitle,
  emptyDescription,
  searchPlaceholder,
  className = '',
  contentBefore,
  resizing = false,
  onToggleCollapsed,
  onResizePointerDown,
  getHostIconUrl,
  onSelectHost,
}: HostContextPanelProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [expandedContentReady, setExpandedContentReady] = useState(!collapsed)
  const contentCollapsed = collapsed || !expandedContentReady

  useEffect(() => {
    if (collapsed) {
      setExpandedContentReady(false)
      return undefined
    }

    const timer = window.setTimeout(() => setExpandedContentReady(true), contentExpandDelayMs)
    return () => window.clearTimeout(timer)
  }, [collapsed])

  const visibleHosts = useMemo(() => {
    const normalizedQuery = contentCollapsed ? '' : query.trim().toLowerCase()
    if (!normalizedQuery) {
      return hosts
    }
    return hosts.filter((host) =>
      [host.name, host.address, host.username, ...(host.tags ?? [])].join(' ').toLowerCase().includes(normalizedQuery),
    )
  }, [contentCollapsed, hosts, query])
  const groupedHosts = useMemo(() => groupHosts(visibleHosts, groups), [groups, visibleHosts])
  const showHeading = contentCollapsed || Boolean(title || subtitle)

  return (
    <aside
      className={`${styles['context-panel']} ${styles['host-context-panel']} ${sidePanelStyles.panel} host-context-panel ${
        collapsed ? `${styles['is-collapsed']} ${sidePanelStyles['is-collapsed']} is-collapsed` : ''
      } ${contentCollapsed ? styles['is-content-collapsed'] : ''} ${
        resizing ? sidePanelStyles['is-resizing'] : ''
      } ${className}`.trim()}
    >
      {onResizePointerDown ? (
        <div
          className={`${sidePanelStyles['resize-edge']} ${sidePanelStyles['resize-edge-right']}`}
          aria-hidden="true"
          onPointerDown={onResizePointerDown}
        />
      ) : null}
      <Tooltip title={collapsed ? t('app.expand') : t('app.collapse')} destroyOnHidden mouseLeaveDelay={0}>
        <Button
          type="text"
          className={`${sidePanelStyles['panel-side-toggle']} ${sidePanelStyles['panel-side-toggle-left']}`}
          onClick={() => {
            onToggleCollapsed()
          }}
          aria-label={collapsed ? t('app.expand') : t('app.collapse')}
          icon={collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        />
      </Tooltip>
      {showHeading ? (
        <div className={`${styles['panel-heading']} panel-heading`}>
          <div className={`${styles['panel-title-copy']} panel-title-copy`}>
            <h2>{contentCollapsed ? collapsedTitle : title}</h2>
            {!contentCollapsed && subtitle ? <span>{subtitle}</span> : null}
          </div>
        </div>
      ) : null}
      {!contentCollapsed && contentBefore ? (
        <div className={styles['content-before']}>{contentBefore}</div>
      ) : null}
      {!contentCollapsed && searchPlaceholder ? (
        <Input
          id="host-context-search"
          name="host-context-search"
          className={`${styles['host-context-search']} host-search-input host-context-search termous-search-input`}
          value={query}
          allowClear
          variant="borderless"
          onChange={(event) => setQuery(event.target.value)}
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder={searchPlaceholder}
        />
      ) : null}
      {hosts.length === 0 && contentCollapsed ? null : hosts.length === 0 ? (
        <EmptyState title={t('app.empty')} description={emptyDescription} />
      ) : visibleHosts.length === 0 && contentCollapsed ? null : visibleHosts.length === 0 ? (
        <EmptyState title={t('hosts.noFilterResults')} description={t('hosts.noFilterResultsHint')} />
      ) : (
        <div className={`${styles['host-stack']} host-stack`}>
          {Object.entries(groupedHosts).map(([group, items]) => (
            <div className={`${styles['host-group-block']} host-group-block`} key={group}>
              {!contentCollapsed ? <span className={`${styles['group-label']} group-label`}>{group || t('hosts.ungrouped')}</span> : null}
              {items.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  active={host.id === selectedHostId}
                  collapsed={contentCollapsed}
                  getHostIconUrl={getHostIconUrl}
                  onSelect={() => onSelectHost(host.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}

function HostRow({
  host,
  active,
  collapsed,
  getHostIconUrl,
  onSelect,
}: {
  host: Host
  active: boolean
  collapsed: boolean
  getHostIconUrl?: (iconId: string) => string
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const authLabel = t(`hosts.auth.${host.auth_method}`)
  const endpoint = `${host.address}:${host.port}`
  const tooltip = (
    <div className={`${styles['host-row-tooltip-card']} host-row-tooltip-card`}>
      <div className={`${styles['host-row-tooltip-head']} host-row-tooltip-head`}>
        <HostAvatar
          host={host}
          getIconUrl={getHostIconUrl}
          className={`${styles['host-row-tooltip-icon']} host-row-tooltip-icon`}
          size={34}
          iconSize={16}
        />
        <span className={`${styles['host-row-tooltip-title']} host-row-tooltip-title`}>
          <strong>{host.name}</strong>
          <small>{endpoint}</small>
        </span>
      </div>
      <div className={`${styles['host-row-tooltip-meta']} host-row-tooltip-meta`}>
        <span>
          <UserRound size={13} />
          <strong>{host.username}</strong>
        </span>
        <span>
          <KeyRound size={13} />
          <strong>{authLabel}</strong>
        </span>
      </div>
      {host.tags.length > 0 ? (
        <div className={`${styles['host-row-tooltip-tags']} host-row-tooltip-tags`}>
          <span>
            <Tags size={13} />
            {t('hosts.tags')}
          </span>
          <div>
            {host.tags.map((tag) => (
              <em key={tag}>{tag}</em>
            ))}
          </div>
        </div>
      ) : null}
      <div className={`${styles['host-row-tooltip-endpoint']} host-row-tooltip-endpoint`}>
        <MapPin size={13} />
        <code>
          {host.username}@{endpoint}
        </code>
      </div>
    </div>
  )
  return (
    <Tooltip
      title={tooltip}
      placement="right"
      arrow={false}
      mouseEnterDelay={0.25}
      classNames={{ root: `${styles['host-row-tooltip']} host-row-tooltip` }}
    >
      <button
        type="button"
        className={`${styles['host-row']} host-row ${active ? `${styles['is-active']} is-active` : ''} ${collapsed ? `${styles['is-compact']} is-compact` : ''}`}
        onClick={onSelect}
        aria-label={`${host.name} ${host.username}@${host.address}:${host.port} ${authLabel}`}
      >
        <HostAvatar host={host} getIconUrl={getHostIconUrl} size={30} iconSize={collapsed ? 17 : 15} />
        {!collapsed ? (
          <>
            <span className={`${styles['host-main']} host-main`}>
              <strong>{host.name}</strong>
              <small>
                {host.username}@{host.address}:{host.port}
              </small>
            </span>
            <AuthMethodBadge method={host.auth_method} />
          </>
        ) : null}
      </button>
    </Tooltip>
  )
}

function groupHosts(hosts: Host[], groups: HostGroup[]) {
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  return hosts.reduce<Record<string, Host[]>>((acc, host) => {
    const key = groupNames.get(host.group_id) ?? ''
    acc[key] = acc[key] ?? []
    acc[key].push(host)
    return acc
  }, {})
}
