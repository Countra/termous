import { Button, Dropdown, Input, Modal, Skeleton, Table } from 'antd'
import { ArrowDownWideNarrow, ChevronDown, File, Folder, FolderOpen, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes, formatDate } from '#shared/format'
import { confirmDialogStyles, contextActionMenuPopupClassName } from '#shared/ui'
import styles from './DesktopFileList.module.scss'

export interface DesktopListItem {
  path: string
  name: string
  kind: string
  size: number
  modified_at?: string
  location?: string
}

interface Props {
  entries: DesktopListItem[]
  selected: string[]
  onSelect: (paths: string[]) => void
  onOpenDirectory?: (path: string) => void
  actions?: (entry: DesktopListItem) => ReactNode
  loading?: boolean
  disabled?: boolean
  empty?: ReactNode
  footerAction?: ReactNode
}

// 文件名始终是可读内容；目录导航与文件详情分开处理，不使用禁用按钮显示文件。
export function DesktopFileList({ entries, selected, onSelect, onOpenDirectory, actions, loading, disabled, empty, footerAction }: Props) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [details, setDetails] = useState<DesktopListItem>()
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const element = root.current!
    const measure = () => setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(measure)
    measure(); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const visible = useMemo(() => {
    const collator = new Intl.Collator(i18n?.language, { numeric: true, sensitivity: 'base' })
    const query = search.trim().toLocaleLowerCase()
    return entries.filter(entry => entry.name.toLocaleLowerCase().includes(query)).sort((a, b) => {
      if (a.kind !== b.kind && (a.kind === 'directory' || b.kind === 'directory')) return a.kind === 'directory' ? -1 : 1
      const order = sort === 'size' ? b.size - a.size : sort === 'modified' ? (Date.parse(b.modified_at ?? '') || 0) - (Date.parse(a.modified_at ?? '') || 0) : 0
      return order || collator.compare(a.name, b.name)
    })
  }, [entries, search, sort, i18n?.language])
  const open = (entry: DesktopListItem) => entry.kind === 'directory' && onOpenDirectory ? onOpenDirectory(entry.path) : setDetails(entry)
  return <div className={styles.list} ref={root}>
    <div className={styles.filters}>
      <Input allowClear prefix={<Search size={15} />} placeholder={t('remoteDesktop.files.search')} aria-label={t('remoteDesktop.files.search')} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
      <Dropdown trigger={['click']} classNames={{ root: contextActionMenuPopupClassName }} menu={{ selectable: true, selectedKeys: [sort],
        items: ['name', 'modified', 'size'].map(key => ({ key, label: t(`remoteDesktop.files.sortBy.${key}`) })), onClick: ({ key }) => { setSort(key); setPage(1) } }}>
        <Button className={styles.sort} icon={<ArrowDownWideNarrow size={15} />} aria-label={t('remoteDesktop.files.sort')} title={t(`remoteDesktop.files.sortBy.${sort}`)}><span className={styles['sort-label']}>{t(`remoteDesktop.files.sortBy.${sort}`)}</span><ChevronDown size={12} /></Button>
      </Dropdown>
    </div>
    <div className={styles.table} aria-label={t('remoteDesktop.files.entries')} aria-busy={loading}>
      {loading ? <div className={styles.skeleton}><Skeleton active paragraph={{ rows: 6 }} title={false} /></div> : <Table<DesktopListItem> className={styles.grid} scroll={{ scrollToFirstRowOnChange: true }}
        rowKey="path" dataSource={visible} pagination={{ pageSize: 100, current: Math.min(page, Math.max(1, Math.ceil(visible.length / 100))), hideOnSinglePage: true, showSizeChanger: false, onChange: setPage }} tableLayout="fixed"
        rowSelection={{ columnWidth: 36, selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: keys => onSelect(keys.map(String)), getCheckboxProps: entry => ({ disabled: disabled || !['file', 'directory'].includes(entry.kind), 'aria-label': t('remoteDesktop.files.select', { name: entry.name }) }) }}
        locale={{ emptyText: <div className={styles.empty} role="status"><span><FolderOpen size={24} strokeWidth={1.5} /></span><p>{search ? t('remoteDesktop.files.noResults') : empty ?? t('remoteDesktop.files.empty')}</p></div> }}
        columns={[
          { title: t('remoteDesktop.files.name'), key: 'name', render: (_, entry) => <button type="button" className={styles.filename} title={entry.name} onClick={() => open(entry)}>
            <span className={`${styles.icon} ${entry.kind === 'directory' ? styles.folder : ''}`}>{entry.kind === 'directory' ? <Folder size={17} /> : <File size={17} />}</span>
            <span className={styles.label}>{entry.name}</span>
          </button> },
          { title: t('remoteDesktop.files.size'), key: 'size', width: width < 440 ? 72 : 92, className: styles.size, render: (_, entry) => entry.kind === 'directory' ? t('remoteDesktop.files.folder') : formatBytes(entry.size) },
          ...(width >= 540 && entries.some(entry => entry.modified_at && formatDate(entry.modified_at) !== '-') ? [{ title: t('remoteDesktop.files.modified'), key: 'modified', width: 144, className: styles.modified, render: (_: unknown, entry: DesktopListItem) => entry.modified_at ? formatDate(entry.modified_at) : '—' }] : []),
          ...(actions ? [{ key: 'actions', width: 40, render: (_: unknown, entry: DesktopListItem) => actions(entry) }] : []),
        ]} />}
    </div>
    <div className={styles.status} aria-live="polite">
      <div><span>{t('remoteDesktop.files.itemCount', { count: visible.length })}</span>
        {selected.length > 0 && <><span>{t('remoteDesktop.files.selectedCount', { count: selected.length })}</span><Button type="text" size="small" aria-label={t('remoteDesktop.files.clearSelection')} title={t('remoteDesktop.files.clearSelection')} icon={footerAction ? <X size={13} /> : undefined} disabled={disabled} onClick={() => onSelect([])}>{footerAction ? undefined : t('remoteDesktop.files.clearSelection')}</Button></>}
      </div>
      {footerAction}
    </div>
    <Modal open={!!details} title={t('remoteDesktop.files.properties')} footer={null} onCancel={() => setDetails(undefined)} centered className={confirmDialogStyles.modal} rootClassName={confirmDialogStyles['modal-root']}>
      {details && <dl className={styles.details}>
        <dt>{t('remoteDesktop.files.name')}</dt><dd>{details.name}</dd>
        <dt>{t('remoteDesktop.files.location')}</dt><dd>{details.location ?? details.path}</dd>
        <dt>{t('remoteDesktop.files.size')}</dt><dd>{details.kind === 'directory' ? t('remoteDesktop.files.folder') : formatBytes(details.size)}</dd>
        {details.modified_at && <><dt>{t('remoteDesktop.files.modified')}</dt><dd>{formatDate(details.modified_at)}</dd></>}
      </dl>}
    </Modal>
  </div>
}
