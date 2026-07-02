import { Button, Input, Modal, Segmented, Select, Tag, Tooltip } from 'antd'
import {
  Activity,
  Cable,
  Edit3,
  FolderOpen,
  Globe2,
  Network,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Star,
  Tags,
  WifiOff,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthMethodBadge } from '../../components/ui/AuthMethodBadge'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { EmptyState } from '../../components/ui/EmptyState'
import type { AppData, Host, HostReachability } from '../../types/domain'

type LauncherFilter = 'all' | 'online' | 'offline' | 'favorite' | 'tags'
type LauncherPlatformFilter = 'all' | Host['platform']

interface HostLauncherModalProps {
  open: boolean
  data: AppData
  selectedHostId: string
  actionBusy: boolean
  onClose: () => void
  onSelectHost: (hostId: string) => void
  onConnect: (hostId: string) => Promise<void>
  onCreateHost: () => void
  onEditHost: (hostId: string) => void
  onOpenFiles: (hostId: string) => Promise<void>
  onOpenForward: (hostId: string) => void
  onToggleFavorite: (hostId: string) => Promise<void>
  onRefreshReachability: (hostIds?: string[], force?: boolean) => Promise<void>
}

export function HostLauncherModal({
  open,
  data,
  selectedHostId,
  actionBusy,
  onClose,
  onSelectHost,
  onConnect,
  onCreateHost,
  onEditHost,
  onOpenFiles,
  onOpenForward,
  onToggleFavorite,
  onRefreshReachability,
}: HostLauncherModalProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LauncherFilter>('all')
  const [platformFilter, setPlatformFilter] = useState<LauncherPlatformFilter>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [refreshingReachability, setRefreshingReachability] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const refreshReachabilityRef = useRef(onRefreshReachability)
  const groupsById = useMemo(() => new Map(data.groups.map((group) => [group.id, group.name])), [data.groups])
  const credentialsById = useMemo(() => new Map(data.credentials.map((credential) => [credential.id, credential.name])), [data.credentials])
  const hostsById = useMemo(() => new Map(data.hosts.map((host) => [host.id, host])), [data.hosts])
  const availableTags = useMemo(() => buildTagOptions(data.hosts), [data.hosts])
  const filteredHosts = useMemo(
    () => filterHosts(data.hosts, groupsById, data.hostReachability, query, filter, platformFilter, selectedTags),
    [data.hostReachability, data.hosts, filter, groupsById, platformFilter, query, selectedTags],
  )
  const groupedHosts = useMemo(() => groupHosts(filteredHosts, data.groups, t('hosts.ungrouped')), [data.groups, filteredHosts, t])
  const selectedHost = hostsById.get(selectedHostId) ?? filteredHosts[0] ?? data.hosts[0]
  const selectedHostCredential = selectedHost?.credential_id ? credentialsById.get(selectedHost.credential_id) : ''
  const selectedJumpHost = selectedHost?.jump_host_id ? hostsById.get(selectedHost.jump_host_id) : undefined
  const selectedReachability = selectedHost ? data.hostReachability[selectedHost.id] : undefined

  useEffect(() => {
    refreshReachabilityRef.current = onRefreshReachability
  }, [onRefreshReachability])

  useEffect(() => {
    if (!open) {
      return
    }
    const nextHost = hostsById.get(selectedHostId) ?? filteredHosts[0] ?? data.hosts[0]
    if (nextHost && nextHost.id !== selectedHostId) {
      onSelectHost(nextHost.id)
    }
  }, [data.hosts, filteredHosts, hostsById, onSelectHost, open, selectedHostId])

  useEffect(() => {
    if (!open || data.hosts.length === 0) {
      return
    }
    let disposed = false
    setRefreshingReachability(true)
    void refreshReachabilityRef.current(data.hosts.map((host) => host.id), false)
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) {
          setRefreshingReachability(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [data.hosts, open])

  const connectHost = async (hostId: string) => {
    if (!hostId || submitting || actionBusy) {
      return
    }
    setSubmitting(true)
    try {
      await onConnect(hostId)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const connectSelectedHost = () => {
    if (!selectedHost) {
      return
    }
    return connectHost(selectedHost.id)
  }

  const runShortcut = async (action: () => void | Promise<void>) => {
    if (!selectedHost) {
      return
    }
    await action()
    onClose()
  }

  const runGlobalShortcut = async (action: () => void | Promise<void>) => {
    await action()
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClose()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void connectSelectedHost()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }
    event.preventDefault()
    if (filteredHosts.length === 0) {
      return
    }
    const currentIndex = Math.max(0, filteredHosts.findIndex((host) => host.id === selectedHost?.id))
    const delta = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = (currentIndex + delta + filteredHosts.length) % filteredHosts.length
    onSelectHost(filteredHosts[nextIndex].id)
  }

  const toggleTag = (tag: string, checked: boolean) => {
    setFilter('tags')
    setSelectedTags((current) => {
      const key = tagKey(tag)
      if (checked) {
        return current.some((item) => tagKey(item) === key) ? current : [...current, tag]
      }
      return current.filter((item) => tagKey(item) !== key)
    })
  }

  return (
    <Modal
      centered
      open={open}
      width={920}
      footer={null}
      title={null}
      onCancel={onClose}
      className="host-launcher-modal termous-modal"
      rootClassName="termous-modal-root"
    >
      <section className="host-launcher" tabIndex={-1} onKeyDown={handleKeyDown}>
        <aside className="host-launcher-sidebar">
          <div className="host-launcher-heading">
            <div>
              <span>{t('workbench.hostLauncher.kicker')}</span>
              <h2>{t('workbench.hostLauncher.title')}</h2>
            </div>
            <Tooltip title={t('workbench.hostLauncher.refreshReachability')}>
              <Button
                type="text"
                className="host-launcher-icon-button"
                aria-label={t('workbench.hostLauncher.refreshReachability')}
                loading={refreshingReachability}
                icon={<RefreshCcw size={17} />}
                onClick={() => void onRefreshReachability(data.hosts.map((host) => host.id), true)}
              />
            </Tooltip>
          </div>
          <Input
            id="workbench-host-launcher-search"
            name="workbench-host-launcher-search"
            className="termous-search-input host-launcher-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            allowClear
            variant="borderless"
            prefix={<Search size={15} aria-hidden="true" />}
            placeholder={t('workbench.hostLauncher.search')}
          />
          <Segmented
            block
            className="host-launcher-filter"
            value={filter}
            onChange={(value) => setFilter(value as LauncherFilter)}
            options={[
              { value: 'all', label: t('workbench.hostLauncher.filters.all') },
              { value: 'online', label: t('workbench.hostLauncher.filters.online') },
              { value: 'offline', label: t('workbench.hostLauncher.filters.offline') },
              { value: 'favorite', label: t('workbench.hostLauncher.filters.favorite') },
              { value: 'tags', label: t('workbench.hostLauncher.filters.tags') },
            ]}
          />
          <div className="host-launcher-platform-filter">
            <Select
              value={platformFilter}
              className="termous-select host-launcher-platform-select"
              classNames={{ popup: { root: 'termous-select-popup' } }}
              optionLabelProp="label"
              onChange={(value) => setPlatformFilter(value as LauncherPlatformFilter)}
              options={[
                { value: 'all', label: t('workbench.hostLauncher.platformAll') },
                { value: 'linux', label: t('hosts.platform.linux') },
              ]}
            />
          </div>
          {availableTags.length > 0 ? (
            <div className="host-launcher-tags" aria-label={t('hosts.allTags')}>
              {availableTags.map((tag) => (
                <Tag.CheckableTag
                  key={tag.key}
                  className="host-filter-chip"
                  checked={selectedTags.some((item) => tagKey(item) === tag.key)}
                  onChange={(checked) => toggleTag(tag.label, checked)}
                >
                  <span>{tag.label}</span>
                  <small>{tag.count}</small>
                </Tag.CheckableTag>
              ))}
            </div>
          ) : null}
          <div className="host-launcher-list" role="listbox" aria-label={t('workbench.hostLauncher.hostList')}>
            {filteredHosts.length === 0 ? (
              <div className="host-launcher-empty">
                <EmptyState
                  title={data.hosts.length === 0 ? t('app.empty') : t('hosts.noFilterResults')}
                  description={data.hosts.length === 0 ? t('workbench.hostLauncher.emptyHint') : t('hosts.noFilterResultsHint')}
                />
              </div>
            ) : (
              groupedHosts.map((group) => (
                <section className="host-launcher-group" key={group.id}>
                  <div className="host-launcher-group-title">
                    <span>{group.name}</span>
                    <small>{group.hosts.length}</small>
                  </div>
                  {group.hosts.map((host) => (
                    <button
                      key={host.id}
                      type="button"
                      className={`host-launcher-row ${host.id === selectedHost?.id ? 'is-active' : ''}`}
                      role="option"
                      aria-selected={host.id === selectedHost?.id}
                      onClick={() => onSelectHost(host.id)}
                      onDoubleClick={() => void connectHost(host.id)}
                    >
                      <HostReachabilityDot state={data.hostReachability[host.id]} />
                      <span className="host-launcher-row-copy">
                        <strong>
                          {host.name}
                          {host.favorite ? <Star size={12} aria-label={t('workbench.hostLauncher.favorite')} /> : null}
                        </strong>
                        <small>{host.address}</small>
                      </span>
                      <span className="host-launcher-row-meta">
                        <AuthMethodBadge method={host.auth_method} compact />
                        <small>{host.username}</small>
                      </span>
                    </button>
                  ))}
                </section>
              ))
            )}
          </div>
          <Button className="secondary-button host-launcher-create-button" icon={<Plus size={15} />} onClick={() => void runGlobalShortcut(onCreateHost)}>
            {t('hosts.addHost')}
          </Button>
        </aside>

        <main className="host-launcher-detail">
          {selectedHost ? (
            <>
              <div className="host-launcher-hero">
                <span className={`host-launcher-hero-icon is-${selectedReachability?.status ?? 'unknown'}`}>
                  <Server size={28} aria-hidden="true" />
                </span>
                <div>
                  <div className="host-launcher-hero-title">
                    <h3>{selectedHost.name}</h3>
                    <Tooltip title={selectedHost.favorite ? t('workbench.hostLauncher.unfavorite') : t('workbench.hostLauncher.favorite')}>
                      <Button
                        type="text"
                        className={`host-launcher-favorite ${selectedHost.favorite ? 'is-active' : ''}`}
                        aria-label={selectedHost.favorite ? t('workbench.hostLauncher.unfavorite') : t('workbench.hostLauncher.favorite')}
                        icon={<Star size={17} fill={selectedHost.favorite ? 'currentColor' : 'none'} />}
                        disabled={actionBusy}
                        onClick={() => void onToggleFavorite(selectedHost.id)}
                      />
                    </Tooltip>
                  </div>
                  <p>{selectedHost.username}@{selectedHost.address}:{selectedHost.port}</p>
                  <div className="host-launcher-hero-meta">
                    <HostReachabilityPill state={selectedReachability} />
                    <AuthMethodBadge method={selectedHost.auth_method} />
                  </div>
                </div>
              </div>
              <dl className="host-launcher-detail-grid">
                <DetailItem label={t('hosts.address')} value={`${selectedHost.address}:${selectedHost.port}`} />
                <DetailItem label={t('hosts.platform.label')} value={t('hosts.platform.linux')} />
                <DetailItem
                  label={t('workbench.credential')}
                  value={selectedHost.auth_method === 'system' ? t('hosts.systemAuth') : selectedHostCredential || t('fields.none')}
                />
                <DetailItem label={t('workbench.hostLauncher.latency')} value={formatReachabilityLatency(selectedReachability, t)} />
                <DetailItem label={t('hosts.group')} value={groupsById.get(selectedHost.group_id) || t('hosts.ungrouped')} />
                <DetailItem label={t('workbench.jumpHost')} value={selectedJumpHost?.name ?? t('fields.none')} />
                <DetailItem label={t('workbench.hostLauncher.lastConnected')} value={formatDateTime(selectedHost.last_connected_at, t('fields.none'))} />
                <DetailItem label={t('workbench.hostLauncher.lastChecked')} value={formatDateTime(selectedReachability?.checked_at, t('fields.none'))} />
                <DetailItem label={t('hosts.note')} value={selectedHost.note || t('fields.none')} wide />
              </dl>
              {selectedHost.tags.length > 0 ? (
                <div className="host-launcher-detail-tags">
                  <Tags size={14} aria-hidden="true" />
                  {selectedHost.tags.map((tag) => (
                    <span key={tagKey(tag)}>{tag}</span>
                  ))}
                </div>
              ) : null}
              <div className="host-launcher-shortcuts">
                <Button className="secondary-button" icon={<Edit3 size={15} />} onClick={() => runShortcut(() => onEditHost(selectedHost.id))}>
                  {t('workbench.hostLauncher.editHost')}
                </Button>
                <Button className="secondary-button" icon={<FolderOpen size={15} />} onClick={() => runShortcut(() => onOpenFiles(selectedHost.id))}>
                  {t('workbench.hostLauncher.openFiles')}
                </Button>
                <Button className="secondary-button" icon={<Network size={15} />} onClick={() => runShortcut(() => onOpenForward(selectedHost.id))}>
                  {t('workbench.hostLauncher.openForward')}
                </Button>
              </div>
              <ConnectionActionButton
                block
                size="large"
                icon={<Cable size={17} />}
                loading={submitting}
                disabled={actionBusy}
                onClick={() => void connectSelectedHost()}
              >
                {t('app.connect')}
              </ConnectionActionButton>
            </>
          ) : (
            <div className="host-launcher-detail-empty">
              <EmptyState title={t('app.empty')} description={t('workbench.hostLauncher.emptyHint')} />
              <ConnectionActionButton icon={<Plus size={16} />} onClick={() => void runGlobalShortcut(onCreateHost)}>
                {t('hosts.addHost')}
              </ConnectionActionButton>
            </div>
          )}
        </main>
      </section>
    </Modal>
  )
}

function DetailItem({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'is-wide' : ''}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function HostReachabilityDot({ state }: { state?: HostReachability }) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  return (
    <Tooltip title={reachabilityTooltip(state, t)}>
      <span className={`host-reachability-dot is-${status}`} aria-label={reachabilityTooltip(state, t)} />
    </Tooltip>
  )
}

function HostReachabilityPill({ state }: { state?: HostReachability }) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  const Icon = status === 'online' ? Activity : status === 'checking' ? RefreshCcw : status === 'offline' ? WifiOff : Globe2
  return (
    <Tooltip title={reachabilityTooltip(state, t)}>
      <span className={`host-reachability-pill is-${status}`}>
        <Icon size={13} aria-hidden="true" />
        <span>{t(`workbench.hostLauncher.reachability.${status}`)}</span>
      </span>
    </Tooltip>
  )
}

function filterHosts(
  hosts: Host[],
  groupsById: Map<string, string>,
  reachabilityByHostId: Record<string, HostReachability>,
  query: string,
  filter: LauncherFilter,
  platformFilter: LauncherPlatformFilter,
  selectedTags: string[],
) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const selectedTagKeys = selectedTags.map(tagKey)
  const filtered = hosts.filter((host) => {
    const reachability = reachabilityByHostId[host.id]
    const reachabilityStatus = reachability?.status ?? 'unknown'
    if (platformFilter !== 'all' && host.platform !== platformFilter) {
      return false
    }
    if (filter === 'online' && reachabilityStatus !== 'online') {
      return false
    }
    if (filter === 'offline' && reachabilityStatus !== 'offline' && reachabilityStatus !== 'unavailable') {
      return false
    }
    if (filter === 'favorite' && !host.favorite) {
      return false
    }
    const hostTags = host.tags ?? []
    const hostTagKeys = new Set(hostTags.map(tagKey))
    if ((filter === 'tags' || selectedTagKeys.length > 0) && selectedTagKeys.length > 0 && !selectedTagKeys.every((tag) => hostTagKeys.has(tag))) {
      return false
    }
    if (tokens.length === 0) {
      return true
    }
    const searchable = [
      host.name,
      host.address,
      host.username,
      String(host.port),
      host.note ?? '',
      groupsById.get(host.group_id) ?? '',
      hostTags.join(' '),
    ].join(' ').toLowerCase()
    return tokens.every((token) => searchable.includes(token))
  })
  return filtered.sort((left, right) => {
    if (left.favorite !== right.favorite) {
      return left.favorite ? -1 : 1
    }
    const recentDelta = timestamp(right.last_connected_at) - timestamp(left.last_connected_at)
    if (recentDelta !== 0) {
      return recentDelta
    }
    return left.name.localeCompare(right.name)
  })
}

function groupHosts(hosts: Host[], groups: AppData['groups'], fallbackGroupName: string) {
  const groupNames = new Map(groups.map((group) => [group.id, group.name]))
  const buckets = new Map<string, { id: string; name: string; hosts: Host[]; order: number }>()
  for (const host of hosts) {
    const id = host.group_id || '__ungrouped'
    if (!buckets.has(id)) {
      const groupIndex = groups.findIndex((group) => group.id === host.group_id)
      buckets.set(id, {
        id,
        name: groupNames.get(host.group_id) || fallbackGroupName,
        hosts: [],
        order: groupIndex >= 0 ? groupIndex : Number.MAX_SAFE_INTEGER,
      })
    }
    buckets.get(id)?.hosts.push(host)
  }
  return Array.from(buckets.values()).sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order
    }
    return left.name.localeCompare(right.name)
  })
}

function buildTagOptions(hosts: Host[]) {
  const map = new Map<string, { key: string; label: string; count: number }>()
  for (const host of hosts) {
    const seen = new Set<string>()
    for (const rawTag of host.tags ?? []) {
      const label = rawTag.trim()
      const key = tagKey(label)
      if (!label || seen.has(key)) {
        continue
      }
      seen.add(key)
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
      } else {
        map.set(key, { key, label, count: 1 })
      }
    }
  }
  return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label))
}

function tagKey(value: string) {
  return value.trim().toLowerCase()
}

function timestamp(value?: string) {
  if (!value) {
    return 0
  }
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function formatDateTime(value: string | undefined, fallback: string) {
  if (!value) {
    return fallback
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function reachabilityTooltip(
  state: HostReachability | undefined,
  t: (key: string, options?: Record<string, string | number>) => string,
) {
  const status = state?.status ?? 'unknown'
  if (status === 'online' && state?.latency_ms !== undefined) {
    return t('workbench.hostLauncher.reachabilityTooltip.online', { latency: state.latency_ms })
  }
  if ((status === 'offline' || status === 'unavailable') && state?.error_message) {
    return state.error_message
  }
  return t(`workbench.hostLauncher.reachabilityTooltip.${status}`)
}

function formatReachabilityLatency(
  state: HostReachability | undefined,
  t: (key: string, options?: Record<string, string | number>) => string,
) {
  if (!state || state.status === 'unknown') {
    return t('fields.none')
  }
  if (state.status === 'checking') {
    return t('workbench.hostLauncher.reachability.checking')
  }
  if (state.status !== 'online' || state.latency_ms === undefined) {
    return t('workbench.hostLauncher.reachability.offline')
  }
  return t('workbench.hostLauncher.latencyValue', { latency: state.latency_ms })
}
