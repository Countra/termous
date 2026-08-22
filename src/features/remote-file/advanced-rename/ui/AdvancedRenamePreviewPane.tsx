import { Button, Checkbox, Input, Select, Spin, Tooltip } from 'antd'
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  File,
  Folder,
  Link,
  RotateCcw,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AdvancedRenamePreview,
  AdvancedRenamePreviewItem,
  AdvancedRenamePreviewStatus,
} from '#entities/file'
import { customSelectStyles, uiStyles } from '#shared/ui'
import {
  filterAdvancedRenamePreviewItems,
  advancedRenameVirtualWindow,
  type AdvancedRenamePreviewFilter,
} from '../model/advancedRenameModel'
import styles from './AdvancedRenameModal.module.scss'

interface AdvancedRenamePreviewPaneProps {
  preview: AdvancedRenamePreview | null
  loading: boolean
  error: string
  excludedPaths: ReadonlySet<string>
  manualOverrides: Readonly<Record<string, string>>
  disabled: boolean
  onToggleExcluded: (path: string) => void
  onManualOverride: (path: string, value: string) => void
  onClearManualOverride: (path: string) => void
}

const previewStatuses: AdvancedRenamePreviewStatus[] = [
  'conflict',
  'invalid',
  'missing',
  'unchanged',
  'excluded',
]
const previewRowHeight = 48

export function AdvancedRenamePreviewPane({
  preview,
  loading,
  error,
  excludedPaths,
  manualOverrides,
  disabled,
  onToggleExcluded,
  onManualOverride,
  onClearManualOverride,
}: AdvancedRenamePreviewPaneProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<AdvancedRenamePreviewFilter>('all')
  const [query, setQuery] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(300)
  const viewportRef = useRef<HTMLDivElement>(null)
  const filteredItems = useMemo(() => filterAdvancedRenamePreviewItems(
    preview?.items ?? [],
    filter,
    query,
  ), [filter, preview?.items, query])
  const windowRange = advancedRenameVirtualWindow(
    filteredItems.length,
    scrollTop,
    viewportHeight,
    previewRowHeight,
  )
  const visibleItems = filteredItems.slice(windowRange.start, windowRange.end)

  useEffect(() => {
    setScrollTop(0)
    viewportRef.current?.scrollTo({ top: 0 })
  }, [filter, query])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return undefined
    }
    const updateHeight = () => setViewportHeight(viewport.clientHeight)
    const observer = new ResizeObserver(updateHeight)
    observer.observe(viewport)
    updateHeight()
    return () => observer.disconnect()
  }, [])

  return (
    <section
      className={`${styles['preview-pane']} ${preview ? styles['has-preview-summary'] : ''}`}
      aria-label={t('files.advancedRename.preview.title')}
    >
      <header className={styles['pane-heading']}>
        <span><CircleCheck size={15} aria-hidden="true" />{t('files.advancedRename.preview.title')}</span>
        {preview ? <small>{t('files.advancedRename.preview.visible', { count: filteredItems.length, total: preview.summary.total })}</small> : null}
      </header>
      <div className={styles['preview-toolbar']}>
        <Input
          allowClear
          className={uiStyles['search-input']}
          value={query}
          prefix={<Search size={13} aria-hidden="true" />}
          placeholder={t('files.advancedRename.preview.search')}
          aria-label={t('files.advancedRename.preview.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          className={customSelectStyles.select}
          classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${styles['control-popup']}` } }}
          aria-label={t('files.advancedRename.preview.filterAll')}
          value={filter}
          options={[
            { value: 'all', label: t('files.advancedRename.preview.filterAll') },
            { value: 'changed', label: t('files.advancedRename.preview.filterChanged') },
            { value: 'issues', label: t('files.advancedRename.preview.filterIssues') },
            ...previewStatuses.map((status) => ({
              value: status,
              label: t(`files.advancedRename.status.${status}`),
            })),
          ]}
          onChange={setFilter}
        />
      </div>
      {preview ? <PreviewSummary preview={preview} /> : null}
      <div className={styles['preview-table']} aria-busy={loading}>
        <div className={styles['preview-header']} aria-hidden="true">
          <span />
          <span>{t('files.advancedRename.preview.original')}</span>
          <span />
          <span>{t('files.advancedRename.preview.final')}</span>
          <span>{t('files.advancedRename.preview.state')}</span>
        </div>
        <div
          ref={viewportRef}
          className={styles['preview-body']}
          role="list"
          tabIndex={0}
          aria-label={t('files.advancedRename.preview.list')}
          aria-busy={loading}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {filteredItems.length > 0 ? (
            <div className={styles['preview-virtual-space']} style={{ height: windowRange.totalHeight }}>
              <div className={styles['preview-window']} style={{ transform: `translateY(${windowRange.offset}px)` }}>
                {visibleItems.map((item) => (
                  <PreviewRow
                    key={item.source_path}
                    item={item}
                    excluded={excludedPaths.has(item.source_path)}
                    override={manualOverrides[item.source_path]}
                    disabled={disabled}
                    onToggleExcluded={onToggleExcluded}
                    onManualOverride={onManualOverride}
                    onClearManualOverride={onClearManualOverride}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {!loading && !error && filteredItems.length === 0 ? (
            <div className={styles['preview-empty']}>{t('files.advancedRename.preview.empty')}</div>
          ) : null}
          {error ? (
            <div className={styles['preview-error']} role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        {loading ? <div className={styles['preview-loading']} role="status"><Spin size="small" /><span>{t('files.advancedRename.preview.loading')}</span></div> : null}
      </div>
    </section>
  )
}

function PreviewSummary({ preview }: { preview: AdvancedRenamePreview }) {
  const { t } = useTranslation()
  return (
    <div className={styles['preview-summary']}>
      <span className={styles['is-changed']}><i />{t('files.advancedRename.summary.changed', { count: preview.summary.changed })}</span>
      <span><i />{t('files.advancedRename.summary.unchanged', { count: preview.summary.unchanged })}</span>
      <span><i />{t('files.advancedRename.summary.excluded', { count: preview.summary.excluded })}</span>
      <span className={preview.summary.blocked > 0 ? styles['is-blocked'] : ''}>
        <i />{t('files.advancedRename.summary.blocked', { count: preview.summary.blocked })}
      </span>
    </div>
  )
}

function PreviewRow({
  item,
  excluded,
  override,
  disabled,
  onToggleExcluded,
  onManualOverride,
  onClearManualOverride,
}: {
  item: AdvancedRenamePreviewItem
  excluded: boolean
  override?: string
  disabled: boolean
  onToggleExcluded: (path: string) => void
  onManualOverride: (path: string, value: string) => void
  onClearManualOverride: (path: string) => void
}) {
  const { t } = useTranslation()
  const KindIcon = item.kind === 'directory' ? Folder : item.kind === 'symlink' ? Link : File
  const manual = override !== undefined
  const blocked = item.status === 'invalid' || item.status === 'conflict' || item.status === 'missing'
  const diagnostics = (item.diagnostics ?? []).map((diagnostic) => diagnostic.message).filter(Boolean).join('\n')
  const statusLabel = t(`files.advancedRename.status.${item.status}`)
  const statusDescription = diagnostics ? `${statusLabel}: ${diagnostics.split('\n').join('; ')}` : statusLabel
  return (
    <div role="listitem" className={`${styles['preview-row']} ${styles[`is-${item.status}`]}`}>
      <Checkbox
        checked={!excluded}
        disabled={disabled}
        aria-label={t('files.advancedRename.preview.includeItem', { name: item.original_name })}
        onChange={() => onToggleExcluded(item.source_path)}
      />
      <span className={styles['preview-name']} title={item.original_name}>
        <KindIcon size={14} aria-hidden="true" /><code>{item.original_name}</code>
      </span>
      <ArrowRight size={13} aria-hidden="true" className={styles['preview-arrow']} />
      <span className={styles['preview-final']}>
        <Input
          value={manual ? override : item.final_name}
          disabled={disabled || excluded || item.status === 'missing'}
          status={blocked && !excluded ? 'error' : undefined}
          aria-label={t('files.advancedRename.preview.finalName', { name: item.original_name })}
          onChange={(event) => onManualOverride(item.source_path, event.target.value)}
        />
        {manual ? (
          <Tooltip title={t('files.advancedRename.preview.resetOverride')}>
            <Button
              type="text"
              size="small"
              disabled={disabled}
              aria-label={t('files.advancedRename.preview.resetOverride')}
              icon={<RotateCcw size={12} />}
              onClick={() => onClearManualOverride(item.source_path)}
            />
          </Tooltip>
        ) : null}
      </span>
      <Tooltip title={diagnostics || t(`files.advancedRename.status.${item.status}`)}>
        <span className={styles['preview-status']} tabIndex={0} aria-label={statusDescription}>
          {blocked ? <ShieldAlert size={13} aria-hidden="true" /> : <CircleCheck size={13} aria-hidden="true" />}
          <span className={styles['preview-status-label']} aria-hidden="true">{statusLabel}</span>
        </span>
      </Tooltip>
    </div>
  )
}
