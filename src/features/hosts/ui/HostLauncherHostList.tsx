import { Empty } from 'antd'
import { ChevronDown, ChevronRight, Star } from 'lucide-react'
import type { KeyboardEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AuthMethodBadge,
  HostAvatar,
  type HostReachability,
} from '#entities/host'
import type {
  HostLauncherGroup,
  LauncherFilter,
} from '../model/hostLauncherListModel.ts'
import { HostReachabilityDot } from './HostLauncherDetailParts.tsx'

interface HostLauncherHostListProps {
  filter: LauncherFilter
  groups: HostLauncherGroup[]
  filteredCount: number
  totalCount: number
  collapsedGroupIds: ReadonlySet<string>
  selectedHostId?: string
  focusableHostId?: string
  hostReachability: Record<string, HostReachability>
  getHostIconUrl: (iconId: string) => string
  onKeyDown: KeyboardEventHandler<HTMLDivElement>
  onToggleGroup: (groupId: string) => void
  onSelectHost: (hostId: string) => void
  onRunPrimary: (hostId: string) => void
}

export function HostLauncherHostList({
  filter,
  groups,
  filteredCount,
  totalCount,
  collapsedGroupIds,
  selectedHostId,
  focusableHostId,
  hostReachability,
  getHostIconUrl,
  onKeyDown,
  onToggleGroup,
  onSelectHost,
  onRunPrimary,
}: HostLauncherHostListProps) {
  const { t } = useTranslation()
  return (
    <div
      className="host-launcher-list"
      role={filteredCount === 0 ? 'status' : 'listbox'}
      aria-label={filteredCount === 0 ? undefined : t('workbench.hostLauncher.hostList')}
      onKeyDown={onKeyDown}
    >
      {filteredCount === 0 ? (
        <div className="host-launcher-empty">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <span className="host-launcher-empty-copy">
                <strong>{t('hosts.filterResult', { count: 0, total: totalCount })}</strong>
              </span>
            )}
          />
        </div>
      ) : (
        groups.map((group) => {
          const flat = filter === 'recent'
          const collapsed = !flat && collapsedGroupIds.has(group.id)
          const GroupIcon = collapsed ? ChevronRight : ChevronDown
          return (
            <section className={`host-launcher-group ${flat ? 'is-flat' : ''} ${collapsed ? 'is-collapsed' : ''}`} key={group.id}>
              {!flat ? (
                <button
                  type="button"
                  className="host-launcher-group-title"
                  aria-expanded={!collapsed}
                  onClick={() => onToggleGroup(group.id)}
                >
                  <span>
                    <GroupIcon size={14} aria-hidden="true" />
                    {group.name}
                  </span>
                  <small>{group.hosts.length}</small>
                </button>
              ) : null}
              {flat || !collapsed ? (
                <div className="host-launcher-group-tree">
                  {group.hosts.map((host) => (
                    <button
                      key={host.id}
                      type="button"
                      className={`host-launcher-row ${host.id === selectedHostId ? 'is-active' : ''}`}
                      role="option"
                      data-host-id={host.id}
                      aria-selected={host.id === selectedHostId}
                      tabIndex={host.id === focusableHostId ? 0 : -1}
                      onClick={() => onSelectHost(host.id)}
                      onDoubleClick={() => onRunPrimary(host.id)}
                    >
                      <span className="host-launcher-row-avatar-wrap">
                        <HostAvatar host={host} getIconUrl={getHostIconUrl} className="host-launcher-row-avatar" size={30} iconSize={15} />
                        <HostReachabilityDot
                          state={defaultHostReachability(host, hostReachability)}
                          usesProxy={Boolean(host.defaultSSHProfile?.proxy_id)}
                        />
                      </span>
                      <span className="host-launcher-row-copy">
                        <strong>
                          {host.name}
                          {host.favorite ? <Star size={12} aria-label={t('workbench.hostLauncher.favorite')} /> : null}
                        </strong>
                        <small>{host.defaultSSHProfile?.address ?? t('hosts.access.ssh.empty')}</small>
                      </span>
                      <span className="host-launcher-row-meta">
                        {host.defaultSSHProfile ? (
                          <>
                            <AuthMethodBadge method={host.defaultSSHProfile.auth_method} compact />
                            <small>{host.defaultSSHProfile.username}</small>
                          </>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          )
        })
      )}
    </div>
  )
}

function defaultHostReachability(
  host: HostLauncherGroup['hosts'][number],
  reachabilityByHostId: Record<string, HostReachability>,
) {
  const candidate = reachabilityByHostId[host.id]
  return host.defaultSSHProfile && candidate?.ssh_profile_id === host.defaultSSHProfile.id
    ? candidate
    : undefined
}
