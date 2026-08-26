import { Button, Select, Tag } from 'antd'
import { ListFilter } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import {
  tagKey,
  type HostLauncherTagOption,
  type LauncherAuthFilter,
  type LauncherGroupFilter,
  type LauncherPlatformFilter,
} from '../model/hostLauncherListModel.ts'

interface HostLauncherAdvancedFiltersProps {
  activeFilterCount: number
  platformFilter: LauncherPlatformFilter
  groupFilter: LauncherGroupFilter
  authFilter: LauncherAuthFilter
  selectedTags: string[]
  groupOptions: Array<{ value: string; label: string }>
  availableTags: HostLauncherTagOption[]
  onClear: () => void
  onPlatformChange: (value: LauncherPlatformFilter) => void
  onGroupChange: (value: LauncherGroupFilter) => void
  onAuthChange: (value: LauncherAuthFilter) => void
  onToggleTag: (tag: string, checked: boolean) => void
}

export function HostLauncherAdvancedFilters({
  activeFilterCount,
  platformFilter,
  groupFilter,
  authFilter,
  selectedTags,
  groupOptions,
  availableTags,
  onClear,
  onPlatformChange,
  onGroupChange,
  onAuthChange,
  onToggleTag,
}: HostLauncherAdvancedFiltersProps) {
  const { t } = useTranslation()
  return (
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
            disabled={activeFilterCount === 0}
            onClick={onClear}
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
              popupRender={renderFilterPopup}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
              optionLabelProp="label"
              onChange={onPlatformChange}
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
              popupRender={renderFilterPopup}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
              optionLabelProp="label"
              onChange={onGroupChange}
              options={groupOptions}
            />
          </label>
          <label className="host-launcher-filter-field">
            <span>{t('hosts.authMethod')}</span>
            <Select
              value={authFilter}
              className={customSelectStyles.select}
              popupRender={renderFilterPopup}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
              optionLabelProp="label"
              onChange={onAuthChange}
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
                  onChange={(checked) => onToggleTag(tag.label, checked)}
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
}

function renderFilterPopup(content: ReactNode) {
  return <div data-host-launcher-filter-popup>{content}</div>
}
