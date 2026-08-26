import { Button, Input, Select, Tag, Tooltip } from 'antd'
import { ChevronDown, ChevronRight, Filter, FolderCog, Images, Network, Plus, Search, Server, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AuthMethodBadge,
  HostAvatar,
  type AuthMethod,
  type HostGroup,
} from '#entities/host'
import styles from './HostManagement.module.scss'
import {
  ConnectionActionButton,
  customSelectStyles,
  EmptyState,
  FilterPopover,
  ManagementPanel,
  uiStyles,
} from '#shared/ui'
import {
  buildHostDirectoryTagOptions,
  filterHostDirectoryCatalog,
  formatSSHProfileEndpoint,
  groupHostDirectoryItems,
  hostDirectoryTagKey,
  type HostDirectoryCatalogFilters,
  type HostDirectoryItem,
} from '../model/hostDirectory.ts'

interface HostCatalogProps {
  items: HostDirectoryItem[]
  groups: HostGroup[]
  selectedHostId: string | null
  actionBusy: boolean
  getHostIconUrl: (iconId: string) => string
  onSelect: (hostId: string) => void
  onCreate: () => void
  onManageGroups: () => void
  onManageProxies: () => void
  onManageIcons: () => void
}

const defaultFilters: HostDirectoryCatalogFilters = { groupId: '', tags: [], authMethods: [] }

export function HostCatalog({
  items,
  groups,
  selectedHostId,
  actionBusy,
  getHostIconUrl,
  onSelect,
  onCreate,
  onManageGroups,
  onManageProxies,
  onManageIcons,
}: HostCatalogProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<HostDirectoryCatalogFilters>(defaultFilters)

  useEffect(() => {
    if (!filters.groupId || groups.some((group) => group.id === filters.groupId)) return
    setFilters((current) => ({ ...current, groupId: '' }))
  }, [filters.groupId, groups])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const tags = useMemo(() => buildHostDirectoryTagOptions(items), [items])
  const filteredItems = useMemo(
    () => filterHostDirectoryCatalog(items, groups, query, filters),
    [filters, groups, items, query],
  )
  const sections = useMemo(
    () => groupHostDirectoryItems(filteredItems, groups, t('hosts.ungrouped')),
    [filteredItems, groups, t],
  )
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
          className={customSelectStyles.select}
          classNames={{ popup: { root: `${customSelectStyles['select-popup']} host-filter-select-popup ${styles['filter-select-popup']}` } }}
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
                checked={filters.tags.some((value) => hostDirectoryTagKey(value) === tag.key)}
                onChange={(checked) => setFilters((current) => ({
                  ...current,
                  tags: checked
                    ? [...current.tags, tag.label]
                    : current.tags.filter((value) => hostDirectoryTagKey(value) !== tag.key),
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
          <div><h2>{t('hosts.list')}</h2><span className="host-panel-heading-meta">{t('hosts.hostCount', { count: items.length })}</span></div>
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
            <Tooltip title={t('hosts.iconLibrary.manage')}>
              <Button
                className="host-group-manager-trigger host-icon-manager-trigger"
                aria-label={t('hosts.iconLibrary.manage')}
                aria-haspopup="dialog"
                icon={<Images size={16} />}
                onClick={onManageIcons}
              />
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
      footer={<span className="host-catalog-result">{t('hosts.filterResult', { count: filteredItems.length, total: items.length })}</span>}
    >
      <div className="host-catalog-toolbar">
        <div className="host-catalog-search-row">
          <Input
            className={uiStyles['search-input']}
            value={query}
            allowClear
            variant="borderless"
            prefix={<Search size={15} aria-hidden="true" />}
            placeholder={t('hosts.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <FilterPopover content={filterContent} popupClassName={styles['filter-popover']}>
            <Tooltip title={t('hosts.filterTitle')}>
              <Button className={`host-filter-trigger ${activeFilterCount > 0 ? `is-active ${styles['is-active']}` : ''}`} icon={<Filter size={15} />}>
                {activeFilterCount > 0 ? activeFilterCount : null}
              </Button>
            </Tooltip>
          </FilterPopover>
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
        {items.length === 0 ? <EmptyState title={t('hosts.empty')} description={t('hosts.emptyHint')} /> : null}
        {items.length > 0 && filteredItems.length === 0 ? <EmptyState title={t('hosts.noFilterResults')} description={t('hosts.noFilterResultsHint')} /> : null}
        {sections.map((section) => {
          const collapsed = collapsedGroups.has(section.id)
          return (
            <section className="host-group-section" key={section.id || 'ungrouped'}>
              <button type="button" className="host-group-heading" onClick={() => toggleGroup(section.id)} aria-expanded={!collapsed}>
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span>{section.name}</span><small>{section.items.length}</small>
              </button>
              {!collapsed ? section.items.map((item) => (
                <HostCatalogRow key={item.id} item={item} active={item.id === selectedHostId} getHostIconUrl={getHostIconUrl} onSelect={onSelect} />
              )) : null}
            </section>
          )
        })}
      </div>
    </ManagementPanel>
  )
}

function HostCatalogRow({ item, active, getHostIconUrl, onSelect }: { item: HostDirectoryItem; active: boolean; getHostIconUrl: (id: string) => string; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const { defaultSSHProfile: ssh } = item
  const tags = item.tags ?? []
  return (
    <button type="button" className={`host-catalog-row ${active ? `is-active ${styles['is-active']}` : ''}`} aria-pressed={active} onClick={() => onSelect(item.id)}>
      <HostAvatar host={item} getIconUrl={getHostIconUrl} size={34} iconSize={17} />
      <span className="host-catalog-row-copy">
        <Tooltip title={item.name}><strong>{item.name}</strong></Tooltip>
        <span><small>{ssh ? formatSSHProfileEndpoint(ssh) : t('hosts.access.ssh.empty')}</small>{tags[0] ? <Tooltip title={tags.join(', ')}><em>{tags[0]}{tags.length > 1 ? ` +${tags.length - 1}` : ''}</em></Tooltip> : null}</span>
      </span>
      {ssh ? <AuthMethodBadge method={ssh.auth_method} compact /> : null}
    </button>
  )
}
