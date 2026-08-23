import { Button, Input, InputNumber, Segmented, Select, Space, Switch, Tooltip } from 'antd'
import type { InputNumberProps } from 'antd'
import {
  CircleAlert,
  FileClock,
  FileType2,
  FolderRoot,
  HardDrive,
  ListFilter,
  Regex,
  RotateCcw,
  Route,
  ScanSearch,
  X,
} from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileNameSearchEntryType } from '#entities/file'
import { customSelectStyles, DateTimePicker, FilterPopover } from '#shared/ui'
import {
  globalFileSearchCaseModes,
  globalFileSearchHiddenModes,
  globalFileSearchIgnoreModes,
  globalFileSearchMatchModes,
  globalFileSearchMatchTargets,
  globalFileSearchMaxExcludeGlobs,
  globalFileSearchMaxExtensions,
  globalFileSearchMaxDepth,
} from '../model/globalFileSearchModel'
import type {
  GlobalFileSearchAdvancedFilters,
  GlobalFileSearchScope,
} from '../model/types'
import styles from './GlobalFileSearchFilters.module.scss'

interface GlobalFileSearchFiltersProps {
  filters: GlobalFileSearchAdvancedFilters
  entryType: FileNameSearchEntryType
  oneFileSystem: boolean
  searchScope: GlobalFileSearchScope
  currentPath: string
  activeCount: number
  disabled: boolean
  onFilterChange: <Key extends keyof GlobalFileSearchAdvancedFilters>(
    key: Key,
    value: GlobalFileSearchAdvancedFilters[Key],
  ) => void
  onOneFileSystemChange: (value: boolean) => void
  onSearchScopeChange: (value: GlobalFileSearchScope) => void
  onReset: () => void
}

const bytesPerMiB = 1024 * 1024

function parseDateTime(value: string | null) {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function sizeInMiB(value: number | null) {
  return value === null ? null : Number((value / bytesPerMiB).toFixed(2))
}

export function GlobalFileSearchFilters({
  filters,
  entryType,
  oneFileSystem,
  searchScope,
  currentPath,
  activeCount,
  disabled,
  onFilterChange,
  onOneFileSystemChange,
  onSearchScopeChange,
  onReset,
}: GlobalFileSearchFiltersProps) {
  const { t } = useTranslation()
  const selectPopupClassName = `${customSelectStyles['select-popup']} ${styles['select-popup']}`
  const filterCount = activeCount + (oneFileSystem ? 1 : 0)
  const searchRootInvalid = !filters.searchRoot.trim().startsWith('/')
  const modifiedAfter = filters.modifiedAfter ? Date.parse(filters.modifiedAfter) : null
  const modifiedBefore = filters.modifiedBefore ? Date.parse(filters.modifiedBefore) : null
  const modifiedRangeInvalid = modifiedAfter !== null
    && modifiedBefore !== null
    && modifiedAfter >= modifiedBefore
  const sizeRangeInvalid = filters.minSizeBytes !== null
    && filters.maxSizeBytes !== null
    && filters.minSizeBytes > filters.maxSizeBytes
  const filtersInvalid = searchRootInvalid || modifiedRangeInvalid || sizeRangeInvalid
  const matchOptions = useMemo(() => globalFileSearchMatchModes.map((value) => ({
    value,
    label: t(`files.globalSearch.filters.matchModes.${value}`),
  })), [t])
  const caseOptions = useMemo(() => globalFileSearchCaseModes.map((value) => ({
    value,
    label: t(`files.globalSearch.filters.caseModes.${value}`),
  })), [t])
  const targetOptions = useMemo(() => globalFileSearchMatchTargets.map((value) => ({
    value,
    label: t(`files.globalSearch.filters.matchTargets.${value}`),
  })), [t])
  const hiddenOptions = useMemo(() => globalFileSearchHiddenModes.map((value) => ({
    value,
    label: t(`files.globalSearch.filters.hiddenModes.${value}`),
  })), [t])
  const ignoreOptions = useMemo(() => globalFileSearchIgnoreModes.map((value) => ({
    value,
    label: t(`files.globalSearch.filters.ignoreModes.${value}`),
  })), [t])

  return (
    <FilterPopover
      popupClassName={styles['filters-popover']}
      content={(
        <div className={styles.panel}>
          <header className={styles.header}>
            <span>
              <ListFilter size={15} aria-hidden="true" />
              <strong>{t('files.globalSearch.filters.title')}</strong>
            </span>
            <Tooltip title={t('files.globalSearch.filters.reset')}>
              <Button
                type="text"
                size="small"
                disabled={disabled || filterCount === 0}
                aria-label={t('files.globalSearch.filters.reset')}
                icon={<RotateCcw size={13} aria-hidden="true" />}
                onClick={() => {
                  onReset()
                  onOneFileSystemChange(false)
                  onSearchScopeChange('system')
                }}
              />
            </Tooltip>
          </header>

          <FilterSection
            icon={<Regex size={14} aria-hidden="true" />}
            title={t('files.globalSearch.filters.matching')}
          >
            <div className={styles['field-grid']}>
              <FilterSelect
                label={t('files.globalSearch.filters.matchMode')}
                value={filters.matchMode}
                options={matchOptions}
                popupClassName={selectPopupClassName}
                disabled={disabled}
                onChange={(value) => onFilterChange('matchMode', value)}
              />
              <FilterSelect
                label={t('files.globalSearch.filters.caseMode')}
                value={filters.caseMode}
                options={caseOptions}
                popupClassName={selectPopupClassName}
                disabled={disabled}
                onChange={(value) => onFilterChange('caseMode', value)}
              />
              <FilterSelect
                label={t('files.globalSearch.filters.matchTarget')}
                value={filters.matchTarget}
                options={targetOptions}
                popupClassName={selectPopupClassName}
                disabled={disabled}
                onChange={(value) => onFilterChange('matchTarget', value)}
              />
            </div>
            <small className={styles.hint}>{t(
              filters.matchMode === 'regex'
                ? 'files.globalSearch.filters.regexHint'
                : filters.matchMode === 'glob'
                  ? 'files.globalSearch.filters.globHint'
                  : 'files.globalSearch.filters.literalHint',
            )}</small>
          </FilterSection>

          <FilterSection
            icon={<FolderRoot size={14} aria-hidden="true" />}
            title={t('files.globalSearch.filters.scope')}
          >
            <Segmented<'system' | 'directory'>
              block
              size="small"
              className={styles.segmented}
              value={searchScope}
              disabled={disabled}
              options={[
                {
                  value: 'system',
                  icon: <HardDrive size={13} aria-hidden="true" />,
                  label: t('files.globalSearch.filters.entireSystem'),
                },
                {
                  value: 'directory',
                  icon: <Route size={13} aria-hidden="true" />,
                  label: t('files.globalSearch.filters.directory'),
                },
              ]}
              onChange={onSearchScopeChange}
            />
            {searchScope === 'directory' ? (
              <label className={styles.field}>
                <span>{t('files.globalSearch.filters.searchRoot')}</span>
                <Input
                  value={filters.searchRoot}
                  disabled={disabled}
                  status={searchRootInvalid ? 'error' : undefined}
                  aria-label={t('files.globalSearch.filters.searchRoot')}
                  onChange={(event) => onFilterChange('searchRoot', event.target.value)}
                  onBlur={() => {
                    if (!filters.searchRoot.trim()) {
                      onFilterChange('searchRoot', currentPath)
                    }
                  }}
                />
              </label>
            ) : null}
            {searchRootInvalid ? (
              <small className={`${styles.hint} ${styles['is-error']}`}>
                {t('files.globalSearch.filters.searchRootInvalid')}
              </small>
            ) : null}
            <ToggleRow
              icon={<HardDrive size={13} aria-hidden="true" />}
              label={t('files.globalSearch.oneFileSystem')}
              description={t('files.globalSearch.oneFileSystemHint')}
              checked={oneFileSystem}
              disabled={disabled}
              onChange={onOneFileSystemChange}
            />
          </FilterSection>

          <FilterSection
            icon={<ScanSearch size={14} aria-hidden="true" />}
            title={t('files.globalSearch.filters.traversal')}
          >
            <div className={styles['field-grid']}>
              <FilterSelect
                label={t('files.globalSearch.filters.hiddenMode')}
                value={filters.hiddenMode}
                options={hiddenOptions}
                popupClassName={selectPopupClassName}
                disabled={disabled}
                onChange={(value) => onFilterChange('hiddenMode', value)}
              />
              <FilterSelect
                label={t('files.globalSearch.filters.ignoreMode')}
                value={filters.ignoreMode}
                options={ignoreOptions}
                popupClassName={selectPopupClassName}
                disabled={disabled}
                onChange={(value) => onFilterChange('ignoreMode', value)}
              />
              <label className={styles.field}>
                <span>{t('files.globalSearch.filters.maxDepth')}</span>
                <InputNumber
                  min={0}
                  max={globalFileSearchMaxDepth}
                  precision={0}
                  value={filters.maxDepth}
                  disabled={disabled}
                  aria-label={t('files.globalSearch.filters.maxDepth')}
                  onChange={(value) => onFilterChange('maxDepth', value ?? 0)}
                />
              </label>
            </div>
          </FilterSection>

          <FilterSection
            icon={<FileType2 size={14} aria-hidden="true" />}
            title={t('files.globalSearch.filters.fileRules')}
          >
            <label className={styles.field}>
              <span>{t('files.globalSearch.filters.extensions')}</span>
              <FilterTagInput
                value={filters.extensions}
                disabled={disabled}
                label={t('files.globalSearch.filters.extensions')}
                placeholder={t('files.globalSearch.filters.extensionsPlaceholder')}
                limit={globalFileSearchMaxExtensions}
                onChange={(values) => onFilterChange('extensions', values)}
              />
            </label>
            <label className={styles.field}>
              <span>{t('files.globalSearch.filters.excludeGlobs')}</span>
              <FilterTagInput
                value={filters.excludeGlobs}
                disabled={disabled}
                label={t('files.globalSearch.filters.excludeGlobs')}
                placeholder={t('files.globalSearch.filters.excludeGlobsPlaceholder')}
                limit={globalFileSearchMaxExcludeGlobs}
                onChange={(values) => onFilterChange('excludeGlobs', values)}
              />
            </label>
          </FilterSection>

          <FilterSection
            icon={<FileClock size={14} aria-hidden="true" />}
            title={t('files.globalSearch.filters.metadata')}
          >
            <div className={styles['range-grid']}>
              <label className={styles.field}>
                <span>{t('files.globalSearch.filters.modifiedAfter')}</span>
                <DateTimePicker
                  value={parseDateTime(filters.modifiedAfter)}
                  size="small"
                  popupZIndex={3560}
                  disabled={disabled}
                  status={modifiedRangeInvalid ? 'error' : undefined}
                  ariaLabel={t('files.globalSearch.filters.modifiedAfter')}
                  onChange={(value) => onFilterChange(
                    'modifiedAfter',
                    value?.toISOString() ?? null,
                  )}
                />
              </label>
              <label className={styles.field}>
                <span>{t('files.globalSearch.filters.modifiedBefore')}</span>
                <DateTimePicker
                  value={parseDateTime(filters.modifiedBefore)}
                  size="small"
                  popupZIndex={3560}
                  disabled={disabled}
                  status={modifiedRangeInvalid ? 'error' : undefined}
                  ariaLabel={t('files.globalSearch.filters.modifiedBefore')}
                  onChange={(value) => onFilterChange(
                    'modifiedBefore',
                    value?.toISOString() ?? null,
                  )}
                />
              </label>
            </div>
            <div className={styles['range-grid']}>
              <label className={styles.field}>
                <span>{t('files.globalSearch.filters.minSize')}</span>
                <FileSizeInput
                  value={sizeInMiB(filters.minSizeBytes)}
                  disabled={disabled || entryType !== 'file'}
                  status={sizeRangeInvalid ? 'error' : undefined}
                  label={t('files.globalSearch.filters.minSize')}
                  onChange={(value) => onFilterChange(
                    'minSizeBytes',
                    value === null ? null : Math.round(value * bytesPerMiB),
                  )}
                />
              </label>
              <label className={styles.field}>
                <span>{t('files.globalSearch.filters.maxSize')}</span>
                <FileSizeInput
                  value={sizeInMiB(filters.maxSizeBytes)}
                  disabled={disabled || entryType !== 'file'}
                  status={sizeRangeInvalid ? 'error' : undefined}
                  label={t('files.globalSearch.filters.maxSize')}
                  onChange={(value) => onFilterChange(
                    'maxSizeBytes',
                    value === null ? null : Math.round(value * bytesPerMiB),
                  )}
                />
              </label>
            </div>
            {entryType !== 'file' ? (
              <small className={styles.hint}>{t('files.globalSearch.filters.sizeFileOnly')}</small>
            ) : sizeRangeInvalid ? (
              <small className={`${styles.hint} ${styles['is-error']}`}>
                {t('files.globalSearch.filters.sizeRangeInvalid')}
              </small>
            ) : null}
            {modifiedRangeInvalid ? (
              <small className={`${styles.hint} ${styles['is-error']}`}>
                {t('files.globalSearch.filters.modifiedRangeInvalid')}
              </small>
            ) : null}
          </FilterSection>
        </div>
      )}
    >
      <Button
        className={`${styles.trigger} ${filtersInvalid ? styles['has-error'] : ''}`}
        disabled={disabled}
        aria-label={t('files.globalSearch.filters.action')}
        aria-invalid={filtersInvalid}
        icon={<ListFilter size={14} aria-hidden="true" />}
      >
        <span className={styles['trigger-label']}>{t('files.globalSearch.filters.action')}</span>
        {filtersInvalid ? (
          <i className={styles['is-error']} aria-label={t('files.globalSearch.filters.invalid')}>
            <CircleAlert size={12} aria-hidden="true" />
          </i>
        ) : filterCount > 0 ? (
          <i aria-label={t('files.globalSearch.filters.active', { count: filterCount })}>{filterCount}</i>
        ) : null}
      </Button>
    </FilterPopover>
  )
}

function FilterSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <header>{icon}<strong>{title}</strong></header>
      {children}
    </section>
  )
}

function FilterSelect<Value extends string>({
  label,
  value,
  options,
  popupClassName,
  disabled,
  onChange,
}: {
  label: string
  value: Value
  options: Array<{ value: Value; label: string }>
  popupClassName: string
  disabled: boolean
  onChange: (value: Value) => void
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <Select<Value>
        value={value}
        options={options}
        disabled={disabled}
        className={customSelectStyles.select}
        classNames={{ popup: { root: popupClassName } }}
        aria-label={label}
        onChange={onChange}
      />
    </label>
  )
}

function FilterTagInput({
  label,
  value,
  placeholder,
  limit,
  disabled,
  onChange,
}: {
  label: string
  value: string[]
  placeholder: string
  limit: number
  disabled: boolean
  onChange: (value: string[]) => void
}) {
  return (
    <Select
      mode="tags"
      value={value}
      disabled={disabled}
      maxTagCount={2}
      tokenSeparators={[',']}
      open={false}
      suffixIcon={null}
      removeIcon={<X size={10} strokeWidth={2} aria-hidden="true" />}
      className={`${customSelectStyles.select} ${styles['tag-input']}`}
      aria-label={label}
      placeholder={placeholder}
      onChange={(values) => onChange(values.slice(0, limit))}
    />
  )
}

function FileSizeInput({
  value,
  disabled,
  status,
  label,
  onChange,
}: {
  value: number | null
  disabled: boolean
  status?: InputNumberProps<number>['status']
  label: string
  onChange: (value: number | null) => void
}) {
  return (
    <Space.Compact
      block
      size="small"
      className={styles['size-control']}
      data-disabled={disabled ? 'true' : undefined}
      data-status={status}
    >
      <InputNumber<number>
        min={0}
        precision={2}
        value={value}
        disabled={disabled}
        status={status}
        variant="borderless"
        className={styles['size-number']}
        aria-label={`${label} (MiB)`}
        onChange={onChange}
      />
      <Space.Addon
        variant="borderless"
        disabled={disabled}
        className={styles['size-unit']}
      >
        MiB
      </Space.Addon>
    </Space.Compact>
  )
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: ReactNode
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className={styles['toggle-row']}>
      <span className={styles['toggle-icon']} aria-hidden="true">{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  )
}
