import { ChevronDown, File, Folder } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopClipboardSelection as Selection } from '#features/remote-desktop'
import { formatBytes } from '#shared/format'
import styles from './DesktopClipboardSelection.module.scss'

export function DesktopClipboardSelection({ items, totalBytes }: { items: Selection['items']; totalBytes?: number }) {
  const { t } = useTranslation()
  const id = useId()
  const total = totalBytes ?? (items.every(item => item.kind === 'file' && item.size !== undefined)
    ? items.reduce((sum, item) => sum + (item.size ?? 0), 0) : undefined)
  const [expanded, setExpanded] = useState<Selection['items'][number]>()
  const list = useRef<HTMLUListElement>(null)
  const expandedRow = useRef<HTMLLIElement>(null)
  useLayoutEffect(() => {
    if (!expanded || !list.current || !expandedRow.current) return
    // 只在展开时滚动清单，让底部条目的详情可见，不打断轮询或滚动外层页面。
    const bounds = list.current.getBoundingClientRect()
    const row = expandedRow.current.getBoundingClientRect()
    if (row.top < bounds.top) list.current.scrollTop -= bounds.top - row.top
    else if (row.bottom > bounds.bottom) list.current.scrollTop += Math.min(row.bottom - bounds.bottom, row.top - bounds.top)
  }, [expanded])
  return <div className={styles.selection}>
    <div className={styles.summary}><strong>{t('remoteDesktop.files.itemCount', { count: items.length })}</strong>
      {total !== undefined && <span>{t('remoteDesktop.files.totalSize', { size: formatBytes(total) })}</span>}
    </div>
    <ul ref={list} className={styles.list} aria-label={t('remoteDesktop.files.sendSelection')}>
      {items.map((item, index) => {
        const open = expanded === item
        const type = t(`remoteDesktop.files.${item.kind === 'directory' ? 'folder' : 'file'}`)
        const extension = item.kind === 'file' ? /.+\.([a-z\d]{1,8})$/i.exec(item.name)?.[1]?.toUpperCase() : undefined
        const size = item.kind === 'directory' || item.size === undefined ? '—' : formatBytes(item.size)
        return <li ref={open ? expandedRow : undefined} key={`${index}:${item.name}`} data-open={open || undefined}>
          <button type="button" className={styles.row} aria-label={item.name} aria-expanded={open} aria-controls={open ? `${id}-${index}` : undefined}
            onClick={() => setExpanded(open ? undefined : item)} onKeyDown={event => {
              if (event.key === 'Escape' && open) { event.stopPropagation(); setExpanded(undefined) }
            }}>
            <span className={styles.filename}>
              <span className={styles.icon} data-folder={item.kind === 'directory' || undefined} aria-hidden="true">{item.kind === 'directory' ? <Folder size={17} /> : <File size={17} />}</span>
              <span className={styles.caption}>
                <span className={styles.name} title={item.name}>{item.name}</span>
                <span className={styles.type}><span>{type}</span>{extension && <span className={styles.extension}>{extension}</span>}</span>
              </span>
            </span>
            <span className={styles.size}>{size}</span>
            <ChevronDown size={13} className={styles.chevron} aria-hidden="true" />
          </button>
          {open && <dl id={`${id}-${index}`} className={styles.details}>
            <div className={styles['full-name']}><dt>{t('remoteDesktop.files.name')}</dt><dd>{item.name}</dd></div>
            <div><dt>{t('remoteDesktop.files.type')}</dt><dd>{extension ? `${extension} · ${type}` : type}</dd></div>
            <div><dt>{t('remoteDesktop.files.size')}</dt><dd>{size}{item.kind === 'file' && item.size !== undefined && <span className={styles.bytes}>{t('remoteDesktop.files.byteSize', { size: item.size.toLocaleString() })}</span>}</dd></div>
          </dl>}
        </li>
      })}
    </ul>
  </div>
}
