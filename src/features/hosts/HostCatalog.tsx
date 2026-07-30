import { Button, Input, Popover, Select, Tag, Tooltip } from 'antd'
import { ChevronDown, ChevronRight, Filter, FolderCog, Network, Plus, Search, Server, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HostAvatar } from '../../components/hosts/HostAvatar'
import { ManagementPanel } from '../../components/management/ManagementWorkspace'
import { AuthMethodBadge } from '../../components/ui/AuthMethodBadge'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { EmptyState } from '../../components/ui/EmptyState'
import type { AuthMethod, Host, HostGroup } from '../../types/domain'
import {
  buildHostTagOptions,
  filterHosts,
  groupHosts,
  hostTagKey,
  type HostCatalogFilters,
} from './hostManagementUtils'

interface HostCatalogProps {
  hosts: Host[]
  groups: HostGroup[]
  selectedHostId: string | null
  actionBusy: boolean
  getHostIconUrl: (iconId: string) => string
  onSelect: (hostId: string) => void
  onCreate: () => void
  onManageGroups: () => void
  onManageProxies: () => void
}

const defaultFilters: HostCatalogFilters = { groupId: '', tags: [], authMethods: [] }

export function HostCatalog({
  hosts,
  groups,
  selectedHostId,
  actionBusy,
  getHostIconUrl,
  onSelect,
  onCreate,
  onManageGroups,
  onManageProxies,
}: HostCatalogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<HostCatalogFilters>(defaultFilters)

  useEffect(() => {
    if (!filters.groupId || groups.some((group) => group.id === filters.groupId)) return
    setFilters((current) => ({ ...current, groupId: '' }))
  }, [filters.groupId, groups])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const tags = useMemo(() => buildHostTagOptions(hosts), [hosts])
  const filteredHosts = useMemo(() => filterHosts(hosts, groups, query, filters), [filters, groups, hosts, query])
  const sections = useMemo(() => groupHosts(filteredHosts, groups, t('hosts.ungrouped')), [filteredHosts, groups, t])
  const activeFilterCount = Number(Boolean(filters.groupId)) + filters.tags.length + filters.authMethods.length
  const hasFilters = Boolean(query.trim()) || activeFilterCount > 0

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const filterContent = (
    <div className="host-filter-content">
      <div className="host-filter-title-row">
        <strong>{t('hosts.filterTitle')}</strong>
        <Button type="text" size="small" disabled={activeFilterCount === 0} onClick={() => setFilters(defaultFilters)}>
          {t('hosts.clearFilters')}
        </Button>
      </div>
      <label className="host-filter-field">
        <span>{t('hosts.filterGroup')}</span>
        <Select
          value={filters.groupId}
          className="termous-select"
          classNames={{ popup: { root: 'termous-select-popup host-filter-select-popup' } }}
          options={[
            { value: '', label: t('hosts.allGroups') },
            ...groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
          onChange={(groupId) => setFilters((current) => ({ ...current, groupId }))}
        />
      </label>
      <div className="host-filter-field">
        <span>{t('hosts.filterAuth')}</span>
        <div className="host-filter-chip-grid">
          {(['password', 'private_key'] as AuthMethod[]).map((method) => (
            <Tag.CheckableTag
              key={method}
              checked={filters.authMethods.includes(method)}
              onChange={(checked) => setFilters((current) => ({
                ...current,
                authMethods: checked
                  ? [...current.authMethods, method]
                  : current.authMethods.filter((value) => value !== method),
              }))}
            >
              {t(`hosts.auth.${method}`)}
            </Tag.CheckableTag>
          ))}
        </div>
      </div>
      <div className="host-filter-field">
        <span>{t('hosts.filterTags')}</span>
        {tags.length > 0 ? (
          <div className="host-filter-tag-grid">
            {tags.map((tag) => (
              <Tag.CheckableTag
                key={tag.key}
                checked={filters.tags.some((value) => hostTagKey(value) === tag.key)}
                onChange={(checked) => setFilters((current) => ({
                  ...current,
                  tags: checked
                    ? [...current.tags, tag.label]
                    : current.tags.filter((value) => hostTagKey(value) !== tag.key),
                }))}
              >
                {tag.label}<small>{tag.count}</small>
              </Tag.CheckableTag>
            ))}
          </div>
        ) : <span className="host-filter-empty">{t('hosts.noTags')}</span>}
      </div>
    </div>
  )

  return (
    <ManagementPanel
      className="host-catalog"
      bodyClassName="host-catalog-body"
      header={(
        <div className="host-panel-heading">
          <span className="host-panel-heading-icon"><Server size={18} aria-hidden="true" /></span>
          <div><h2>{t('hosts.list')}</h2><span className="host-panel-heading-meta">{t('hosts.hostCount', { count: hosts.length })}</span></div>
          <div className="host-panel-heading-actions">
            <Tooltip title={t('proxies.manage')}>
              <Button
                className="host-proxy-manager-trigger"
                aria-label={t('proxies.manage')}
                aria-haspopup="dialog"
                icon={<Network size={15} aria-hidden="true" />}
                onClick={onManageProxies}
              >
                {t('proxies.shortLabel')}
              </Button>
            </Tooltip>
            <Tooltip title={t('hosts.manageGroups')}>
              <Button
                className="host-group-manager-trigger"
                aria-label={t('hosts.manageGroups')}
                icon={<FolderCog size={16} />}
                onClick={onManageGroups}
              />
            </Tooltip>
          </div>
        </div>
      )}
      footer={<span className="host-catalog-result">{t('hosts.filterResult', { count: filteredHosts.length, total: hosts.length })}</span>}
    >
      <div className="host-catalog-toolbar">
        <div className="host-catalog-search-row">
          <Input
            className="termous-search-input"
            value={query}
            allowClear
            variant="borderless"
            prefix={<Search size={15} aria-hidden="true" />}
            placeholder={t('hosts.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Popover trigger="click" placement="bottomRight" arrow={false} content={filterContent} rootClassName="host-filter-popover">
            <Tooltip title={t('hosts.filterTitle')}>
              <Button className={`host-filter-trigger ${activeFilterCount > 0 ? 'is-active' : ''}`} icon={<Filter size={15} />}>
                {activeFilterCount > 0 ? activeFilterCount : null}
              </Button>
            </Tooltip>
          </Popover>
        </div>
        <ConnectionActionButton block icon={<Plus size={16} />} disabled={actionBusy} onClick={onCreate}>
          {t('hosts.addHost')}
        </ConnectionActionButton>
        {hasFilters ? (
          <Button type="text" size="small" className="host-clear-all" icon={<X size={13} />} onClick={() => { setQuery(''); setFilters(defaultFilters) }}>
            {t('hosts.clearFilters')}
          </Button>
        ) : null}
      </div>
      <div className="host-catalog-list">
        {hosts.length === 0 ? <EmptyState title={t('hosts.empty')} description={t('hosts.emptyHint')} /> : null}
        {hosts.length > 0 && filteredHosts.length === 0 ? <EmptyState title={t('hosts.noFilterResults')} description={t('hosts.noFilterResultsHint')} /> : null}
        {sections.map((section) => {
          const collapsed = collapsedGroups.has(section.id)
          return (
            <section className="host-group-section" key={section.id || 'ungrouped'}>
              <button type="button" className="host-group-heading" onClick={() => toggleGroup(section.id)} aria-expanded={!collapsed}>
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span>{section.name}</span><small>{section.hosts.length}</small>
              </button>
              {!collapsed ? section.hosts.map((host) => (
                <HostCatalogRow key={host.id} host={host} active={host.id === selectedHostId} getHostIconUrl={getHostIconUrl} onSelect={onSelect} />
              )) : null}
            </section>
          )
        })}
      </div>
    </ManagementPanel>
  )
}

function HostCatalogRow({ host, active, getHostIconUrl, onSelect }: { host: Host; active: boolean; getHostIconUrl: (id: string) => string; onSelect: (id: string) => void }) {
  const tags = host.tags ?? []
  return (
    <button type="button" className={`host-catalog-row ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={() => onSelect(host.id)}>
      <HostAvatar host={host} getIconUrl={getHostIconUrl} size={34} iconSize={17} />
      <span className="host-catalog-row-copy">
        <Tooltip title={host.name}><strong>{host.name}</strong></Tooltip>
        <span><small>{host.username}@{host.address}:{host.port}</small>{tags[0] ? <Tooltip title={tags.join(', ')}><em>{tags[0]}{tags.length > 1 ? ` +${tags.length - 1}` : ''}</em></Tooltip> : null}</span>
      </span>
      <AuthMethodBadge method={host.auth_method} compact />
    </button>
  )
}
