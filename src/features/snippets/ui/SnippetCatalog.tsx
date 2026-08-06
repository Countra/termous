import { Button, Empty, Input, Popover, Segmented, Select, Tag, Tooltip } from 'antd'
import { Code2, Filter, Search, Star, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  analyzeSnippetRisk,
  normalizeSnippetTags,
  type CodeSnippet,
  type CodeSnippetGroup,
} from '#entities/snippet'
import {
  snippetTagKey,
  type SnippetCatalogDensity,
  type SnippetCatalogFilter,
  type SnippetFilterState,
  type SnippetTagSummary,
} from '../model/snippetCatalogUtils.ts'
import styles from './SnippetCatalog.module.scss'

interface SnippetFilterBarProps extends SnippetFilterState {
  availableTags: SnippetTagSummary[]
  filteredCount: number
  totalCount: number
  density: SnippetCatalogDensity
  allowTagFilter?: boolean
  groups?: CodeSnippetGroup[]
  selectedGroupId?: string
  onSelectedGroupChange?: (groupId: string) => void
  onFilterChange: (filter: SnippetCatalogFilter) => void
  onQueryChange: (query: string) => void
  onSelectedTagsChange: (tags: string[]) => void
  onClear: () => void
}

interface SnippetListProps {
  snippets: CodeSnippet[]
  totalCount: number
  density: SnippetCatalogDensity
  selectedId?: string | null
  emptyDescription: ReactNode
  noResultsDescription: ReactNode
  onSelect?: (snippet: CodeSnippet) => void
  renderActions?: (snippet: CodeSnippet) => ReactNode
}

export function SnippetFilterBar({
  filter,
  query,
  selectedTags,
  availableTags,
  filteredCount,
  totalCount,
  density,
  allowTagFilter = true,
  groups = [],
  selectedGroupId = '',
  onSelectedGroupChange,
  onFilterChange,
  onQueryChange,
  onSelectedTagsChange,
  onClear,
}: SnippetFilterBarProps) {
  const { t } = useTranslation()
  const selectedTagKeys = new Set(selectedTags.map(snippetTagKey))
  const hasFilters = filter !== 'all' || query.trim().length > 0 || selectedTags.length > 0 || Boolean(selectedGroupId)
  const activeFilterCount = selectedTags.length + (selectedGroupId ? 1 : 0)
  const scopeControl = (
    <Segmented
      block
      className="segmented-control snippet-catalog-segmented"
      value={filter}
      options={[
        { value: 'all', label: t('snippets.all'), icon: <Code2 size={13} aria-hidden="true" /> },
        { value: 'favorites', label: t('snippets.favorites'), icon: <Star size={13} aria-hidden="true" /> },
      ]}
      onChange={(value) => onFilterChange(value as SnippetCatalogFilter)}
    />
  )
  const filterContent = (
    <div className="snippet-filter-popover-content">
      <div className="snippet-filter-popover-head">
        <span><Filter size={14} aria-hidden="true" /><strong>{t('snippets.filter')}</strong></span>
        {hasFilters ? (
          <Button type="text" size="small" onClick={onClear}>
            {t('hosts.clearFilters')}
          </Button>
        ) : null}
      </div>
      {groups.length > 0 && onSelectedGroupChange ? (
        <div className="snippet-filter-popover-group">
          <div className="snippet-filter-popover-section-head">
            <span>{t('snippets.group')}</span>
          </div>
          <Select
            value={selectedGroupId}
            className="termous-select"
            classNames={{
              popup: {
                root: `termous-select-popup snippet-filter-select-popup ${styles['catalog-root']}`,
              },
            }}
            options={[
              { value: '', label: t('snippets.allGroups') },
              { value: '__ungrouped__', label: t('snippets.ungrouped') },
              ...groups.map((group) => ({ value: group.id, label: group.name })),
            ]}
            onChange={(value) => onSelectedGroupChange(value)}
          />
        </div>
      ) : null}
      <div className="snippet-filter-popover-section-head">
        <span>{t('snippets.tags')}</span>
        <small>{selectedTags.length > 0 ? selectedTags.length : availableTags.length}</small>
      </div>
      {availableTags.length > 0 ? (
        <div className="snippet-filter-popover-tags">
          {availableTags.map((tag) => (
            <Tag.CheckableTag
              key={tag.key}
              checked={selectedTagKeys.has(tag.key)}
              onChange={(checked) => {
                onSelectedTagsChange(
                  checked
                    ? normalizeSnippetTags([...selectedTags, tag.label])
                    : selectedTags.filter((item) => snippetTagKey(item) !== tag.key),
                )
              }}
            >
              <span>{tag.label}</span>
              <small>{tag.count}</small>
            </Tag.CheckableTag>
          ))}
        </div>
      ) : (
        <span className="snippet-filter-popover-empty">{t('snippets.noTags')}</span>
      )}
    </div>
  )

  return (
    <div className={`snippet-catalog-filters is-${density} ${styles['catalog-root']}`}>
      <div className="snippet-catalog-search-row">
        <Input
          className="termous-search-input snippet-catalog-search"
          value={query}
          allowClear
          variant="borderless"
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder={t('snippets.searchPlaceholder')}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {allowTagFilter ? (
          <Popover
            trigger="click"
            placement="bottomRight"
            arrow={false}
            content={filterContent}
            rootClassName={`termous-snippet-filter-popover ${styles['catalog-root']}`}
          >
            <Button
              className={`snippet-filter-button ${activeFilterCount > 0 ? 'is-active' : ''}`}
              aria-label={t('snippets.filter')}
              icon={<Filter size={15} aria-hidden="true" />}
            >
              {activeFilterCount > 0 ? <small className="snippet-filter-count">{activeFilterCount}</small> : null}
            </Button>
          </Popover>
        ) : null}
      </div>
      {density === 'compact' ? (
        <>
          <div className="snippet-compact-filter-toolbar">
            {scopeControl}
            <span className="snippet-compact-filter-result">
              <Code2 size={13} aria-hidden="true" />
              <strong>{filteredCount}</strong>
              <small>/ {totalCount}</small>
            </span>
          </div>
          {selectedTags.length > 0 ? (
            <div className="snippet-compact-selected-tags">
              {selectedTags.map((tag) => (
                <Tag
                  key={tag}
                  closable
                  onClose={(event) => {
                    event.preventDefault()
                    onSelectedTagsChange(selectedTags.filter((item) => snippetTagKey(item) !== snippetTagKey(tag)))
                  }}
                >
                  {tag}
                </Tag>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {scopeControl}
          <div className="snippet-catalog-filter-meta">
            <span>{t('snippets.filterResult', { count: filteredCount, total: totalCount })}</span>
            {selectedTags.length > 0 ? (
              <div className="snippet-catalog-active-tags">
                {selectedTags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

export function SnippetList({
  snippets,
  totalCount,
  density,
  selectedId,
  emptyDescription,
  noResultsDescription,
  onSelect,
  renderActions,
}: SnippetListProps) {
  if (snippets.length === 0) {
    return (
      <div className={`snippet-catalog-empty is-${density} ${styles['catalog-root']}`}>
        <Empty
          description={totalCount === 0 ? emptyDescription : noResultsDescription}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  return (
    <div className={`snippet-catalog-list is-${density} ${styles['catalog-root']}`} role="list">
      {snippets.map((snippet) => (
        <SnippetListItem
          key={snippet.id}
          snippet={snippet}
          density={density}
          selected={snippet.id === selectedId}
          onSelect={onSelect ? () => onSelect(snippet) : undefined}
          actions={renderActions?.(snippet)}
        />
      ))}
    </div>
  )
}

function SnippetListItem({
  snippet,
  density,
  selected,
  onSelect,
  actions,
}: {
  snippet: CodeSnippet
  density: SnippetCatalogDensity
  selected: boolean
  onSelect?: () => void
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const risk = analyzeSnippetRisk(snippet.command)
  const copy = (
    <>
      <span className="snippet-catalog-row-icon">
        <Code2 size={density === 'compact' ? 14 : 16} aria-hidden="true" />
      </span>
      <span className="snippet-catalog-row-copy">
        <span className="snippet-catalog-row-title">
          {snippet.favorite ? <Star size={12} fill="currentColor" aria-label={t('snippets.favorited')} /> : null}
          <Tooltip title={snippet.name} mouseEnterDelay={0.45}>
            <strong>{snippet.name}</strong>
          </Tooltip>
          {risk.risky ? (
            <Tooltip title={t('snippets.riskDetected')}>
              <TriangleAlert className="snippet-catalog-risk-icon" size={13} aria-label={t('snippets.riskDetected')} />
            </Tooltip>
          ) : null}
        </span>
        <Tooltip title={snippet.command} mouseEnterDelay={0.55}>
          <code>{snippet.command}</code>
        </Tooltip>
        {density === 'management' ? (
          <span className="snippet-catalog-row-meta">
            <span>{t(`snippets.shell.${snippet.shell || 'any'}`)}</span>
            {snippet.tags?.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
            <span>{t('snippets.useCount', { count: snippet.use_count ?? 0 })}</span>
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <div
      className={`snippet-catalog-row is-${density} ${selected ? 'is-selected' : ''}`}
      role="listitem"
    >
      {onSelect ? (
        <button
          type="button"
          className="snippet-catalog-row-main"
          aria-current={selected ? 'true' : undefined}
          onClick={onSelect}
        >
          {copy}
        </button>
      ) : (
        <div className="snippet-catalog-row-main">{copy}</div>
      )}
      {actions ? <div className="snippet-catalog-row-actions">{actions}</div> : null}
    </div>
  )
}
