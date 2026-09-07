import { Button, Dropdown, type MenuProps } from 'antd'
import { ChevronRight, File, FileQuestion, Folder, Link2, LoaderCircle, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { RemoteFileEntry } from '#entities/file'
import { formatBytes, formatDate } from '#shared/format'
import { uiStyles } from '#shared/ui'
import { useShortcutRuntime } from '#entities/shortcuts'
import { isLocalFileDrag } from '../model/workbenchFileDrag'
import {
  resolveWorkbenchFileSelection,
  type WorkbenchFileSelectionModifiers,
} from '../model/workbenchFileSelection'
import styles from './WorkbenchFileList.module.scss'

const scopedClassName = (className: string) => `${className} ${styles[className]}`

interface WorkbenchFileListProps {
  entries: RemoteFileEntry[]
  selectedPaths: string[]
  listingPath: string
  loading: boolean
  initialPlaceholder: boolean
  initialPending: boolean
  navigationPending: boolean
  interactionDisabled?: boolean
  pendingPath: string
  uploading: boolean
  revealPath?: string | null
  listRef: RefObject<HTMLDivElement | null>
  menuFor: (entry: RemoteFileEntry) => MenuProps
  onSelectPaths: (paths: string[]) => void
  onOpen: (entry: RemoteFileEntry) => Promise<boolean>
  onScroll: () => void
  onUploadDrop: (targetPath: string, event: DragEvent<HTMLDivElement>) => void
  onUploadFiles: () => void
  onRevealSettled?: (path: string) => void
}

interface FileNameTooltipState {
  path: string
  name: string
  left: number
  top: number
  maxWidth: number
  placement: 'above' | 'below'
}

export function WorkbenchFileList({
  entries,
  selectedPaths,
  listingPath,
  loading,
  initialPlaceholder,
  initialPending,
  navigationPending,
  interactionDisabled = false,
  pendingPath,
  uploading,
  revealPath = null,
  listRef,
  menuFor,
  onSelectPaths,
  onOpen,
  onScroll,
  onUploadDrop,
  onUploadFiles,
  onRevealSettled,
}: WorkbenchFileListProps) {
  const { t } = useTranslation()
  const { runtime: shortcutRuntime } = useShortcutRuntime()
  const shortcutInstanceId = useId()
  const shortcutContextId = `workbench.files:${shortcutInstanceId}`
  const [uploadTargetPath, setUploadTargetPath] = useState<string | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [nameTooltip, setNameTooltip] = useState<FileNameTooltipState | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const nameRefs = useRef(new Map<string, HTMLElement>())
  const selectionAnchorPathRef = useRef<string | null>(null)
  const pendingDirectoryFocusPathRef = useRef<string | null>(null)
  const completedRevealPathRef = useRef<string | null>(null)
  const focusFrameRef = useRef<number | null>(null)
  const tooltipTimerRef = useRef<number | null>(null)
  const tooltipListingRevision = useMemo(
    () => `${listingPath}\u0000${entries.map((entry) => entry.path).join('\u0000')}`,
    [entries, listingPath],
  )
  const orderedPaths = useMemo(() => entries.map((entry) => entry.path), [entries])
  const entryPathSet = useMemo(() => new Set(orderedPaths), [orderedPaths])
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths])
  const uploadTarget = entries.find((entry) => entry.kind === 'directory' && entry.path === uploadTargetPath)
  const tabbablePath = entryPathSet.has(focusedPath ?? '')
    ? focusedPath
    : selectedPaths.find((path) => entryPathSet.has(path)) ?? entries[0]?.path ?? null
  const acceptsLocalFiles = (event: DragEvent<HTMLDivElement>) => (
    isLocalFileDrag(Array.from(event.dataTransfer.types))
  )
  const interactionLocked = interactionDisabled || navigationPending || initialPlaceholder

  const selectEntry = (
    entry: RemoteFileEntry,
    modifiers: WorkbenchFileSelectionModifiers = {},
  ) => {
    const selection = resolveWorkbenchFileSelection(
      orderedPaths,
      selectedPaths,
      selectionAnchorPathRef.current,
      entry.path,
      modifiers,
    )
    selectionAnchorPathRef.current = selection.anchorPath
    onSelectPaths(selection.selectedPaths)
  }

  const focusPath = useCallback((path: string) => {
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current)
    }
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null
      const row = rowRefs.current.get(path)
      const list = listRef.current
      if (!row || !list) {
        return
      }
      row.focus({ preventScroll: true })
      const rowRect = row.getBoundingClientRect()
      const listRect = list.getBoundingClientRect()
      const transferRect = list
        .closest('[data-workbench-files-panel]')
        ?.querySelector('[data-workbench-file-transfer]')
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
  }, [listRef])

  const focusEntry = (index: number) => {
    const entry = entries[index]
    if (!entry) {
      return
    }
    setFocusedPath(entry.path)
    selectEntry(entry)
    focusPath(entry.path)
  }

  useLayoutEffect(() => {
    if (!revealPath) {
      completedRevealPathRef.current = null
      return
    }
    if (
      completedRevealPathRef.current === revealPath
      || !entryPathSet.has(revealPath)
    ) {
      return
    }
    completedRevealPathRef.current = revealPath
    selectionAnchorPathRef.current = revealPath
    setFocusedPath(revealPath)
    onSelectPaths([revealPath])
    focusPath(revealPath)
    onRevealSettled?.(revealPath)
  }, [entryPathSet, focusPath, onRevealSettled, onSelectPaths, revealPath])

  const activateEntry = (entry: RemoteFileEntry) => {
    if (entry.kind === 'directory') {
      pendingDirectoryFocusPathRef.current = entry.path
    }
    void onOpen(entry).then((opened) => {
      if (!opened && pendingDirectoryFocusPathRef.current === entry.path) {
        pendingDirectoryFocusPathRef.current = null
      }
    }).catch(() => {
      if (pendingDirectoryFocusPathRef.current === entry.path) {
        pendingDirectoryFocusPathRef.current = null
      }
    })
  }

  useEffect(() => {
    const handleViewportResize = () => {
      if (tooltipTimerRef.current !== null) {
        window.clearTimeout(tooltipTimerRef.current)
        tooltipTimerRef.current = null
      }
      setNameTooltip(null)
    }
    window.addEventListener('resize', handleViewportResize)
    return () => {
      window.removeEventListener('resize', handleViewportResize)
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current)
      }
      if (tooltipTimerRef.current !== null) {
        window.clearTimeout(tooltipTimerRef.current)
      }
    }
  }, [])

  const hideNameTooltip = () => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    setNameTooltip(null)
  }

  const shortcutStateRef = useRef({
    interactionLocked,
    entries,
    focusedPath,
    selectedPathSet,
    activateEntry,
    hideNameTooltip,
  })
  shortcutStateRef.current = {
    interactionLocked,
    entries,
    focusedPath,
    selectedPathSet,
    activateEntry,
    hideNameTooltip,
  }

  useEffect(() => {
    const disposeContext = shortcutRuntime.pushContext({
      id: shortcutContextId,
      layer: 'focus',
      priority: 10,
      scopes: ['files.list'],
      isActive: () => {
        const list = listRef.current
        const activeElement = document.activeElement
        return Boolean(
          !shortcutStateRef.current.interactionLocked
          && list
          && activeElement
          && list.contains(activeElement),
        )
      },
    })
    const disposeHandler = shortcutRuntime.registerHandler(
      shortcutContextId,
      'files.open_focused',
      () => {
        const current = shortcutStateRef.current
        if (current.interactionLocked) return 'fallthrough'
        const entry = current.entries.find((candidate) => candidate.path === current.focusedPath)
          ?? current.entries.find((candidate) => current.selectedPathSet.has(candidate.path))
          ?? current.entries[0]
          ?? null
        if (!entry) return 'fallthrough'
        current.hideNameTooltip()
        current.activateEntry(entry)
        return 'handled'
      },
    )
    return () => {
      disposeHandler()
      disposeContext()
    }
  }, [listRef, shortcutContextId, shortcutRuntime])

  const revealNameTooltip = (entry: RemoteFileEntry) => {
    hideNameTooltip()
    const node = nameRefs.current.get(entry.path)
    if (!node || node.scrollWidth <= node.clientWidth) {
      return
    }
    tooltipTimerRef.current = window.setTimeout(() => {
      tooltipTimerRef.current = null
      const currentNode = nameRefs.current.get(entry.path)
      const list = listRef.current
      if (!currentNode || !list || currentNode.scrollWidth <= currentNode.clientWidth) {
        return
      }
      const nameRect = currentNode.getBoundingClientRect()
      const listRect = list.getBoundingClientRect()
      const left = Math.max(listRect.left + 8, nameRect.left)
      const maxWidth = Math.max(80, listRect.right - left - 8)
      const estimatedLines = Math.max(1, Math.ceil(currentNode.scrollWidth / maxWidth))
      const estimatedHeight = estimatedLines * 18 + 18
      const placement = nameRect.top - estimatedHeight - 8 >= 8 ? 'above' : 'below'
      setNameTooltip({
        path: entry.path,
        name: entry.name,
        left,
        top: placement === 'above' ? nameRect.top - 8 : nameRect.bottom + 8,
        maxWidth,
        placement,
      })
    }, 350)
  }

  const clearUploadTargetWhenLeaving = (event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setUploadTargetPath(null)
    }
  }

  useLayoutEffect(() => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    setNameTooltip(null)
  }, [tooltipListingRevision])

  useLayoutEffect(() => {
    const pendingPath = pendingDirectoryFocusPathRef.current
    if (!pendingPath || pendingPath !== listingPath) {
      return
    }
    pendingDirectoryFocusPathRef.current = null
    const firstEntry = entries[0]
    if (firstEntry) {
      rowRefs.current.get(firstEntry.path)?.focus({ preventScroll: true })
      setFocusedPath(firstEntry.path)
    } else {
      listRef.current?.focus({ preventScroll: true })
      setFocusedPath(null)
    }
  }, [entries, listRef, listingPath])

  return (
    <div className={`${scopedClassName('workbench-file-list-shell')} ${styles.root}`}>
      <div
        ref={listRef}
        className={[
          scopedClassName('workbench-file-list'),
          loading || initialPending ? scopedClassName('is-loading') : '',
          navigationPending ? scopedClassName('is-navigating') : '',
          entries.length === 0 ? scopedClassName('is-empty') : '',
          uploadTargetPath !== null ? scopedClassName('is-upload-active') : '',
        ].filter(Boolean).join(' ')}
        data-shortcut-adapter="workbench-files"
        role="listbox"
        aria-multiselectable="true"
        tabIndex={interactionLocked || entries.length === 0 ? 0 : -1}
        aria-label={t('workbench.files.remoteFiles')}
        aria-busy={loading || initialPending || navigationPending}
        onScroll={() => {
          hideNameTooltip()
          onScroll()
        }}
        onDragEnter={(event) => {
          if (interactionLocked || !acceptsLocalFiles(event)) {
            return
          }
          event.preventDefault()
          setUploadTargetPath('')
        }}
        onDragOver={(event) => {
          if (interactionLocked || !acceptsLocalFiles(event)) {
            return
          }
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setUploadTargetPath('')
        }}
        onDragLeave={clearUploadTargetWhenLeaving}
        onDrop={(event) => {
          setUploadTargetPath(null)
          if (interactionLocked || !acceptsLocalFiles(event)) {
            return
          }
          onUploadDrop('', event)
        }}
      >
      <div key={listingPath} className={scopedClassName('workbench-file-list-content')} role="presentation">
      {initialPlaceholder ? (
        <div
          className={[
            scopedClassName('workbench-file-skeleton'),
            initialPending ? scopedClassName('is-active') : '',
          ].filter(Boolean).join(' ')}
          aria-hidden="true"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={scopedClassName('workbench-file-skeleton-row')}>
              <span />
              <span />
              <span />
            </span>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className={scopedClassName('workbench-file-empty')}>
          <span className={scopedClassName('workbench-file-empty-icon')} aria-hidden="true">
            <Folder size={22} />
          </span>
          <strong>{t('workbench.files.emptyDirectory')}</strong>
          <span>{t('workbench.files.emptyDirectoryHint')}</span>
          <Button
            type="primary"
            size="small"
            icon={<UploadCloud size={14} />}
            loading={uploading}
            disabled={interactionLocked}
            onClick={onUploadFiles}
          >
            {t('files.uploadFiles')}
          </Button>
        </div>
      ) : (
        entries.map((entry, index) => {
          const selected = selectedPathSet.has(entry.path)
          const menu = menuFor(entry)
          const directory = entry.kind === 'directory'
          const opening = navigationPending && directory && entry.path === pendingPath
          return (
            <Dropdown
              key={entry.path}
              menu={menu}
              trigger={['contextMenu']}
              disabled={interactionLocked}
              classNames={{ root: scopedClassName('files-row-menu') }}
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
                  scopedClassName('workbench-file-row'),
                  selected ? scopedClassName('is-selected') : '',
                  directory ? scopedClassName('is-directory') : '',
                  opening ? scopedClassName('is-opening') : '',
                  uploadTargetPath === entry.path ? scopedClassName('is-upload-target') : '',
                ].filter(Boolean).join(' ')}
                data-workbench-file-path={entry.path}
                data-workbench-file-kind={entry.kind}
                role="option"
                tabIndex={!interactionLocked && entry.path === tabbablePath ? 0 : -1}
                aria-selected={selected}
                aria-disabled={interactionLocked || undefined}
                aria-label={entry.name}
                aria-describedby={nameTooltip?.path === entry.path ? 'workbench-file-name-tooltip' : undefined}
                onMouseEnter={() => revealNameTooltip(entry)}
                onMouseLeave={hideNameTooltip}
                onClick={(event) => {
                  if (interactionLocked) {
                    return
                  }
                  if (directory) {
                    if (event.detail > 1) {
                      return
                    }
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                      setFocusedPath(entry.path)
                      selectEntry(entry, event)
                      return
                    }
                    hideNameTooltip()
                    activateEntry(entry)
                    return
                  }
                  setFocusedPath(entry.path)
                  selectEntry(entry, event)
                }}
                onDoubleClick={() => {
                  if (interactionLocked || directory) {
                    return
                  }
                  hideNameTooltip()
                  activateEntry(entry)
                }}
                onContextMenu={() => {
                  if (interactionLocked) {
                    return
                  }
                  hideNameTooltip()
                  setFocusedPath(entry.path)
                  if (!selected) {
                    selectEntry(entry, { contextMenu: true })
                  }
                }}
                onFocus={() => setFocusedPath(entry.path)}
                onKeyDown={(event) => {
                  if (interactionLocked || event.target !== event.currentTarget) {
                    return
                  }
                  const shortcutFirst = (
                    ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                    && (event.ctrlKey || event.metaKey || event.altKey)
                  ) || (
                    event.key === ' '
                    && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
                  )
                  if (shortcutFirst) {
                    const result = shortcutRuntime.dispatch(event.nativeEvent, {
                      adapterId: `workbench-files:${shortcutInstanceId}`,
                      contextIds: [shortcutContextId],
                      editable: false,
                    })
                    if (result.result === 'handled' || result.result === 'blocked') {
                      event.preventDefault()
                      event.stopPropagation()
                      return
                    }
                    if (event.key !== ' ') {
                      return
                    }
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
                    case ' ':
                      event.preventDefault()
                      selectEntry(entry, event)
                      break
                    default: {
                      const result = shortcutRuntime.dispatch(event.nativeEvent, {
                        adapterId: `workbench-files:${shortcutInstanceId}`,
                        contextIds: [shortcutContextId],
                        editable: false,
                      })
                      if (result.result === 'handled' || result.result === 'blocked') {
                        event.preventDefault()
                        event.stopPropagation()
                      }
                    }
                  }
                }}
                onDragEnter={(event) => {
                  if (interactionLocked || !directory || !acceptsLocalFiles(event)) {
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  setUploadTargetPath(entry.path)
                }}
                onDragOver={(event) => {
                  if (interactionLocked || !directory || !acceptsLocalFiles(event)) {
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
                  if (interactionLocked || !directory || !acceptsLocalFiles(event)) {
                    return
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  setUploadTargetPath(null)
                  onUploadDrop(entry.path, event)
                }}
              >
                <span className={scopedClassName('workbench-file-row-icon')}>{fileIcon(entry)}</span>
                <span className={scopedClassName('workbench-file-row-copy')}>
                  <strong
                    ref={(node) => {
                      if (node) {
                        nameRefs.current.set(entry.path, node)
                      } else {
                        nameRefs.current.delete(entry.path)
                      }
                    }}
                  >
                    {entry.name}
                  </strong>
                  <small>{formatDate(entry.modified_at)}</small>
                </span>
                <span className={scopedClassName('workbench-file-row-meta')}>
                  {directory ? null : formatBytes(entry.size)}
                </span>
                <span className={scopedClassName('workbench-file-row-disclosure')} aria-hidden="true">
                  {opening
                    ? <LoaderCircle className={`${uiStyles['is-spinning']} is-spinning`} size={13} />
                    : directory ? <ChevronRight size={14} /> : null}
                </span>
              </div>
            </Dropdown>
          )
        })
      )}
      </div>
      </div>
      {uploadTargetPath !== null ? (
        <div className={scopedClassName('workbench-file-upload-overlay')} aria-hidden="true">
          <span><UploadCloud size={19} /></span>
          <strong>
            {uploadTarget
              ? t('files.dropUploadToDirectory', { name: uploadTarget.name })
              : t('files.dropUpload')}
          </strong>
          <small>{t('workbench.files.releaseToUpload')}</small>
        </div>
      ) : null}
      {nameTooltip ? createPortal(
        <div
          id="workbench-file-name-tooltip"
          className={scopedClassName('workbench-file-name-tooltip')}
          data-placement={nameTooltip.placement}
          role="tooltip"
          style={{
            left: nameTooltip.left,
            top: nameTooltip.top,
            maxWidth: nameTooltip.maxWidth,
          }}
        >
          {nameTooltip.name}
        </div>,
        document.body,
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
