import { Button, Dropdown, type MenuProps } from 'antd'
import { ChevronRight, File, FileQuestion, Folder, Link2, LoaderCircle, UploadCloud } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteFileEntry } from '../../types/domain'
import { formatBytes, formatDate } from '../files/fileUtils'
import { isLocalFileDrag } from './workbenchFileDrag'
import './workbench-file-browser.css'

interface WorkbenchFileListProps {
  entries: RemoteFileEntry[]
  selectedPaths: string[]
  listingPath: string
  loading: boolean
  initialLoading: boolean
  uploading: boolean
  listRef: RefObject<HTMLDivElement | null>
  menuFor: (entry: RemoteFileEntry) => MenuProps
  onSelect: (entry: RemoteFileEntry) => void
  onOpen: (entry: RemoteFileEntry) => Promise<boolean>
  onScroll: () => void
  onUploadDrop: (targetPath: string, event: DragEvent<HTMLDivElement>) => void
  onUploadFiles: () => void
}

export function WorkbenchFileList({
  entries,
  selectedPaths,
  listingPath,
  loading,
  initialLoading,
  uploading,
  listRef,
  menuFor,
  onSelect,
  onOpen,
  onScroll,
  onUploadDrop,
  onUploadFiles,
}: WorkbenchFileListProps) {
  const { t } = useTranslation()
  const [uploadTargetPath, setUploadTargetPath] = useState<string | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const pendingKeyboardDirectoryPathRef = useRef<string | null>(null)
  const focusFrameRef = useRef<number | null>(null)
  const uploadTarget = entries.find((entry) => entry.kind === 'directory' && entry.path === uploadTargetPath)
  const tabbablePath = entries.some((entry) => entry.path === focusedPath)
    ? focusedPath
    : selectedPaths.find((path) => entries.some((entry) => entry.path === path)) ?? entries[0]?.path ?? null
  const acceptsLocalFiles = (event: DragEvent<HTMLDivElement>) => (
    isLocalFileDrag(Array.from(event.dataTransfer.types))
  )

  const focusEntry = (index: number) => {
    const entry = entries[index]
    if (!entry) {
      return
    }
    setFocusedPath(entry.path)
    onSelect(entry)
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
    }
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      const row = rowRefs.current.get(entry.path)
      const list = listRef.current
      if (!row || !list) {
        return
      }
      row.focus({ preventScroll: true })
      const rowRect = row.getBoundingClientRect()
      const listRect = list.getBoundingClientRect()
      const transferRect = list
        .closest('.workbench-files-panel')
        ?.querySelector('.workbench-file-transfer')
        ?.getBoundingClientRect()
      const visibleBottom = transferRect
        ? Math.min(listRect.bottom, transferRect.top - 6)
        : listRect.bottom
      if (rowRect.top < listRect.top) {
        list.scrollTop -= listRect.top - rowRect.top
      } else if (rowRect.bottom > visibleBottom) {
        list.scrollTop += rowRect.bottom - visibleBottom
      }
    })
  }

  useEffect(() => () => {
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
    }
  }, [])

  const clearUploadTargetWhenLeaving = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setUploadTargetPath(null)
    }
  }

  useLayoutEffect(() => {
    const pendingPath = pendingKeyboardDirectoryPathRef.current
    if (!pendingPath || pendingPath !== listingPath) {
      return
    }
    pendingKeyboardDirectoryPathRef.current = null
    const firstEntry = entries[0]
    if (firstEntry) {
      rowRefs.current.get(firstEntry.path)?.focus({ preventScroll: true })
      setFocusedPath(firstEntry.path)
      onSelect(firstEntry)
    } else {
      listRef.current?.focus({ preventScroll: true })
      setFocusedPath(null)
    }
  }, [entries, listRef, listingPath, onSelect])

  return (
    <div className="workbench-file-list-shell">
      <div
        ref={listRef}
        className={[
          'workbench-file-list',
          loading ? 'is-loading' : '',
          entries.length === 0 ? 'is-empty' : '',
          uploadTargetPath !== null ? 'is-upload-active' : '',
        ].filter(Boolean).join(' ')}
        role="listbox"
        tabIndex={entries.length === 0 ? 0 : -1}
        aria-label={t('workbench.files.remoteFiles')}
        aria-busy={loading}
        onScroll={onScroll}
        onDragEnter={(event) => {
          if (!acceptsLocalFiles(event)) {
            return
          }
          event.preventDefault()
          setUploadTargetPath('')
        }}
        onDragOver={(event) => {
          if (!acceptsLocalFiles(event)) {
            return
          }
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setUploadTargetPath('')
        }}
        onDragLeave={clearUploadTargetWhenLeaving}
        onDrop={(event) => {
          setUploadTargetPath(null)
          if (!acceptsLocalFiles(event)) {
            return
          }
          onUploadDrop('', event)
        }}
      >
      {initialLoading ? (
        <div className="workbench-file-skeleton" aria-label={t('workbench.files.refreshing')}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="workbench-file-skeleton-row">
              <span />
              <span />
              <span />
            </span>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="workbench-file-empty">
          <span className="workbench-file-empty-icon" aria-hidden="true">
            <Folder size={22} />
          </span>
          <strong>{t('workbench.files.emptyDirectory')}</strong>
          <span>{t('workbench.files.emptyDirectoryHint')}</span>
          <Button
            type="primary"
            size="small"
            icon={<UploadCloud size={14} />}
            loading={uploading}
            onClick={onUploadFiles}
          >
            {t('files.uploadFiles')}
          </Button>
        </div>
      ) : (
        entries.map((entry, index) => {
          const selected = selectedPaths.includes(entry.path)
          const menu = menuFor(entry)
          const directory = entry.kind === 'directory'
          return (
            <Dropdown
              key={entry.path}
              menu={menu}
              trigger={['contextMenu']}
              classNames={{ root: 'files-row-menu' }}
            >
              <div
                ref={(node) => {
                  if (node) {
                    rowRefs.current.set(entry.path, node)
                  } else {
                    rowRefs.current.delete(entry.path)
                  }
                }}
                className={[
                  'workbench-file-row',
                  selected ? 'is-selected' : '',
                  directory ? 'is-directory' : '',
                  uploadTargetPath === entry.path ? 'is-upload-target' : '',
                ].filter(Boolean).join(' ')}
                data-workbench-file-path={entry.path}
                data-workbench-file-kind={entry.kind}
                role="option"
                tabIndex={entry.path === tabbablePath ? 0 : -1}
                aria-selected={selected}
                aria-label={entry.name}
                onClick={() => {
                  setFocusedPath(entry.path)
                  onSelect(entry)
                }}
                onDoubleClick={() => void onOpen(entry)}
                onContextMenu={() => {
                  setFocusedPath(entry.path)
                  onSelect(entry)
                }}
                onFocus={() => setFocusedPath(entry.path)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) {
                    return
                  }
                  switch (event.key) {
                    case 'ArrowDown':
                      event.preventDefault()
                      focusEntry(Math.min(entries.length - 1, index + 1))
                      break
                    case 'ArrowUp':
                      event.preventDefault()
                      focusEntry(Math.max(0, index - 1))
                      break
                    case 'Home':
                      event.preventDefault()
                      focusEntry(0)
                      break
                    case 'End':
                      event.preventDefault()
                      focusEntry(entries.length - 1)
                      break
                    case 'Enter':
                      event.preventDefault()
                      if (directory) {
                        pendingKeyboardDirectoryPathRef.current = entry.path
                      }
                      void onOpen(entry).then((opened) => {
                        if (!opened && pendingKeyboardDirectoryPathRef.current === entry.path) {
                          pendingKeyboardDirectoryPathRef.current = null
                        }
                      }).catch(() => {
                        if (pendingKeyboardDirectoryPathRef.current === entry.path) {
                          pendingKeyboardDirectoryPathRef.current = null
                        }
                      })
                      break
                    case ' ':
                      event.preventDefault()
                      onSelect(entry)
                      break
                  }
                }}
                onDragEnter={(event) => {
                  if (!directory || !acceptsLocalFiles(event)) {
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  setUploadTargetPath(entry.path)
                }}
                onDragOver={(event) => {
                  if (!directory || !acceptsLocalFiles(event)) {
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'copy'
                  setUploadTargetPath(entry.path)
                }}
                onDragLeave={(event) => {
                  if (!acceptsLocalFiles(event)) {
                    return
                  }
                  const nextTarget = event.relatedTarget
                  if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                    setUploadTargetPath('')
                  }
                }}
                onDrop={(event) => {
                  if (!directory || !acceptsLocalFiles(event)) {
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  setUploadTargetPath(null)
                  onUploadDrop(entry.path, event)
                }}
              >
                <span className="workbench-file-row-icon">{fileIcon(entry)}</span>
                <span className="workbench-file-row-copy">
                  <strong title={entry.name}>{entry.name}</strong>
                  <small>{formatDate(entry.modified_at)}</small>
                </span>
                <span className="workbench-file-row-meta">
                  {directory ? t('files.kindName.directory') : formatBytes(entry.size)}
                </span>
                <span className="workbench-file-row-disclosure" aria-hidden="true">
                  {directory ? <ChevronRight size={14} /> : null}
                </span>
              </div>
            </Dropdown>
          )
        })
      )}
      </div>
      {loading && !initialLoading ? (
        <div className="workbench-file-list-loading" role="status">
          <LoaderCircle className="is-spinning" size={12} />
          {t('workbench.files.refreshing')}
        </div>
      ) : null}
      {uploadTargetPath !== null ? (
        <div className="workbench-file-upload-overlay" aria-hidden="true">
          <span><UploadCloud size={19} /></span>
          <strong>
            {uploadTarget
              ? t('files.dropUploadToDirectory', { name: uploadTarget.name })
              : t('files.dropUpload')}
          </strong>
          <small>{t('workbench.files.releaseToUpload')}</small>
        </div>
      ) : null}
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
