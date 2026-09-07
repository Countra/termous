import { Button, Input, Modal, Segmented, Tooltip } from 'antd'
import {
  Cable,
  FolderOpen,
  ListFilter,
  MonitorPlay,
  Plus,
  RefreshCcw,
  Search,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  confirmDialogStyles,
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
  groupHosts,
  tagKey,
  type LauncherAuthFilter,
  type LauncherFilter,
  type LauncherGroupFilter,
  type LauncherPlatformFilter,
} from '../model/hostLauncherListModel.ts'
import {
  buildHostLauncherProfileMenu,
  selectCompanionHostLauncherFileProfile,
  type HostLauncherProfileMenuItem,
  type HostLauncherSSHProfileMenuItem,
} from '../model/hostLauncherProfiles.ts'
import { effectiveSSHProfileId } from '../model/hostLauncherProfileDetails.ts'
import {
  buildHostDirectoryItems,
} from '../model/hostDirectory.ts'
import type { HostLauncherData } from '../model/types.ts'
import { HostLauncherAdvancedFilters } from './HostLauncherAdvancedFilters.tsx'
import { HostLauncherDetail } from './HostLauncherDetail.tsx'
import { HostLauncherHostList } from './HostLauncherHostList.tsx'
import styles from './HostLauncherModal.module.scss'

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
  onOpenForward: (hostId: string, sshProfileId: string) => void
  onToggleFavorite: (hostId: string) => Promise<void>
  onRefreshReachability: (hostIds?: string[], force?: boolean) => Promise<void>
  onRefreshSSHProfileReachability?: (profileIds: readonly string[]) => Promise<void>
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
  onRefreshSSHProfileReachability,
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
  const [profileSelection, setProfileSelection] = useState({
    contextKey: '',
    profileId: null as string | null,
  })
  const pendingHostActionRef = useRef<HostLauncherActionId | null>(null)
  const manualReachabilityRefreshGenerationRef = useRef<number | null>(null)
  const openGenerationRef = useRef(0)
  const launcherOpenRef = useRef(false)
  const refreshReachabilityRef = useRef(onRefreshReachability)
  const autoRefreshOpenRef = useRef(false)
  const filterAnchorRef = useRef<HTMLDivElement>(null)
  const directoryItems = useMemo(
    () => buildHostDirectoryItems(data.hostAssets, data.sshAccessProfiles),
    [data.hostAssets, data.sshAccessProfiles],
  )
  const groupsById = useMemo(() => new Map(data.groups.map((group) => [group.id, group.name])), [data.groups])
  const hostIds = useMemo(
    () => directoryItems.filter((host) => host.defaultSSHProfile).map((host) => host.id),
    [directoryItems],
  )
  const availableTags = useMemo(() => buildTagOptions(directoryItems), [directoryItems])
  const groupOptions = useMemo(() => buildGroupFilterOptions(directoryItems, data.groups, t('hosts.ungrouped'), t('workbench.hostLauncher.filters.allGroups')), [data.groups, directoryItems, t])
  const filteredHosts = useMemo(
    () => filterHosts(directoryItems, groupsById, data.hostReachability, query, filter, platformFilter, groupFilter, authFilter, selectedTags),
    [authFilter, data.hostReachability, directoryItems, filter, groupFilter, groupsById, platformFilter, query, selectedTags],
  )
  const groupedHosts = useMemo(
    () => filter === 'recent'
      ? [{ id: '__recent', name: '', hosts: filteredHosts, order: 0 }]
      : groupHosts(filteredHosts, data.groups, t('hosts.ungrouped')),
    [data.groups, filter, filteredHosts, t],
  )
  const hasHosts = directoryItems.length > 0
  const selectedHost = filteredHosts.find((host) => host.id === selectedHostId) ?? filteredHosts[0]
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
  const profileSelectionContextKey = `${instanceKey}:${selectedProfileMenu.hostId}:${selectedProfileMenu.intent}`
  const explicitProfileId = profileSelection.contextKey === profileSelectionContextKey
    ? profileSelection.profileId
    : null
  const explicitProfile = explicitProfileId
    ? selectedProfileMenu.items.find((item) => item.profileId === explicitProfileId) ?? null
    : null
  const selectedProfile = explicitProfile?.availability === 'ready'
    ? explicitProfile
    : selectedProfileMenu.defaultItem
  const selectedSSHProfileId = effectiveSSHProfileId(selectedProfile)
  const dedicatedReachabilityProfileId = selectedSSHProfileId
    && onRefreshSSHProfileReachability
    && selectedSSHProfileId !== selectedHost?.defaultSSHProfile?.id
    ? selectedSSHProfileId
    : null
  const canRefreshReachability = hostIds.length > 0
    || dedicatedReachabilityProfileId !== null

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
    manualReachabilityRefreshGenerationRef.current = null
    setPendingHostAction(null)
    setPendingProfileId(null)
    setRefreshingReachability(false)
    autoRefreshOpenRef.current = false
    return () => {
      launcherOpenRef.current = false
      openGenerationRef.current += 1
    }
  }, [instanceKey, open])

  useEffect(() => {
    setProfileSelection((current) => {
      if (current.contextKey !== profileSelectionContextKey) {
        return { contextKey: profileSelectionContextKey, profileId: null }
      }
      if (
        current.profileId
        && !selectedProfileMenu.items.some((item) => (
          item.profileId === current.profileId && item.availability === 'ready'
        ))
      ) {
        return { contextKey: profileSelectionContextKey, profileId: null }
      }
      return current
    })
  }, [profileSelectionContextKey, selectedProfileMenu.items])

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
    const openGeneration = openGenerationRef.current
    setRefreshingReachability(true)
    void refreshReachabilityRef.current(hostIds, false)
      .catch(() => undefined)
      .finally(() => {
        if (
          launcherOpenRef.current
          && openGenerationRef.current === openGeneration
        ) {
          setRefreshingReachability(false)
        }
      })
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

  const resolveActionProfile = (actionId: HostLauncherActionId, hostId: string) => {
    const targetIntent = launcherIntentForAction(actionId)
    if (
      targetIntent === intent
      && selectedProfile?.hostId === hostId
      && selectedProfile.intent === targetIntent
      && selectedProfile.availability === 'ready'
    ) {
      return selectedProfile
    }
    if (actionId === 'openFiles' && intent === 'terminal') {
      if (
        !selectedProfile
        || selectedProfile.intent !== 'terminal'
        || selectedProfile.hostId !== hostId
      ) return null
      return selectCompanionHostLauncherFileProfile(
        data,
        hostId,
        selectedProfile.profileId,
      )
    }
    return resolveDefaultProfile(actionId, hostId)
  }

  const resolveForwardSSHProfile = (hostId: string): HostLauncherSSHProfileMenuItem | null => {
    const selectedProfileId = selectedProfile?.hostId === hostId
      ? effectiveSSHProfileId(selectedProfile)
      : null
    if (selectedProfileId) {
      const matches = buildHostLauncherProfileMenu(data, hostId, 'terminal').items.filter(
        (profile): profile is HostLauncherSSHProfileMenuItem => (
          profile.intent === 'terminal'
          && profile.profileId === selectedProfileId
          && profile.availability === 'ready'
        ),
      )
      return matches.length === 1 ? matches[0] ?? null : null
    }
    const fallback = resolveDefaultProfile('connect', hostId)
    return fallback?.intent === 'terminal' && fallback.availability === 'ready'
      ? fallback
      : null
  }

  const refreshReachability = async () => {
    const openGeneration = openGenerationRef.current
    if (
      !canRefreshReachability
      || refreshingReachability
      || manualReachabilityRefreshGenerationRef.current === openGeneration
    ) {
      return
    }
    manualReachabilityRefreshGenerationRef.current = openGeneration
    setRefreshingReachability(true)
    try {
      const refreshes: Promise<void>[] = []
      if (hostIds.length > 0) {
        refreshes.push(Promise.resolve().then(() => onRefreshReachability(hostIds, true)))
      }
      if (dedicatedReachabilityProfileId && onRefreshSSHProfileReachability) {
        refreshes.push(Promise.resolve().then(() => (
          onRefreshSSHProfileReachability([dedicatedReachabilityProfileId])
        )))
      }
      // 等待本轮全部刷新结束，避免单个请求提前失败后过早释放防重锁。
      await Promise.allSettled(refreshes)
    } finally {
      if (manualReachabilityRefreshGenerationRef.current === openGeneration) {
        manualReachabilityRefreshGenerationRef.current = null
      }
      if (
        launcherOpenRef.current
        && openGenerationRef.current === openGeneration
      ) {
        setRefreshingReachability(false)
      }
    }
  }

  const canRunHostAction = (actionId: HostLauncherActionId, hostId: string) => {
    if (actionId === 'editHost') return true
    if (actionId === 'openForward') return Boolean(resolveForwardSSHProfile(hostId))
    return Boolean(resolveActionProfile(actionId, hostId))
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
    if (actionId === 'openForward' && profile?.intent === 'terminal') {
      onOpenForward(hostId, profile.profileId)
    }
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
    const requiredIntent = actionId === 'openForward' ? 'terminal' : targetIntent
    const profile = actionId === 'openForward'
      ? resolveForwardSSHProfile(hostId)
      : targetIntent
        ? requestedProfile ?? resolveActionProfile(actionId, hostId)
        : null
    if (
      requiredIntent
      && (
        !profile
        || profile.hostId !== hostId
        || profile.intent !== requiredIntent
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
                disabled={!canRefreshReachability}
                icon={<RefreshCcw size={15} />}
                onClick={() => void refreshReachability()}
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
                  <HostLauncherAdvancedFilters
                    activeFilterCount={activeAdvancedFilterCount}
                    platformFilter={platformFilter}
                    groupFilter={groupFilter}
                    authFilter={authFilter}
                    selectedTags={selectedTags}
                    groupOptions={groupOptions}
                    availableTags={availableTags}
                    onClear={clearAdvancedFilters}
                    onPlatformChange={setPlatformFilter}
                    onGroupChange={setGroupFilter}
                    onAuthChange={setAuthFilter}
                    onToggleTag={toggleTag}
                  />
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
            <HostLauncherHostList
              filter={filter}
              groups={groupedHosts}
              filteredCount={filteredHosts.length}
              totalCount={directoryItems.length}
              collapsedGroupIds={collapsedGroupIds}
              selectedHostId={selectedHost?.id}
              focusableHostId={focusableHostId}
              hostReachability={data.hostReachability}
              getHostIconUrl={getHostIconUrl}
              onKeyDown={handleHostListKeyDown}
              onToggleGroup={toggleGroupCollapse}
              onSelectHost={onSelectHost}
              onRunPrimary={(hostId) => void runHostAction(actionPlan.primary, hostId)}
            />
            <Button className={`${uiStyles['secondary-button']} secondary-button host-launcher-create-button`} icon={<Plus size={15} />} onClick={() => void runLauncherAction(onCreateHost)}>
              {t('hosts.addHost')}
            </Button>
          </aside> : null}

          <HostLauncherDetail
            hasHosts={hasHosts}
            selectedHost={selectedHost}
            data={data}
            actionPlan={actionPlan}
            profileMenu={selectedProfileMenu}
            selectedProfile={selectedProfile}
            busy={hostActionBusy}
            pendingHostAction={pendingHostAction}
            pendingProfileId={pendingProfileId}
            getHostIconUrl={getHostIconUrl}
            canRunAction={canRunHostAction}
            onRunAction={(actionId, hostId, profile) => {
              void runHostAction(actionId, hostId, profile)
            }}
            onSelectProfile={(profile) => {
              const validProfile = selectedProfileMenu.items.find((item) => (
                item.profileId === profile.profileId
                && item.hostId === selectedProfileMenu.hostId
                && item.intent === selectedProfileMenu.intent
                && item.availability === 'ready'
              ))
              if (!validProfile) return
              setProfileSelection({
                contextKey: profileSelectionContextKey,
                profileId: validProfile.profileId,
              })
            }}
            onManageAccess={(hostId) => {
              void runLauncherAction(() => onManageHostAccess(hostId))
            }}
            onToggleFavorite={onToggleFavorite}
            onClearFilters={clearAllFilters}
            onCreateHost={() => void runLauncherAction(onCreateHost)}
          />
        </div>
      </section>
    </Modal>
  )
}

function launcherIntentForAction(
  actionId: HostLauncherActionId,
): HostLauncherIntent | null {
  if (actionId === 'connect') return 'terminal'
  if (actionId === 'openFiles') return 'files'
  if (actionId === 'openRemoteDesktop') return 'remote_desktop'
  return null
}
