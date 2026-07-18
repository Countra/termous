import { Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { File, FileQuestion, Folder, Link2, MoreHorizontal } from 'lucide-react'
import type { DragEvent, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteFileEntry } from '../../types/domain'
import { formatBytes, formatDate } from '../files/fileUtils'

interface WorkbenchFileListProps {
  entries: RemoteFileEntry[]
  selectedPaths: string[]
  loading: boolean
  listRef: RefObject<HTMLDivElement | null>
  menuFor: (entry: RemoteFileEntry) => MenuProps
  onSelect: (entry: RemoteFileEntry) => void
  onOpen: (entry: RemoteFileEntry) => void
  onScroll: () => void
  onUploadDrop: (targetPath: string, event: DragEvent<HTMLDivElement>) => void
}

export function WorkbenchFileList({
  entries,
  selectedPaths,
  loading,
  listRef,
  menuFor,
  onSelect,
  onOpen,
  onScroll,
  onUploadDrop,
}: WorkbenchFileListProps) {
  const { t } = useTranslation()

  if (!loading && entries.length === 0) {
    return (
      <div
        className="workbench-file-empty"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => onUploadDrop('', event)}
      >
        <Folder size={24} />
        <strong>{t('workbench.files.emptyDirectory')}</strong>
        <span>{t('workbench.files.emptyDirectoryHint')}</span>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className={`workbench-file-list ${loading ? 'is-loading' : ''}`}
      onScroll={onScroll}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onUploadDrop('', event)}
    >
      {entries.map((entry) => {
        const selected = selectedPaths.includes(entry.path)
        const menu = menuFor(entry)
        return (
          <Dropdown
            key={entry.path}
            menu={menu}
            trigger={['contextMenu']}
            classNames={{ root: 'files-row-menu' }}
          >
            <div
              className={`workbench-file-row ${selected ? 'is-selected' : ''} ${entry.kind === 'directory' ? 'is-directory' : ''}`}
              data-workbench-file-path={entry.path}
              data-workbench-file-kind={entry.kind}
              draggable
              role="button"
              tabIndex={0}
              aria-pressed={entry.kind === 'file' ? selected : undefined}
              onClick={() => entry.kind === 'directory' ? onOpen(entry) : onSelect(entry)}
              onDoubleClick={() => {
                if (entry.kind !== 'directory') {
                  onOpen(entry)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onOpen(entry)
                } else if (event.key === ' ' && entry.kind !== 'directory') {
                  event.preventDefault()
                  onSelect(entry)
                }
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'copy'
                event.dataTransfer.setData(
                  'application/x-termous-remote-download',
                  JSON.stringify({ paths: selected ? selectedPaths : [entry.path] }),
                )
              }}
              onDragOver={(event) => {
                if (entry.kind === 'directory' && event.dataTransfer.types.includes('Files')) {
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.classList.add('is-upload-target')
                }
              }}
              onDragLeave={(event) => event.currentTarget.classList.remove('is-upload-target')}
              onDrop={(event) => {
                event.currentTarget.classList.remove('is-upload-target')
                if (entry.kind === 'directory') {
                  onUploadDrop(entry.path, event)
                }
              }}
            >
              <span className="workbench-file-row-icon">{fileIcon(entry)}</span>
              <Tooltip title={entry.name} mouseEnterDelay={0.5}>
                <span className="workbench-file-row-name">{entry.name}</span>
              </Tooltip>
              <span className="workbench-file-row-meta">
                {entry.kind === 'directory' ? formatDate(entry.modified_at) : formatBytes(entry.size)}
              </span>
              <Dropdown menu={menu} trigger={['click']} classNames={{ root: 'files-row-menu' }}>
                <Button
                  type="text"
                  size="small"
                  className="workbench-file-row-menu"
                  aria-label={t('workbench.files.moreActions')}
                  icon={<MoreHorizontal size={15} />}
                  onClick={(event) => event.stopPropagation()}
                />
              </Dropdown>
            </div>
          </Dropdown>
        )
      })}
      {loading ? <div className="workbench-file-list-loading">{t('workbench.files.refreshing')}</div> : null}
    </div>
  )
}

function fileIcon(entry: RemoteFileEntry) {
  if (entry.kind === 'directory') {
    return <Folder size={17} />
  }
  if (entry.kind === 'symlink') {
    return <Link2 size={17} />
  }
  if (entry.kind === 'file') {
    return <File size={17} />
  }
  return <FileQuestion size={17} />
}
