import { Button, Input, Modal, Segmented, Select, Tag, Tooltip } from 'antd'
import {
  Activity,
  Cable,
  ChevronDown,
  ChevronRight,
  Clock3,
  Edit3,
  FolderOpen,
  Globe2,
  KeyRound,
  ListFilter,
  Network,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Star,
  Tags,
  UserRound,
  WifiOff,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { HostAvatar } from '../../components/hosts/HostAvatar'
import { AuthMethodBadge } from '../../components/ui/AuthMethodBadge'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { EmptyState } from '../../components/ui/EmptyState'
import type { AppData, Host, HostReachability } from '../../types/domain'
import {
  hostLauncherActionPlan,
  type HostLauncherActionId,
  type HostLauncherIntent,
} from './hostLauncherIntent'

type LauncherFilter = 'all' | 'recent' | 'online' | 'favorite'
type LauncherPlatformFilter = 'all' | Host['platform']
type LauncherAuthFilter = 'all' | Host['auth_method']
type LauncherGroupFilter = 'all' | '__ungrouped' | string

interface HostLauncherModalProps {
  open: boolean
  intent?: HostLauncherIntent
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
  getHostIconUrl: (iconId: string) => string
}

export function HostLauncherModal({
  open,
  intent = 'terminal',
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
  getHostIconUrl,
}: HostLauncherModalProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LauncherFilter>('all')
  const [platformFilter, setPlatformFilter] = useState<LauncherPlatformFilter>('all')
  const [groupFilter, setGroupFilter] = useState<LauncherGroupFilter>('all')
  const [authFilter, setAuthFilter] = useState<LauncherAuthFilter>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set())
  const [refreshingReachability, setRefreshingReachability] = useState(false)
  const [pendingHostAction, setPendingHostAction] = useState<HostLauncherActionId | null>(null)
  const pendingHostActionRef = useRef<HostLauncherActionId | null>(null)
  const refreshReachabilityRef = useRef(onRefreshReachability)
  const autoRefreshOpenRef = useRef(false)
  const filterAnchorRef = useRef<HTMLDivElement>(null)
  const groupsById = useMemo(() => new Map(data.groups.map((group) => [group.id, group.name])), [data.groups])
  const credentialsById = useMemo(() => new Map(data.credentials.map((credential) => [credential.id, credential.name])), [data.credentials])
  const hostsById = useMemo(() => new Map(data.hosts.map((host) => [host.id, host])), [data.hosts])
  const proxiesById = useMemo(() => new Map(data.proxies.map((proxy) => [proxy.id, proxy])), [data.proxies])
  const hostIds = useMemo(() => data.hosts.map((host) => host.id), [data.hosts])
  const availableTags = useMemo(() => buildTagOptions(data.hosts), [data.hosts])
  const groupOptions = useMemo(() => buildGroupFilterOptions(data.hosts, data.groups, t('hosts.ungrouped'), t('workbench.hostLauncher.filters.allGroups')), [data.groups, data.hosts, t])
  const filteredHosts = useMemo(
    () => filterHosts(data.hosts, groupsById, data.hostReachability, query, filter, platformFilter, groupFilter, authFilter, selectedTags),
    [authFilter, data.hostReachability, data.hosts, filter, groupFilter, groupsById, platformFilter, query, selectedTags],
  )
  const groupedHosts = useMemo(
    () => filter === 'recent'
      ? [{ id: '__recent', name: '', hosts: filteredHosts, order: 0 }]
      : groupHosts(filteredHosts, data.groups, t('hosts.ungrouped')),
    [data.groups, filter, filteredHosts, t],
  )
  const selectedHost = filteredHosts.find((host) => host.id === selectedHostId) ?? filteredHosts[0]
  const selectedHostCredential = selectedHost?.credential_id ? credentialsById.get(selectedHost.credential_id) : ''
  const selectedJumpHost = selectedHost?.jump_host_id ? hostsById.get(selectedHost.jump_host_id) : undefined
  const selectedProxy = selectedHost?.proxy_id ? proxiesById.get(selectedHost.proxy_id) : undefined
  const selectedReachability = selectedHost ? data.hostReachability[selectedHost.id] : undefined
  const activeAdvancedFilterCount = [
    platformFilter !== 'all',
    groupFilter !== 'all',
    authFilter !== 'all',
    selectedTags.length > 0,
  ].filter(Boolean).length
  const actionPlan = hostLauncherActionPlan(intent)
  const hostActionBusy = actionBusy || pendingHostAction !== null

  useEffect(() => {
    refreshReachabilityRef.current = onRefreshReachability
  }, [onRefreshReachability])

  useEffect(() => {
    if (!open) {
      setFilterOpen(false)
      return
    }
    const nextHost = filteredHosts.find((host) => host.id === selectedHostId) ?? filteredHosts[0]
    if (nextHost && nextHost.id !== selectedHostId) {
      onSelectHost(nextHost.id)
    }
  }, [filteredHosts, onSelectHost, open, selectedHostId])

  useEffect(() => {
    if (!open) {
      autoRefreshOpenRef.current = false
      setRefreshingReachability(false)
      return
    }
    if (autoRefreshOpenRef.current || hostIds.length === 0) {
      return
    }
    autoRefreshOpenRef.current = true
    let disposed = false
    setRefreshingReachability(true)
    void refreshReachabilityRef.current(hostIds, false)
      .catch(() => undefined)
      .finally(() => {
        if (!disposed) {
          setRefreshingReachability(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [hostIds, open])

  useEffect(() => {
    if (!filterOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && filterAnchorRef.current?.contains(target)) {
        return
      }
      if (target instanceof Element && target.closest('.termous-select-popup, .ant-select-dropdown')) {
        return
      }
      setFilterOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [filterOpen])

  const executeHostAction = async (actionId: HostLauncherActionId, hostId: string) => {
    if (actionId === 'connect') {
      await onConnect(hostId)
      return
    }
    if (actionId === 'openFiles') {
      await onOpenFiles(hostId)
      return
    }
    if (actionId === 'editHost') {
      onEditHost(hostId)
      return
    }
    onOpenForward(hostId)
  }

  const runHostAction = async (actionId: HostLauncherActionId, hostId: string) => {
    if (!hostId || actionBusy || pendingHostActionRef.current !== null) {
      return
    }
    pendingHostActionRef.current = actionId
    setPendingHostAction(actionId)
    try {
      await executeHostAction(actionId, hostId)
      onClose()
    } finally {
      pendingHostActionRef.current = null
      setPendingHostAction(null)
    }
  }

  const runSelectedPrimaryAction = () => {
    if (!selectedHost) {
      return
    }
    return runHostAction(actionPlan.primary, selectedHost.id)
  }

  const runGlobalShortcut = async (action: () => void | Promise<void>) => {
    await action()
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (filterOpen) {
        event.preventDefault()
        setFilterOpen(false)
        return
      }
      onClose()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      void runSelectedPrimaryAction()
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
    setSelectedTags((current) => {
      const key = tagKey(tag)
      if (checked) {
        return current.some((item) => tagKey(item) === key) ? current : [...current, tag]
      }
      return current.filter((item) => tagKey(item) !== key)
    })
  }

  const clearAdvancedFilters = () => {
    setPlatformFilter('all')
    setGroupFilter('all')
    setAuthFilter('all')
    setSelectedTags([])
  }

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const filterPanel = (
    <div className="host-launcher-filter-shell">
      <div className="host-launcher-filter-panel">
        <div className="host-launcher-filter-panel-head">
          <div>
            <span className="host-launcher-filter-panel-icon">
              <ListFilter size={15} aria-hidden="true" />
            </span>
            <span>{t('workbench.hostLauncher.filters.advanced')}</span>
          </div>
          <Button
            type="text"
            size="small"
            className="host-launcher-filter-clear"
            disabled={activeAdvancedFilterCount === 0}
            onClick={clearAdvancedFilters}
          >
            {t('hosts.clearFilters')}
          </Button>
        </div>
        <div className="host-launcher-filter-grid">
          <label className="host-launcher-filter-field">
            <span>{t('hosts.platform.label')}</span>
            <Select
              value={platformFilter}
              className="termous-select"
              classNames={{ popup: { root: 'termous-select-popup' } }}
              optionLabelProp="label"
              onChange={(value) => setPlatformFilter(value as LauncherPlatformFilter)}
              options={[
                { value: 'all', label: t('workbench.hostLauncher.platformAll') },
                { value: 'linux', label: t('hosts.platform.linux') },
              ]}
            />
          </label>
          <label className="host-launcher-filter-field">
            <span>{t('hosts.group')}</span>
            <Select
              value={groupFilter}
              className="termous-select"
              classNames={{ popup: { root: 'termous-select-popup' } }}
              optionLabelProp="label"
              onChange={(value) => setGroupFilter(value as LauncherGroupFilter)}
              options={groupOptions}
            />
          </label>
          <label className="host-launcher-filter-field">
            <span>{t('hosts.authMethod')}</span>
            <Select
              value={authFilter}
              className="termous-select"
              classNames={{ popup: { root: 'termous-select-popup' } }}
              optionLabelProp="label"
              onChange={(value) => setAuthFilter(value as LauncherAuthFilter)}
              options={[
                { value: 'all', label: t('workbench.hostLauncher.filters.allAuthMethods') },
                { value: 'password', label: t('hosts.auth.password') },
                { value: 'private_key', label: t('hosts.auth.private_key') },
              ]}
            />
          </label>
        </div>
        <div className="host-launcher-filter-tags">
          <span>{t('hosts.tags')}</span>
          {availableTags.length > 0 ? (
            <div className="host-launcher-filter-tag-list">
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
          ) : (
            <small>{t('fields.none')}</small>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <Modal
      centered
      open={open}
      width={920}
      footer={null}
      title={null}
      onCancel={onClose}
      className="host-launcher-modal termous-modal"
      rootClassName="termous-modal-root host-launcher-modal-root"
    >
      <section className="host-launcher" tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="host-launcher-titlebar">
          <span className="host-launcher-title">
            {intent === 'files'
              ? <FolderOpen size={15} aria-hidden="true" />
              : <Cable size={15} aria-hidden="true" />}
            {intent === 'files'
              ? t('files.openFileSession')
              : t('workbench.hostLauncher.kicker')}
          </span>
          <Tooltip title={t('workbench.hostLauncher.refreshReachability')}>
            <Button
              type="text"
              className="host-launcher-title-refresh"
              aria-label={t('workbench.hostLauncher.refreshReachability')}
              loading={refreshingReachability}
              icon={<RefreshCcw size={15} />}
              onClick={() => void onRefreshReachability(hostIds, true)}
            />
          </Tooltip>
        </header>
        <div className="host-launcher-body">
          <aside className="host-launcher-sidebar">
            <div className="host-launcher-filter-region" ref={filterAnchorRef}>
              <div className="host-launcher-search-row">
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
                <div className="host-launcher-filter-anchor">
                  <Button
                    type="text"
                    className={`host-launcher-icon-button host-launcher-filter-trigger ${activeAdvancedFilterCount > 0 ? 'is-active' : ''}`}
                    aria-label={t('workbench.hostLauncher.filters.advanced')}
                    icon={<ListFilter size={16} />}
                    aria-expanded={filterOpen}
                    onClick={() => setFilterOpen((current) => !current)}
                  >
                    {activeAdvancedFilterCount > 0 ? <span>{activeAdvancedFilterCount}</span> : null}
                  </Button>
                </div>
              </div>
              {filterOpen ? (
                <div className="host-launcher-filter-floating" role="dialog" aria-label={t('workbench.hostLauncher.filters.advanced')}>
                  {filterPanel}
                </div>
              ) : null}
            </div>
            <Segmented
              block
              className="host-launcher-filter"
              value={filter}
              onChange={(value) => setFilter(value as LauncherFilter)}
              options={[
                { value: 'all', label: t('workbench.hostLauncher.filters.all') },
                { value: 'recent', label: t('workbench.hostLauncher.filters.recent') },
                { value: 'favorite', label: t('workbench.hostLauncher.filters.favorite') },
                { value: 'online', label: t('workbench.hostLauncher.filters.online') },
              ]}
            />
            <div className="host-launcher-list" role="listbox" aria-label={t('workbench.hostLauncher.hostList')}>
              {filteredHosts.length === 0 ? (
                <div className="host-launcher-empty">
                  <EmptyState
                    title={data.hosts.length === 0 ? t('app.empty') : t('hosts.noFilterResults')}
                    description={data.hosts.length === 0 ? t('workbench.hostLauncher.emptyHint') : t('hosts.noFilterResultsHint')}
                  />
                </div>
              ) : (
                groupedHosts.map((group) => {
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
                          onClick={() => toggleGroupCollapse(group.id)}
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
                              className={`host-launcher-row ${host.id === selectedHost?.id ? 'is-active' : ''}`}
                              role="option"
                              aria-selected={host.id === selectedHost?.id}
                              onClick={() => onSelectHost(host.id)}
                              onDoubleClick={() => void runHostAction(actionPlan.primary, host.id)}
                            >
                              <span className="host-launcher-row-avatar-wrap">
                                <HostAvatar host={host} getIconUrl={getHostIconUrl} className="host-launcher-row-avatar" size={30} iconSize={15} />
                                <HostReachabilityDot state={data.hostReachability[host.id]} usesProxy={Boolean(host.proxy_id)} />
                              </span>
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
                        </div>
                      ) : null}
                    </section>
                  )
                })
              )}
            </div>
            <Button className="secondary-button host-launcher-create-button" icon={<Plus size={15} />} onClick={() => void runGlobalShortcut(onCreateHost)}>
              {t('hosts.addHost')}
            </Button>
          </aside>

          <main className="host-launcher-detail">
            {selectedHost ? (
              <>
                <h3 className="host-launcher-overview-title">{t('workbench.hostLauncher.overview')}</h3>
                <div className="host-launcher-hero">
                  <HostAvatar
                    host={selectedHost}
                    getIconUrl={getHostIconUrl}
                    className={`host-launcher-hero-icon is-${selectedReachability?.status ?? 'unknown'}`}
                    size={58}
                    iconSize={34}
                  />
                  <div className="host-launcher-hero-copy">
                    <div className="host-launcher-hero-title">
                      <h4>{selectedHost.name}</h4>
                      <HostReachabilityPill state={selectedReachability} usesProxy={Boolean(selectedHost.proxy_id)} />
                      <Tooltip title={selectedHost.favorite ? t('workbench.hostLauncher.unfavorite') : t('workbench.hostLauncher.favorite')}>
                        <Button
                          type="text"
                          className={`host-launcher-favorite ${selectedHost.favorite ? 'is-active' : ''}`}
                          aria-label={selectedHost.favorite ? t('workbench.hostLauncher.unfavorite') : t('workbench.hostLauncher.favorite')}
                          icon={<Star size={16} fill={selectedHost.favorite ? 'currentColor' : 'none'} />}
                          disabled={hostActionBusy}
                          onClick={() => void onToggleFavorite(selectedHost.id)}
                        />
                      </Tooltip>
                    </div>
                    <div className="host-launcher-hero-meta">
                      <span>{selectedHost.address}:{selectedHost.port}</span>
                    </div>
                  </div>
                </div>
                <dl className="host-launcher-detail-grid">
                  <DetailItem icon={<Globe2 size={14} />} label={t('hosts.address')} value={`${selectedHost.address}:${selectedHost.port}`} />
                  <DetailItem icon={<Server size={14} />} label={t('hosts.platform.label')} value={t('hosts.platform.linux')} />
                  <DetailItem
                    icon={<KeyRound size={14} />}
                    label={t('workbench.credential')}
                    value={selectedHostCredential || t('fields.none')}
                  />
                  <DetailItem
                    icon={<Tags size={14} />}
                    label={t('hosts.tags')}
                    value={selectedHost.tags.length > 0 ? (
                      <span className="host-launcher-inline-tags">
                        {selectedHost.tags.map((tag) => (
                          <span key={tagKey(tag)}>{tag}</span>
                        ))}
                      </span>
                    ) : t('fields.none')}
                  />
                  <DetailItem
                    icon={<Activity size={14} />}
                    label={t('workbench.hostLauncher.latency')}
                    value={<LatencyValue state={selectedReachability} />}
                  />
                  <DetailItem icon={<UserRound size={14} />} label={t('hosts.note')} value={selectedHost.note || t('fields.none')} />
                  <DetailItem icon={<Clock3 size={14} />} label={t('workbench.hostLauncher.lastChecked')} value={formatDateTime(selectedReachability?.checked_at, t('fields.none'))} />
                  <DetailItem icon={<Network size={14} />} label={t('workbench.jumpHost')} value={selectedJumpHost?.name ?? t('fields.none')} />
                  <DetailItem
                    icon={<Cable size={14} />}
                    label={t('hosts.proxy')}
                    value={selectedProxy
                      ? `${selectedProxy.name} · ${t(`proxies.types.${selectedProxy.type === 'http_connect' ? 'httpConnect' : 'socks5'}`)}`
                      : t('hosts.noProxy')}
                  />
                </dl>
                <div className="host-launcher-shortcut-section">
                  <span>{t('workbench.hostLauncher.quickActions')}</span>
                  <div className="host-launcher-shortcuts">
                    {actionPlan.shortcuts.map((actionId) => (
                      <Button
                        key={actionId}
                        className="secondary-button"
                        icon={hostLauncherActionIcon(actionId, 15)}
                        loading={pendingHostAction === actionId}
                        disabled={hostActionBusy}
                        onClick={() => void runHostAction(actionId, selectedHost.id)}
                      >
                        {hostLauncherActionLabel(actionId, t)}
                      </Button>
                    ))}
                  </div>
                </div>
                <ConnectionActionButton
                  block
                  size="large"
                  icon={hostLauncherActionIcon(actionPlan.primary, 17)}
                  loading={pendingHostAction === actionPlan.primary}
                  disabled={hostActionBusy}
                  onClick={() => void runSelectedPrimaryAction()}
                >
                  {hostLauncherActionLabel(actionPlan.primary, t)}
                </ConnectionActionButton>
              </>
            ) : (
              <div className="host-launcher-detail-empty">
                <EmptyState
                  title={data.hosts.length === 0 ? t('app.empty') : t('hosts.noFilterResults')}
                  description={data.hosts.length === 0 ? t('workbench.hostLauncher.emptyHint') : t('hosts.noFilterResultsHint')}
                />
                {data.hosts.length === 0 ? (
                  <ConnectionActionButton icon={<Plus size={16} />} onClick={() => void runGlobalShortcut(onCreateHost)}>
                    {t('hosts.addHost')}
                  </ConnectionActionButton>
                ) : null}
              </div>
            )}
          </main>
        </div>
      </section>
    </Modal>
  )
}

function hostLauncherActionLabel(
  actionId: HostLauncherActionId,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (actionId === 'connect') {
    return t('app.connect')
  }
  if (actionId === 'openFiles') {
    return t('workbench.hostLauncher.openFiles')
  }
  if (actionId === 'editHost') {
    return t('workbench.hostLauncher.editHost')
  }
  return t('workbench.hostLauncher.openForward')
}

function hostLauncherActionIcon(actionId: HostLauncherActionId, size: number) {
  if (actionId === 'connect') {
    return <Cable size={size} />
  }
  if (actionId === 'openFiles') {
    return <FolderOpen size={size} />
  }
  if (actionId === 'editHost') {
    return <Edit3 size={size} />
  }
  return <Network size={size} />
}

function DetailItem({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="host-launcher-detail-item">
      <span className="host-launcher-detail-icon">
        {icon}
      </span>
      <div className="host-launcher-detail-copy">
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </div>
  )
}

function HostReachabilityDot({ state, usesProxy = false }: { state?: HostReachability; usesProxy?: boolean }) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  return (
    <Tooltip title={reachabilityTooltip(state, t, usesProxy)}>
      <span className={`host-reachability-dot is-${status}`} aria-label={reachabilityTooltip(state, t, usesProxy)} />
    </Tooltip>
  )
}

function HostReachabilityPill({ state, usesProxy = false }: { state?: HostReachability; usesProxy?: boolean }) {
  const { t } = useTranslation()
  const status = state?.status ?? 'unknown'
  const Icon = status === 'online' ? Activity : status === 'checking' ? RefreshCcw : status === 'offline' ? WifiOff : Globe2
  return (
    <Tooltip title={reachabilityTooltip(state, t, usesProxy)}>
      <span className={`host-reachability-pill is-${status}`}>
        <Icon size={13} aria-hidden="true" />
        <span>{t(`workbench.hostLauncher.reachability.${status}`)}</span>
      </span>
    </Tooltip>
  )
}

function LatencyValue({ state }: { state?: HostReachability }) {
  const { t } = useTranslation()
  const level = latencyLevel(state)
  const label = latencySignalLabel(state, t)

  return (
    <Tooltip title={label}>
      <span className="host-latency-value" aria-label={label}>
        <span className={`host-latency-signal is-${level}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{formatReachabilityLatency(state, t)}</span>
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
  groupFilter: LauncherGroupFilter,
  authFilter: LauncherAuthFilter,
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
    if (groupFilter !== 'all' && (host.group_id || '__ungrouped') !== groupFilter) {
      return false
    }
    if (authFilter !== 'all' && host.auth_method !== authFilter) {
      return false
    }
    if (filter === 'online' && reachabilityStatus !== 'online' && reachabilityStatus !== 'checking') {
      return false
    }
    if (filter === 'recent' && timestamp(host.last_connected_at) <= 0) {
      return false
    }
    if (filter === 'favorite' && !host.favorite) {
      return false
    }
    const hostTags = host.tags ?? []
    const hostTagKeys = new Set(hostTags.map(tagKey))
    if (selectedTagKeys.length > 0 && !selectedTagKeys.every((tag) => hostTagKeys.has(tag))) {
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
    const recentDelta = timestamp(right.last_connected_at) - timestamp(left.last_connected_at)
    if (filter === 'recent') {
      return recentDelta || left.name.localeCompare(right.name)
    }
    if (left.favorite !== right.favorite) {
      return left.favorite ? -1 : 1
    }
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

function buildGroupFilterOptions(hosts: Host[], groups: AppData['groups'], fallbackGroupName: string, allLabel: string) {
  const options = [
    { value: 'all', label: allLabel },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ]
  if (hosts.some((host) => !host.group_id)) {
    options.push({ value: '__ungrouped', label: fallbackGroupName })
  }
  return options
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
  usesProxy = false,
) {
  const status = state?.status ?? 'unknown'
  let label: string
  if (status === 'online' && state?.latency_ms !== undefined) {
    label = t('workbench.hostLauncher.reachabilityTooltip.online', { latency: state.latency_ms })
  } else if ((status === 'offline' || status === 'unavailable') && state?.error_message) {
    label = state.error_message
  } else {
    label = t(`workbench.hostLauncher.reachabilityTooltip.${status}`)
  }
  return usesProxy
    ? `${label} · ${t('proxies.reachabilityDirectHint')}`
    : label
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

type LatencyLevel = 'unknown' | 'low' | 'medium' | 'high'

function latencyLevel(state: HostReachability | undefined): LatencyLevel {
  if (!state || state.status !== 'online' || state.latency_ms === undefined) {
    return 'unknown'
  }
  if (state.latency_ms <= 80) {
    return 'low'
  }
  if (state.latency_ms <= 180) {
    return 'medium'
  }
  return 'high'
}

function latencySignalLabel(
  state: HostReachability | undefined,
  t: (key: string, options?: Record<string, string | number>) => string,
) {
  const level = latencyLevel(state)
  if (level === 'unknown') {
    return t('workbench.hostLauncher.latencyLevels.unknown')
  }
  return t('workbench.hostLauncher.latencyLevels.value', {
    level: t(`workbench.hostLauncher.latencyLevels.${level}`),
    latency: state?.latency_ms ?? 0,
  })
}
