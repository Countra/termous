import { Button, Input, Modal, Segmented, Tag, Tooltip } from 'antd'
import {
  Cable,
  Edit3,
  FolderOpen,
  Network,
  Plus,
  Search,
  Server,
  Star,
  Tags,
} from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthMethodBadge } from '../../components/ui/AuthMethodBadge'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { EmptyState } from '../../components/ui/EmptyState'
import type { AppData, Host } from '../../types/domain'

type LauncherFilter = 'all' | 'favorite' | 'recent' | 'tags'

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
}: HostLauncherModalProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LauncherFilter>('all')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const groupsById = useMemo(() => new Map(data.groups.map((group) => [group.id, group.name])), [data.groups])
  const credentialsById = useMemo(() => new Map(data.credentials.map((credential) => [credential.id, credential.name])), [data.credentials])
  const hostsById = useMemo(() => new Map(data.hosts.map((host) => [host.id, host])), [data.hosts])
  const activeHostIds = useMemo(
    () =>
      new Set(
        data.sessions
          .filter((session) => session.kind === 'ssh' && session.status === 'connected' && session.host_id)
          .map((session) => session.host_id as string),
      ),
    [data.sessions],
  )
  const availableTags = useMemo(() => buildTagOptions(data.hosts), [data.hosts])
  const filteredHosts = useMemo(
    () => filterHosts(data.hosts, groupsById, query, filter, selectedTags),
    [data.hosts, filter, groupsById, query, selectedTags],
  )
  const selectedHost = hostsById.get(selectedHostId) ?? filteredHosts[0] ?? data.hosts[0]
  const selectedHostCredential = selectedHost?.credential_id ? credentialsById.get(selectedHost.credential_id) : ''
  const selectedJumpHost = selectedHost?.jump_host_id ? hostsById.get(selectedHost.jump_host_id) : undefined

  useEffect(() => {
    if (!open) {
      return
    }
    const nextHost = hostsById.get(selectedHostId) ?? filteredHosts[0] ?? data.hosts[0]
    if (nextHost && nextHost.id !== selectedHostId) {
      onSelectHost(nextHost.id)
    }
  }, [data.hosts, filteredHosts, hostsById, onSelectHost, open, selectedHostId])

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
            <Tooltip title={t('hosts.addHost')}>
              <Button
                type="text"
                className="host-launcher-icon-button"
                aria-label={t('hosts.addHost')}
                icon={<Plus size={17} />}
                onClick={() => void runGlobalShortcut(onCreateHost)}
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
              { value: 'favorite', label: t('workbench.hostLauncher.filters.favorite') },
              { value: 'recent', label: t('workbench.hostLauncher.filters.recent') },
              { value: 'tags', label: t('workbench.hostLauncher.filters.tags') },
            ]}
          />
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
              filteredHosts.map((host) => (
                <button
                  key={host.id}
                  type="button"
                  className={`host-launcher-row ${host.id === selectedHost?.id ? 'is-active' : ''}`}
                  role="option"
                  aria-selected={host.id === selectedHost?.id}
                  onClick={() => onSelectHost(host.id)}
                  onDoubleClick={() => void connectHost(host.id)}
                >
                  <span className={`host-launcher-status ${activeHostIds.has(host.id) ? 'is-online' : ''}`} />
                  <span className="host-launcher-row-copy">
                    <strong>
                      {host.name}
                      {host.favorite ? <Star size={12} aria-label={t('workbench.hostLauncher.favorite')} /> : null}
                    </strong>
                    <small>{host.username}@{host.address}</small>
                  </span>
                  <AuthMethodBadge method={host.auth_method} compact />
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="host-launcher-detail">
          {selectedHost ? (
            <>
              <div className="host-launcher-hero">
                <span className="host-launcher-hero-icon">
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
                    <span className={activeHostIds.has(selectedHost.id) ? 'is-online' : ''}>
                      {activeHostIds.has(selectedHost.id) ? t('status.connected') : t('status.disconnected')}
                    </span>
                    <AuthMethodBadge method={selectedHost.auth_method} />
                  </div>
                </div>
              </div>
              <dl className="host-launcher-detail-grid">
                <DetailItem label={t('hosts.group')} value={groupsById.get(selectedHost.group_id) || t('hosts.ungrouped')} />
                <DetailItem label={t('hosts.platform.label')} value={t('hosts.platform.linux')} />
                <DetailItem
                  label={t('workbench.credential')}
                  value={selectedHost.auth_method === 'system' ? t('hosts.systemAuth') : selectedHostCredential || t('fields.none')}
                />
                <DetailItem label={t('workbench.jumpHost')} value={selectedJumpHost?.name ?? t('fields.none')} />
                <DetailItem label={t('workbench.hostLauncher.lastConnected')} value={formatDateTime(selectedHost.last_connected_at, t('fields.none'))} />
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

function filterHosts(
  hosts: Host[],
  groupsById: Map<string, string>,
  query: string,
  filter: LauncherFilter,
  selectedTags: string[],
) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const selectedTagKeys = selectedTags.map(tagKey)
  const filtered = hosts.filter((host) => {
    if (filter === 'favorite' && !host.favorite) {
      return false
    }
    if (filter === 'recent' && !host.last_connected_at) {
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
    if (filter === 'recent') {
      return timestamp(right.last_connected_at) - timestamp(left.last_connected_at)
    }
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
