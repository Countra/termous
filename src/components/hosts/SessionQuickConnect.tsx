import { Search, Star } from 'lucide-react'
import { Input, Popover } from 'antd'
import { useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Host } from '../../types/domain'
import { AuthMethodBadge } from '../ui/AuthMethodBadge'
import { SessionNewTabButton } from '../ui/SessionNewTabButton'
import { HostAvatar } from './HostAvatar'

export interface SessionQuickConnectProps {
  hosts: Host[]
  actionBusy?: boolean
  triggerLabel: string
  open: boolean
  query: string
  onOpenChange: (open: boolean) => void
  onQueryChange: (query: string) => void
  onConnect: (hostId: string) => Promise<void>
  getHostIconUrl: (iconId: string) => string
}

export function SessionQuickConnect({
  hosts,
  actionBusy = false,
  triggerLabel,
  open,
  query,
  onOpenChange,
  onQueryChange,
  onConnect,
  getHostIconUrl,
}: SessionQuickConnectProps) {
  const [connecting, setConnecting] = useState(false)
  const connectingRef = useRef(false)
  const filteredHosts = useMemo(
    () => filterQuickConnectHosts(hosts, query),
    [hosts, query],
  )
  const busy = actionBusy || connecting

  const connectHost = useCallback(
    async (hostId: string) => {
      if (actionBusy || connectingRef.current) {
        return
      }
      connectingRef.current = true
      setConnecting(true)
      try {
        await onConnect(hostId)
      } finally {
        connectingRef.current = false
        setConnecting(false)
      }
    },
    [actionBusy, onConnect],
  )

  return (
    <Popover
      open={open}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      classNames={{ root: 'session-quick-connect-popover' }}
      onOpenChange={onOpenChange}
      content={(
        <QuickConnectHostPanel
          hosts={filteredHosts}
          totalCount={hosts.length}
          query={query}
          actionBusy={busy}
          onQueryChange={onQueryChange}
          onConnect={connectHost}
          getHostIconUrl={getHostIconUrl}
        />
      )}
    >
      <SessionNewTabButton label={triggerLabel} active={open} busy={connecting} />
    </Popover>
  )
}

function QuickConnectHostPanel({
  hosts,
  totalCount,
  query,
  actionBusy,
  onQueryChange,
  onConnect,
  getHostIconUrl,
}: {
  hosts: Host[]
  totalCount: number
  query: string
  actionBusy: boolean
  onQueryChange: (value: string) => void
  onConnect: (hostId: string) => Promise<void>
  getHostIconUrl: (iconId: string) => string
}) {
  const { t } = useTranslation()
  const searchInputId = useId()
  const emptyTitle = totalCount === 0 ? t('workbench.quickConnect.empty') : t('workbench.quickConnect.noResults')

  return (
    <section className="session-quick-connect" aria-label={t('workbench.quickConnect.title')}>
      <Input
        id={searchInputId}
        name="session-quick-connect-search"
        className="termous-search-input session-quick-connect-search"
        value={query}
        allowClear
        variant="borderless"
        prefix={<Search size={14} aria-hidden="true" />}
        placeholder={t('workbench.quickConnect.search')}
        onChange={(event) => onQueryChange(event.target.value)}
        onPressEnter={() => {
          if (hosts.length === 1 && !actionBusy) {
            void onConnect(hosts[0].id)
          }
        }}
      />
      <div className="session-quick-connect-list" role="listbox" aria-label={t('workbench.quickConnect.hostList')}>
        {hosts.length === 0 ? (
          <div className="session-quick-connect-empty">{emptyTitle}</div>
        ) : (
          hosts.map((host) => (
            <button
              key={host.id}
              type="button"
              className="session-quick-connect-row"
              role="option"
              disabled={actionBusy}
              onClick={() => void onConnect(host.id)}
            >
              <HostAvatar host={host} getIconUrl={getHostIconUrl} className="session-quick-connect-host-icon" size={28} iconSize={15} />
              <span className="session-quick-connect-copy">
                <strong>
                  {host.name}
                  {host.favorite ? <Star size={12} aria-label={t('workbench.hostLauncher.favorite')} /> : null}
                </strong>
                <small>{host.username}@{host.address}:{host.port}</small>
              </span>
              <span className="session-quick-connect-meta">
                <AuthMethodBadge method={host.auth_method} compact />
              </span>
            </button>
          ))
        )}
      </div>
      <footer className="session-quick-connect-footer">
        <small>{t('workbench.quickConnect.count', { count: totalCount })}</small>
      </footer>
    </section>
  )
}

function filterQuickConnectHosts(hosts: Host[], query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = tokens.length === 0
    ? hosts
    : hosts.filter((host) => {
      const searchable = [
        host.name,
        host.address,
        host.username,
        host.group_id,
        host.auth_method,
        ...(host.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
      return tokens.every((token) => searchable.includes(token))
    })

  return filtered.slice().sort((left, right) => {
    if (left.favorite !== right.favorite) {
      return left.favorite ? -1 : 1
    }
    const rightConnectedAt = readHostConnectedAt(right)
    const leftConnectedAt = readHostConnectedAt(left)
    if (rightConnectedAt !== leftConnectedAt) {
      return rightConnectedAt - leftConnectedAt
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function readHostConnectedAt(host: Host) {
  if (!host.last_connected_at) {
    return 0
  }
  const value = new Date(host.last_connected_at).getTime()
  return Number.isNaN(value) ? 0 : value
}
