import { Button, Empty, Input, Modal, Segmented, Select, Tag, Tooltip } from 'antd'
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
  MonitorPlay,
  Network,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Star,
  Tags,
  UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AuthMethodBadge,
  HostAvatar,
} from '#entities/host'
import {
  confirmDialogStyles,
  ConnectionActionButton,
  customSelectStyles,
  uiStyles,
} from '#shared/ui'
import {
  hostLauncherActionPlan,
  type HostLauncherActionId,
  type HostLauncherIntent,
} from '../model/hostLauncherIntent.ts'
import {
  buildGroupFilterOptions,
  buildTagOptions,
  filterHosts,
  formatDateTime,
  groupHosts,
  tagKey,
  type LauncherAuthFilter,
  type LauncherFilter,
  type LauncherGroupFilter,
  type LauncherPlatformFilter,
} from '../model/hostLauncherListModel.ts'
import {
  buildHostLauncherProfileMenu,
  type HostLauncherProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import type { HostLauncherData } from '../model/types.ts'
import {
  DetailItem,
  HostReachabilityDot,
  HostReachabilityPill,
  LatencyValue,
} from './HostLauncherDetailParts.tsx'
import { HostLauncherProfileAction } from './HostLauncherProfileAction.tsx'
import styles from './HostLauncherModal.module.scss'

const renderHostLauncherFilterPopup = (content: ReactNode) => (
  <div data-host-launcher-filter-popup>{content}</div>
)

export interface HostLauncherModalProps {
  open: boolean
  instanceKey: number
  intent?: HostLauncherIntent
  data: HostLauncherData
  selectedHostId: string
  actionBusy: boolean
  onClose: () => void
  onSelectHost: (hostId: string) => void
  onConnectSSHProfile: (profileId: string) => Promise<void>
  onCreateHost: () => void
  onEditHost: (hostId: string) => void
  onManageHostAccess: (hostId: string) => void
  onOpenFileProfile: (profileId: string, hostId: string) => Promise<void>
  onOpenRemoteDesktopProfile: (profileId: string) => Promise<void>
  onOpenForward: (hostId: string) => void
  onToggleFavorite: (hostId: string) => Promise<void>
  onRefreshReachability: (hostIds?: string[], force?: boolean) => Promise<void>
  getHostIconUrl: (iconId: string) => string
}

export function HostLauncherModal({
  open,
  instanceKey,
  intent = 'terminal',
  data,
  selectedHostId,
  actionBusy,
  onClose,
  onSelectHost,
  onConnectSSHProfile,
  onCreateHost,
  onEditHost,
  onManageHostAccess,
  onOpenFileProfile,
  onOpenRemoteDesktopProfile,
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
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null)
  const pendingHostActionRef = useRef<HostLauncherActionId | null>(null)
  const openGenerationRef = useRef(0)
  const launcherOpenRef = useRef(false)
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
  const hasHosts = data.hosts.length > 0
  const selectedHost = filteredHosts.find((host) => host.id === selectedHostId) ?? filteredHosts[0]
  const selectedHostCredential = selectedHost?.credential_id ? credentialsById.get(selectedHost.credential_id) : ''
  const selectedJumpHost = selectedHost?.jump_host_id ? hostsById.get(selectedHost.jump_host_id) : undefined
  const selectedProxy = selectedHost?.proxy_id ? proxiesById.get(selectedHost.proxy_id) : undefined
  const selectedReachability = selectedHost ? data.hostReachability[selectedHost.id] : undefined
  const renderedHostIds = useMemo(
    () => groupedHosts.flatMap((group) => (
      filter === 'recent' || !collapsedGroupIds.has(group.id)
        ? group.hosts.map((host) => host.id)
        : []
    )),
    [collapsedGroupIds, filter, groupedHosts],
  )
  const focusableHostId = selectedHost && renderedHostIds.includes(selectedHost.id)
    ? selectedHost.id
    : renderedHostIds[0]
  const activeAdvancedFilterCount = [
    platformFilter !== 'all',
    groupFilter !== 'all',
    authFilter !== 'all',
    selectedTags.length > 0,
  ].filter(Boolean).length
  const actionPlan = hostLauncherActionPlan(intent)
  const hostActionBusy = actionBusy || pendingHostAction !== null
  const selectedProfileMenu = useMemo(
    () => buildHostLauncherProfileMenu({
      sshAccessProfiles: data.sshAccessProfiles,
      fileAccessProfiles: data.fileAccessProfiles,
      remoteDesktopProfiles: data.remoteDesktopProfiles,
    }, selectedHost?.id ?? '', intent),
    [
      data.fileAccessProfiles,
      data.remoteDesktopProfiles,
      data.sshAccessProfiles,
      intent,
      selectedHost?.id,
    ],
  )

  const invalidateOpenGeneration = () => {
    launcherOpenRef.current = false
    openGenerationRef.current += 1
    pendingHostActionRef.current = null
    setPendingHostAction(null)
    setPendingProfileId(null)
  }

  const closeLauncher = () => {
    invalidateOpenGeneration()
    onClose()
  }

  useEffect(() => {
    openGenerationRef.current += 1
    launcherOpenRef.current = open
    pendingHostActionRef.current = null
    setPendingHostAction(null)
    setPendingProfileId(null)
    autoRefreshOpenRef.current = false
    return () => {
      launcherOpenRef.current = false
      openGenerationRef.current += 1
    }
  }, [instanceKey, open])

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
  }, [hostIds, instanceKey, open])

  useEffect(() => {
    if (!filterOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && filterAnchorRef.current?.contains(target)) {
        return
      }
      if (target instanceof Element && target.closest('[data-host-launcher-filter-popup]')) {
        return
      }
      setFilterOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [filterOpen])

  const resolveDefaultProfile = (actionId: HostLauncherActionId, hostId: string) => {
    const targetIntent = launcherIntentForAction(actionId)
    if (!targetIntent) return null
    const menu = buildHostLauncherProfileMenu(data, hostId, targetIntent)
    return menu.defaultResolution === 'resolved' ? menu.defaultItem : null
  }

  const executeHostAction = async (
    actionId: HostLauncherActionId,
    hostId: string,
    profile: HostLauncherProfileMenuItem | null,
  ) => {
    if (actionId === 'connect') {
      if (profile?.intent === 'terminal') await onConnectSSHProfile(profile.profileId)
      return
    }
    if (actionId === 'openFiles') {
      if (profile?.intent === 'files') await onOpenFileProfile(profile.profileId, hostId)
      return
    }
    if (actionId === 'openRemoteDesktop') {
      if (profile?.intent === 'remote_desktop') {
        await onOpenRemoteDesktopProfile(profile.profileId)
      }
      return
    }
    if (actionId === 'editHost') {
      onEditHost(hostId)
      return
    }
    onOpenForward(hostId)
  }

  const runHostAction = async (
    actionId: HostLauncherActionId,
    hostId: string,
    requestedProfile?: HostLauncherProfileMenuItem,
  ) => {
    if (!hostId || actionBusy || pendingHostActionRef.current !== null) {
      return
    }
    const targetIntent = launcherIntentForAction(actionId)
    const profile = targetIntent
      ? requestedProfile ?? resolveDefaultProfile(actionId, hostId)
      : null
    if (
      targetIntent
      && (
        !profile
        || profile.hostId !== hostId
        || profile.intent !== targetIntent
        || profile.availability !== 'ready'
      )
    ) {
      return
    }
    pendingHostActionRef.current = actionId
    setPendingHostAction(actionId)
    setPendingProfileId(profile?.profileId ?? null)
    const openGeneration = openGenerationRef.current
    try {
      await executeHostAction(actionId, hostId, profile)
      if (
        launcherOpenRef.current
        && openGenerationRef.current === openGeneration
      ) {
        closeLauncher()
      }
    } catch {
      // 错误提示由应用层动作适配器统一处理，此处只终止本次关闭流程。
    } finally {
      if (openGenerationRef.current === openGeneration) {
        pendingHostActionRef.current = null
        setPendingHostAction(null)
        setPendingProfileId(null)
      }
    }
  }

  const runLauncherAction = async (action: () => void | Promise<void>) => {
    const openGeneration = openGenerationRef.current
    try {
      await action()
      if (
        launcherOpenRef.current
        && openGenerationRef.current === openGeneration
      ) {
        closeLauncher()
      }
    } catch {
      // Launcher 外层负责呈现动作错误，弹窗保持当前状态供用户继续处理。
    }
  }

  const handleLauncherKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !filterOpen) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setFilterOpen(false)
  }

  const handleHostListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const eventTarget = event.target
    if (!(eventTarget instanceof Element)) {
      return
    }
    const currentOption = eventTarget.closest<HTMLButtonElement>('[role="option"]')
    if (!currentOption) {
      return
    }
    if (event.key === 'Enter') {
      const hostId = currentOption.dataset.hostId
      if (!hostId) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void runHostAction(actionPlan.primary, hostId)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'),
    )
    if (options.length === 0) {
      return
    }
    const currentIndex = options.indexOf(currentOption)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % options.length
          : (currentIndex - 1 + options.length) % options.length
    const nextOption = options[nextIndex]
    if (!nextOption) {
      return
    }
    event.preventDefault()
    nextOption.focus()
    if (nextOption.dataset.hostId) {
      onSelectHost(nextOption.dataset.hostId)
    }
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

  const clearAllFilters = () => {
    setQuery('')
    setFilter('all')
    clearAdvancedFilters()
    setFilterOpen(false)
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
              className={customSelectStyles.select}
              popupRender={renderHostLauncherFilterPopup}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
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
              className={customSelectStyles.select}
              popupRender={renderHostLauncherFilterPopup}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
              optionLabelProp="label"
              onChange={(value) => setGroupFilter(value as LauncherGroupFilter)}
              options={groupOptions}
            />
          </label>
          <label className="host-launcher-filter-field">
            <span>{t('hosts.authMethod')}</span>
            <Select
              value={authFilter}
              className={customSelectStyles.select}
              popupRender={renderHostLauncherFilterPopup}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
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

  const launcherTitle = intent === 'files'
    ? t('files.openFileSession')
    : intent === 'remote_desktop'
      ? t('remoteDesktop.newConnection')
      : t('workbench.hostLauncher.kicker')

  return (
    <Modal
      centered
      open={open}
      width={960}
      footer={null}
      title={launcherTitle}
      keyboard={!filterOpen}
      onCancel={closeLauncher}
      className="host-launcher-modal termous-modal"
      rootClassName={`${confirmDialogStyles['modal-root']} host-launcher-modal-root ${styles['host-launcher-scope']}`}
    >
      <section className="host-launcher" tabIndex={-1} onKeyDown={handleLauncherKeyDown}>
        <header className="host-launcher-titlebar">
          <span className="host-launcher-title" aria-hidden="true">
            {intent === 'files'
              ? <FolderOpen size={15} aria-hidden="true" />
              : intent === 'remote_desktop'
                ? <MonitorPlay size={15} aria-hidden="true" />
                : <Cable size={15} aria-hidden="true" />}
            {launcherTitle}
          </span>
          {hasHosts ? (
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
          ) : null}
        </header>
        <div className={`host-launcher-body ${hasHosts ? '' : 'is-empty'}`}>
          {hasHosts ? <aside className="host-launcher-sidebar">
            <div className="host-launcher-filter-region" ref={filterAnchorRef}>
              <div className="host-launcher-search-row">
                <Input
                  id="workbench-host-launcher-search"
                  name="workbench-host-launcher-search"
                  className={`${uiStyles['search-input']} host-launcher-search`}
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
            <div
              className="host-launcher-list"
              role={filteredHosts.length === 0 ? 'status' : 'listbox'}
              aria-label={filteredHosts.length === 0 ? undefined : t('workbench.hostLauncher.hostList')}
              onKeyDown={handleHostListKeyDown}
            >
              {filteredHosts.length === 0 ? (
                <div className="host-launcher-empty">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={(
                      <span className="host-launcher-empty-copy">
                        <strong>{t('hosts.filterResult', { count: 0, total: data.hosts.length })}</strong>
                      </span>
                    )}
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
                              data-host-id={host.id}
                              aria-selected={host.id === selectedHost?.id}
                              tabIndex={host.id === focusableHostId ? 0 : -1}
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
            <Button className={`${uiStyles['secondary-button']} secondary-button host-launcher-create-button`} icon={<Plus size={15} />} onClick={() => void runLauncherAction(onCreateHost)}>
              {t('hosts.addHost')}
            </Button>
          </aside> : null}

          {hasHosts ? <main className="host-launcher-detail">
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
                        className={`${uiStyles['secondary-button']} secondary-button`}
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
                <HostLauncherProfileAction
                  menu={selectedProfileMenu}
                  busy={hostActionBusy}
                  pendingProfileId={pendingProfileId}
                  onManage={() => void runLauncherAction(() => onManageHostAccess(selectedHost.id))}
                  onRun={(profile) => void runHostAction(
                    profile.actionId,
                    selectedHost.id,
                    profile,
                  )}
                />
              </>
            ) : (
              <div className="host-launcher-detail-empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={(
                    <div className="host-launcher-detail-empty-copy">
                      <h3>{t('hosts.noFilterResults')}</h3>
                      <p>{t('hosts.noFilterResultsHint')}</p>
                    </div>
                  )}
                >
                  <Button className={`${uiStyles['secondary-button']} secondary-button`} onClick={clearAllFilters}>
                    {t('workbench.hostLauncher.filters.resetAll')}
                  </Button>
                </Empty>
              </div>
            )}
          </main> : (
            <main className="host-launcher-onboarding">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={(
                  <div className="host-launcher-onboarding-copy">
                    <h2>{t('workbench.hostLauncher.emptyTitle')}</h2>
                    <p>{t('workbench.hostLauncher.emptyDescription')}</p>
                  </div>
                )}
              >
                <ConnectionActionButton icon={<Plus size={16} />} onClick={() => void runLauncherAction(onCreateHost)}>
                  {t('hosts.addHost')}
                </ConnectionActionButton>
              </Empty>
            </main>
          )}
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
  if (actionId === 'openRemoteDesktop') {
    return t('workbench.hostLauncher.openRemoteDesktop')
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
  if (actionId === 'openRemoteDesktop') {
    return <MonitorPlay size={size} />
  }
  if (actionId === 'editHost') {
    return <Edit3 size={size} />
  }
  return <Network size={size} />
}

function launcherIntentForAction(
  actionId: HostLauncherActionId,
): HostLauncherIntent | null {
  if (actionId === 'connect') return 'terminal'
  if (actionId === 'openFiles') return 'files'
  if (actionId === 'openRemoteDesktop') return 'remote_desktop'
  return null
}
