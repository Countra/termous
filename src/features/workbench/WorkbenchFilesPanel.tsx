import {
  App as AntdApp,
  Breadcrumb,
  Button,
  Dropdown,
  Input,
  Progress,
  Switch,
  Tooltip,
  type InputRef,
  type MenuProps,
} from 'antd'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clipboard,
  ExternalLink,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderRoot,
  LoaderCircle,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { useTransferRuntime } from '../../app/useTransferRuntime'
import { buildRemoteFileActionMenu } from '../../components/files/RemoteFileActionMenu'
import {
  runRemoteFileAction,
  type RemoteFileActionHandlers,
} from '../../components/files/remoteFileActions'
import { RemotePermissionModal } from '../../components/files/RemotePermissionModal'
import type {
  AppData,
  LocalGrantSource,
  RemoteFileEntry,
  Session,
  ThemeMode,
} from '../../types/domain'
import { joinPath, normalizeRemotePath, parentPath } from '../files/fileUtils'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'
import { WorkbenchFileList } from './WorkbenchFileList'
import { WorkbenchTransferBar } from './WorkbenchTransferBar'
import { getSessionFilesNavigationState } from './sessionFilesState'
import { useWorkbenchSessionFiles } from './useWorkbenchSessionFiles'
import { isLocalFileDrag } from './workbenchFileDrag'
import './workbench-files-panel.css'
import './workbench-file-controls.css'

const RemoteTextEditorModal = lazy(() => import('../files/RemoteTextEditorModal').then((module) => ({ default: module.RemoteTextEditorModal })))
const RemoteImageViewerModal = lazy(() => import('../files/RemoteImageViewerModal').then((module) => ({ default: module.RemoteImageViewerModal })))
const imagePattern = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i

interface WorkbenchFilesPanelProps {
  api: TermousApi
  data: AppData
  session: Session | null
  enabled: boolean
  theme: ThemeMode
  onOpenFull: (session: Session) => Promise<void>
}

interface RemoteClipboard {
  mode: 'copy' | 'cut'
  hostId: string
  paths: string[]
}

interface TrackedUploadRefresh {
  fileSessionId: string
  targetPath: string
}

export function WorkbenchFilesPanel(props: WorkbenchFilesPanelProps) {
  return <WorkbenchFilesPanelContent {...props} />
}

function WorkbenchFilesPanelContent({
  api,
  data,
  session,
  enabled,
  theme,
  onOpenFull,
}: WorkbenchFilesPanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const runtime = useTransferRuntime()
  const files = useWorkbenchSessionFiles({ api, data, activeSession: session, enabled })
  const [pathInput, setPathInput] = useState('/')
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [permissionEntry, setPermissionEntry] = useState<RemoteFileEntry | null>(null)
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [textEditorPath, setTextEditorPath] = useState<string | null>(null)
  const [imageViewerPath, setImageViewerPath] = useState<string | null>(null)
  const [editingPath, setEditingPath] = useState(false)
  const [uploadPicking, setUploadPicking] = useState(false)
  const [breadcrumbScrollState, setBreadcrumbScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  })
  const pathInputRef = useRef<InputRef>(null)
  const breadcrumbViewportRef = useRef<HTMLDivElement>(null)
  const breadcrumbPinnedToEndRef = useRef(true)
  const uploadRefreshTasksRef = useRef(new Map<string, TrackedUploadRefresh>())
  const completedUploadPathsRef = useRef(new Map<string, Set<string>>())
  const followTerminal = Boolean(files.viewState?.followTerminal)
  const cwdPendingPath = files.viewState?.pendingTerminalPath || (
    files.cwdState?.pending_operation?.status === 'failed'
      ? ''
      : files.cwdState?.pending_operation?.path ?? ''
  )
  const confirmedCwdPath = (
    files.cwdState?.observation_status === undefined
    || files.cwdState.observation_status === 'ready'
  )
    ? files.cwdState?.confirmed_path
    : undefined
  const navigationState = files.viewState
    ? getSessionFilesNavigationState(
        files.viewState,
        confirmedCwdPath,
        cwdPendingPath,
      )
    : null
  const currentPath = navigationState?.committedPath ?? '/'
  const pendingDirectoryPath = navigationState?.pendingPath ?? ''
  const directoryChanging = Boolean(pendingDirectoryPath)
  const directoryReadFailed = Boolean(
    files.viewState?.error && files.viewState.failedRequestPath,
  )
  const syncStatus = files.viewState?.syncStatus ?? ''
  const followDirectoryBlocked = syncStatus === 'failed'
    || syncStatus === 'unsupported'
    || syncStatus === 'reconnect-required'
    || syncStatus === 'invalid_path'
  const initialDirectoryPlaceholder = !files.viewState?.listing
  const initialDirectoryPending = initialDirectoryPlaceholder
    && !files.viewState?.error
    && (!followTerminal || !followDirectoryBlocked)
  const directoryRefreshing = Boolean(
    navigationState?.refreshing && files.viewState?.listing,
  )
  const directoryLoading = initialDirectoryPending || directoryChanging || directoryRefreshing
  const directoryNavigationLocked = initialDirectoryPlaceholder || directoryChanging
  const followingTerminalDirectory = followTerminal
    && Boolean(files.cwdState?.confirmed_path)
    && normalizeRemotePath(files.cwdState?.confirmed_path || '/') === pendingDirectoryPath
  const fileSessionId = files.fileSession?.id
  const pathInputId = `workbench-remote-path-${files.sourceSessionId || 'inactive'}`
  const pathErrorId = `${pathInputId}-error`
  const loadDirectory = files.loadDirectory
  const syncMessage = syncStatusMessage(syncStatus, t)
  const syncNoticeTone = syncStatus === 'failed' || syncStatus === 'invalid_path'
    ? 'error'
    : syncStatus === 'unsupported'
      ? 'unsupported'
      : syncStatus === 'reconnect-required'
        ? 'reconnect-required'
      : ''
  const followDirectoryLoading = followTerminal && Boolean(files.viewState?.loading)
  const followVisualState = !followTerminal
    ? 'off'
    : syncStatus === 'failed' || syncStatus === 'invalid_path'
      ? 'failed'
      : syncStatus === 'unsupported'
        ? 'unsupported'
        : syncStatus === 'reconnect-required'
          ? 'reconnect-required'
        : syncStatus === 'preparing' || syncStatus === 'not_ready'
          ? 'preparing'
          : syncStatus === 'locating'
            ? 'locating'
            : syncStatus === 'waiting-idle'
              ? 'waiting'
              : syncStatus === 'queued' || syncStatus === 'publishing' || syncStatus === 'applying' || followDirectoryLoading
                ? 'syncing'
                : 'active'
  const followHasDetail = followVisualState !== 'off' && followVisualState !== 'active'
  const followDetailMessage = syncMessage || (followDirectoryLoading
    ? t('workbench.files.syncing')
    : '')
  const followTooltip = followHasDetail && followDetailMessage
    ? followDetailMessage
    : t(followTerminal ? 'workbench.files.followEnabled' : 'workbench.files.followDisabled')
  const followProgressVisible = followVisualState === 'preparing'
    || followVisualState === 'locating'
    || followVisualState === 'waiting'
    || followVisualState === 'syncing'

  useEffect(() => {
    setPathInput(files.viewState?.path || '/')
    setEditingPath(false)
  }, [files.sourceSessionId, files.viewState?.path])

  useEffect(() => {
    setPermissionEntry(null)
    setTextEditorPath(null)
    setImageViewerPath(null)
  }, [fileSessionId, files.sourceSessionId])

  useEffect(() => {
    if (!editingPath) {
      return
    }
    const frame = window.requestAnimationFrame(() => {
      pathInputRef.current?.focus()
      pathInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editingPath])

  useEffect(() => {
    if (uploadRefreshTasksRef.current.size === 0 && completedUploadPathsRef.current.size === 0) {
      return
    }
    const byId = new Map(runtime.transfers.map((task) => [task.id, task]))
    for (const [taskId, tracked] of uploadRefreshTasksRef.current) {
      const task = byId.get(taskId)
      if (!task) {
        uploadRefreshTasksRef.current.delete(taskId)
        continue
      }
      if (task.status === 'queued' || task.status === 'running') {
        continue
      }
      uploadRefreshTasksRef.current.delete(taskId)
      if (task.status === 'completed') {
        const paths = completedUploadPathsRef.current.get(tracked.fileSessionId) ?? new Set<string>()
        paths.add(tracked.targetPath)
        completedUploadPathsRef.current.set(tracked.fileSessionId, paths)
      }
    }
    if (!fileSessionId) {
      return
    }
    const hasPendingCurrentSession = [...uploadRefreshTasksRef.current.values()]
      .some((tracked) => tracked.fileSessionId === fileSessionId)
    if (hasPendingCurrentSession) {
      return
    }
    const completedPaths = completedUploadPathsRef.current.get(fileSessionId)
    completedUploadPathsRef.current.delete(fileSessionId)
    if (completedPaths?.has(currentPath)) {
      void loadDirectory(currentPath)
    }
  }, [currentPath, fileSessionId, loadDirectory, runtime.transfers])

  const notifyFailure = () => notification.error({
    title: t('files.operationFailed'),
    duration: 4,
    role: 'alert',
    className: 'termous-notification',
  })

  const runAction = async (action: () => Promise<void>, success?: string) => {
    try {
      await action()
      if (success) {
        notification.success({ title: success, duration: 2, className: 'termous-notification' })
      }
    } catch {
      notifyFailure()
    }
  }

  const uploadPaths = async (source: LocalGrantSource, paths: string[], targetPath?: string) => {
    if (!files.fileSession?.id || paths.length === 0) {
      return
    }
    const remoteDir = normalizeRemotePath(targetPath || currentPath)
    await runAction(async () => {
      const grant = await api.createLocalFileGrant(source, paths)
      const task = await api.createFileSessionUploadTransfer(files.fileSession!.id, grant.id, remoteDir, 'rename')
      uploadRefreshTasksRef.current.set(task.id, {
        fileSessionId: files.fileSession!.id,
        targetPath: remoteDir,
      })
      runtime.upsertTransfer(task)
    }, t('files.transferCreated'))
  }

  const downloadPaths = async (paths: string[]) => {
    if (!files.fileSession?.id || paths.length === 0) {
      return
    }
    const directories = await window.termous?.files?.pickDirectory()
    if (!directories?.[0]) {
      return
    }
    await runAction(async () => {
      const task = await api.createFileSessionDownloadTransfer(files.fileSession!.id, paths, directories[0], 'rename')
      runtime.upsertTransfer(task)
    }, t('files.transferCreated'))
  }

  const uploadDrop = async (targetPath: string, event: DragEvent<HTMLDivElement>) => {
    if (!isLocalFileDrag(Array.from(event.dataTransfer.types))) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const cached = await window.termous?.files?.consumeDroppedFilePaths?.(event.dataTransfer.files.length)
    const paths = cached?.length
      ? cached
      : await window.termous?.files?.pathsFromFileList(event.dataTransfer.files)
    if (!paths?.length) {
      notification.warning({ title: t('files.dropPathUnavailable'), duration: 3 })
      return
    }
    await uploadPaths('drop', paths, targetPath || currentPath)
  }

  const openEntry = async (entry: RemoteFileEntry) => {
    files.setSelectedPaths([entry.path])
    if (entry.kind === 'directory') {
      return files.navigateDirectory(entry.path)
    }
    if (entry.kind !== 'file') {
      return false
    }
    if (imagePattern.test(entry.name)) {
      setImageViewerPath(entry.path)
      setTextEditorPath(null)
    } else {
      setTextEditorPath(entry.path)
      setImageViewerPath(null)
    }
    return true
  }

  const createDirectory = () => {
    let name = ''
    modal.confirm({
      title: t('files.newFolder'),
      icon: null,
      content: <Input autoFocus placeholder={t('files.folderName')} onChange={(event) => { name = event.target.value }} />,
      okText: t('app.create'),
      cancelText: t('app.cancel'),
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        if (!name.trim() || !files.fileSession?.id) {
          throw new Error(t('files.nameRequired'))
        }
        await api.mkdirFileSessionFile(files.fileSession.id, joinPath(currentPath, name.trim()))
        await files.loadDirectory(currentPath)
      },
    })
  }

  const renameEntry = (entry: RemoteFileEntry) => {
    let name = entry.name
    modal.confirm({
      title: t('files.rename'),
      icon: null,
      content: <Input autoFocus defaultValue={entry.name} onChange={(event) => { name = event.target.value }} />,
      okText: t('app.save'),
      cancelText: t('app.cancel'),
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        if (!files.fileSession?.id || !name.trim()) {
          throw new Error(t('files.nameRequired'))
        }
        await api.renameFileSessionFile(files.fileSession.id, entry.path, joinPath(parentPath(entry.path), name.trim()))
        await files.loadDirectory(currentPath)
      },
    })
  }

  const deleteEntry = (entry: RemoteFileEntry) => modal.confirm({
    title: t('files.deleteTitle'),
    content: t('files.deleteDescription', { count: 1 }),
    okText: t('app.delete'),
    cancelText: t('app.cancel'),
    okButtonProps: { danger: true },
    className: 'confirm-modal',
    rootClassName: 'termous-modal-root',
    onOk: async () => {
      if (files.fileSession?.id) {
        await api.deleteFileSessionFiles(files.fileSession.id, [entry.path], true)
        await files.loadDirectory(currentPath)
      }
    },
  })

  const menuFor = (entry: RemoteFileEntry): MenuProps => ({
    items: buildRemoteFileActionMenu(entry, t),
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      files.setSelectedPaths([entry.path])
      const handlers: RemoteFileActionHandlers = {
        openFile: (target) => void openEntry(target),
        download: (target) => void downloadPaths([target.path]),
        copy: (target) => {
          if (files.fileSession) {
            setRemoteClipboard({ mode: 'copy', hostId: files.fileSession.host_id, paths: [target.path] })
          }
        },
        cut: (target) => {
          if (files.fileSession) {
            setRemoteClipboard({ mode: 'cut', hostId: files.fileSession.host_id, paths: [target.path] })
          }
        },
        permissions: setPermissionEntry,
        rename: renameEntry,
        delete: deleteEntry,
      }
      runRemoteFileAction(entry, String(key), handlers)
    },
  })

  const paste = async () => {
    if (!files.fileSession?.id) {
      return
    }
    const targetPath = currentPath
    if (remoteClipboard?.hostId === files.fileSession.host_id) {
      await runAction(async () => {
        if (remoteClipboard.mode === 'cut') {
          await api.moveFileSessionFiles(files.fileSession!.id, remoteClipboard.paths, targetPath, 'rename')
          setRemoteClipboard(null)
        } else {
          await api.copyFileSessionFiles(files.fileSession!.id, remoteClipboard.paths, targetPath, 'rename')
        }
        await files.loadDirectory(targetPath)
      }, t('files.operationDone'))
      return
    }
    const localPaths = await window.termous?.files?.readClipboardFilePaths()
    await uploadPaths('clipboard', localPaths ?? [])
  }

  const uploadPickedFiles = async () => {
    if (uploadPicking) {
      return
    }
    setUploadPicking(true)
    try {
      await uploadPaths('picker', await window.termous?.files?.pickFiles() ?? [])
    } finally {
      setUploadPicking(false)
    }
  }

  const clearInvalidPath = () => {
    if (files.viewState?.syncStatus === 'invalid_path') {
      files.updateView({ syncStatus: '', syncError: '' })
    }
  }

  const submitPath = async () => {
    clearInvalidPath()
    if (await files.navigateDirectory(pathInput)) {
      setEditingPath(false)
    }
  }

  const cancelPathEditing = () => {
    clearInvalidPath()
    setPathInput(currentPath)
    setEditingPath(false)
  }

  const updateBreadcrumbScrollState = useCallback((preserveEnd = false) => {
    const viewport = breadcrumbViewportRef.current
    if (!viewport) {
      setBreadcrumbScrollState((current) => (
        current.canScrollLeft || current.canScrollRight
          ? { canScrollLeft: false, canScrollRight: false }
          : current
      ))
      return
    }
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (preserveEnd && breadcrumbPinnedToEndRef.current) {
      viewport.scrollLeft = maxScrollLeft
    }
    const next = {
      canScrollLeft: viewport.scrollLeft > 1,
      canScrollRight: viewport.scrollLeft < maxScrollLeft - 1,
    }
    breadcrumbPinnedToEndRef.current = !next.canScrollRight
    setBreadcrumbScrollState((current) => (
      current.canScrollLeft === next.canScrollLeft && current.canScrollRight === next.canScrollRight
        ? current
        : next
    ))
  }, [])

  const scrollBreadcrumb = useCallback((direction: 'left' | 'right') => {
    const viewport = breadcrumbViewportRef.current
    if (!viewport) {
      return
    }
    const distance = Math.max(96, viewport.clientWidth * 0.68)
    viewport.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [])

  const handleBreadcrumbWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const viewport = breadcrumbViewportRef.current
    if (!viewport) {
      return
    }
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth
    if (maxScrollLeft <= 1) {
      return
    }
    const wheelDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (wheelDelta === 0) {
      return
    }
    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, viewport.scrollLeft + wheelDelta))
    if (Math.abs(nextScrollLeft - viewport.scrollLeft) < 1) {
      return
    }
    event.preventDefault()
    viewport.scrollLeft = nextScrollLeft
    updateBreadcrumbScrollState()
  }, [updateBreadcrumbScrollState])

  useEffect(() => {
    if (editingPath) {
      return
    }
    const viewport = breadcrumbViewportRef.current
    if (!viewport) {
      return
    }
    breadcrumbPinnedToEndRef.current = true
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = viewport.scrollWidth
      updateBreadcrumbScrollState()
    })
    const observer = new ResizeObserver(() => updateBreadcrumbScrollState(true))
    observer.observe(viewport)
    const breadcrumbList = viewport.querySelector<HTMLElement>('.ant-breadcrumb-ol')
    if (breadcrumbList) {
      observer.observe(breadcrumbList)
    }
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [currentPath, editingPath, updateBreadcrumbScrollState])

  const selectedCount = files.viewState?.selectedPaths.length ?? 0
  const itemCountLabel = selectedCount > 0
    ? t('workbench.files.selectedCount', { count: selectedCount })
    : t('workbench.files.itemCount', { count: files.entries.length })

  if (!session || session.kind !== 'ssh') {
    return <WorkbenchEmptyState icon={<FolderOpen size={20} />} title={t('workbench.files.emptyTitle')} description={t('workbench.files.emptyHint')} />
  }

  if (session.status !== 'connected') {
    return <WorkbenchEmptyState icon={<FolderOpen size={20} />} title={t('workbench.files.disconnectedTitle')} description={t('workbench.files.disconnectedHint')} />
  }

  if (!files.fileSession || files.fileSession.status !== 'connected') {
    const progress = Math.max(4, Math.min(100, files.fileSession?.progress ?? 4))
    return (
      <div className="workbench-file-connect">
        <FolderOpen size={21} />
        <strong>{files.viewState?.error ? t('workbench.files.connectFailed') : t('workbench.files.connecting')}</strong>
        <span>{files.fileSession?.status_message || t('workbench.files.preparing')}</span>
        <Progress percent={progress} showInfo={false} size="small" />
        {files.viewState?.error || files.fileSession?.status === 'failed' || files.fileSession?.status === 'disconnected' ? (
          <Button icon={<RefreshCw size={14} />} onClick={() => void runAction(files.reconnect)}>{t('app.retry')}</Button>
        ) : null}
      </div>
    )
  }

  return (
    <section
      className={[
        'workbench-files-panel',
        directoryChanging ? 'is-changing-directory' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="workbench-files-toolbar">
        <header className="workbench-files-summary">
          <div className="workbench-files-summary-copy">
            <span className="workbench-files-summary-icon" aria-hidden="true">
              <FolderOpen size={16} />
            </span>
            <span className="workbench-files-summary-text">
              <strong>{t('workbench.files.remoteFiles')}</strong>
              <small>
                <span className="workbench-files-ready-dot" aria-hidden="true" />
                {t('workbench.files.sftpReady')}
              </small>
            </span>
          </div>
          <div className="workbench-files-summary-actions">
            <Tooltip title={t('app.reload')}>
              <Button
                type="text"
                className="workbench-files-icon-button"
                aria-label={t('app.reload')}
                icon={<RefreshCw className={directoryRefreshing ? 'is-spinning' : ''} size={14} />}
                disabled={directoryLoading}
                onClick={() => void files.loadDirectory(currentPath)}
              />
            </Tooltip>
            <Tooltip title={t('workbench.manageFiles')}>
              <Button
                type="text"
                className="workbench-files-icon-button"
                aria-label={t('workbench.manageFiles')}
                icon={<ExternalLink size={14} />}
                onClick={() => void runAction(() => onOpenFull(session))}
              />
            </Tooltip>
          </div>
        </header>
        <div className="workbench-files-location">
          <Tooltip title={t('files.parent')}>
            <Button
              type="text"
              className="workbench-files-back"
              aria-label={t('files.parent')}
              icon={<ChevronLeft size={16} />}
              disabled={currentPath === '/' || directoryNavigationLocked}
              onClick={() => void files.navigateDirectory(parentPath(currentPath))}
            />
          </Tooltip>
          <div
            className={[
              'workbench-files-address',
              editingPath ? 'is-editing' : '',
              directoryLoading ? 'is-loading' : '',
              directoryChanging ? 'is-navigating' : '',
              syncStatus === 'invalid_path' ? 'is-invalid' : '',
            ].filter(Boolean).join(' ')}
            aria-busy={directoryLoading}
          >
            {editingPath ? (
              <>
                <Input
                  ref={pathInputRef}
                  id={pathInputId}
                  name="workbench-remote-path"
                  value={pathInput}
                  className="workbench-files-path-input"
                  status={syncStatus === 'invalid_path' ? 'error' : undefined}
                  disabled={directoryChanging}
                  aria-label={t('workbench.files.pathInput')}
                  aria-invalid={syncStatus === 'invalid_path'}
                  aria-describedby={syncStatus === 'invalid_path' ? pathErrorId : undefined}
                  onChange={(event) => {
                    clearInvalidPath()
                    setPathInput(event.target.value)
                  }}
                  onPressEnter={() => void submitPath()}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      cancelPathEditing()
                    }
                  }}
                />
                <Button
                  type="text"
                  className="workbench-files-address-action"
                  aria-label={t('files.go')}
                  icon={<Check size={14} />}
                  disabled={directoryChanging}
                  onClick={() => void submitPath()}
                />
                <Button
                  type="text"
                  className="workbench-files-address-action"
                  aria-label={t('workbench.files.cancelPathEdit')}
                  icon={<X size={14} />}
                  onClick={cancelPathEditing}
                />
              </>
            ) : (
              <>
                <div
                  className={[
                    'workbench-files-breadcrumb-shell',
                    breadcrumbScrollState.canScrollLeft ? 'has-left-overflow' : '',
                    breadcrumbScrollState.canScrollRight ? 'has-right-overflow' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div
                    ref={breadcrumbViewportRef}
                    className="workbench-files-breadcrumb-viewport"
                    onScroll={() => updateBreadcrumbScrollState()}
                    onWheel={handleBreadcrumbWheel}
                  >
                    <Breadcrumb
                      className="workbench-files-breadcrumb"
                      separator={<ChevronRight size={11} strokeWidth={1.8} aria-hidden="true" />}
                      items={buildBreadcrumbItems(
                        currentPath,
                        files.navigateDirectory,
                        t('workbench.files.rootDirectory'),
                        directoryNavigationLocked,
                      )}
                    />
                  </div>
                  <Tooltip title={t('workbench.files.scrollPathLeft')}>
                    <Button
                      type="text"
                      className="workbench-files-breadcrumb-scroll is-left"
                      aria-label={t('workbench.files.scrollPathLeft')}
                      disabled={!breadcrumbScrollState.canScrollLeft}
                      icon={<ChevronLeft size={13} />}
                      onClick={() => scrollBreadcrumb('left')}
                    />
                  </Tooltip>
                  <Tooltip title={t('workbench.files.scrollPathRight')}>
                    <Button
                      type="text"
                      className="workbench-files-breadcrumb-scroll is-right"
                      aria-label={t('workbench.files.scrollPathRight')}
                      disabled={!breadcrumbScrollState.canScrollRight}
                      icon={<ChevronRight size={13} />}
                      onClick={() => scrollBreadcrumb('right')}
                    />
                  </Tooltip>
                </div>
                <Tooltip title={t('workbench.files.editPath')}>
                  <Button
                    type="text"
                    className="workbench-files-address-action"
                    aria-label={t('workbench.files.editPath')}
                    icon={<PencilLine size={13} />}
                    disabled={directoryNavigationLocked}
                    onClick={() => setEditingPath(true)}
                  />
                </Tooltip>
              </>
            )}
          </div>
        </div>
        <div className="workbench-files-toolbar-row">
          <Tooltip title={t('files.uploadFiles')}>
            <Button
              type="default"
              className="workbench-files-upload-button"
              aria-label={t('files.uploadFiles')}
              icon={<Upload size={15} />}
              loading={uploadPicking}
              disabled={directoryNavigationLocked}
              onClick={() => void uploadPickedFiles()}
            >
              <span className="workbench-files-upload-label">{t('files.uploadFiles')}</span>
            </Button>
          </Tooltip>
          <Tooltip title={t('files.newFolder')}>
            <Button
              type="text"
              className="workbench-files-action-button"
              aria-label={t('files.newFolder')}
              icon={<FolderPlus size={15} />}
              disabled={directoryNavigationLocked}
              onClick={createDirectory}
            />
          </Tooltip>
          <Tooltip title={t('files.paste')}>
            <Button
              type="text"
              className="workbench-files-action-button"
              aria-label={t('files.paste')}
              icon={<Clipboard size={15} />}
              disabled={directoryNavigationLocked}
              onClick={() => void paste()}
            />
          </Tooltip>
          <Tooltip title={followTooltip}>
            <div
              className="workbench-files-follow"
              data-state={followVisualState}
              aria-busy={followProgressVisible}
            >
              <span className="workbench-files-follow-indicator" aria-hidden="true">
                {followProgressVisible ? (
                  <LoaderCircle className="workbench-files-follow-spinner" size={11} />
                ) : (
                  <span className="workbench-files-follow-dot" />
                )}
              </span>
              <span>{t('workbench.files.followLabel')}</span>
              <Switch
                size="small"
                aria-label={t('workbench.files.followTerminal')}
                checked={followTerminal}
                onChange={files.setFollowTerminal}
              />
            </div>
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                { key: 'upload-folder', icon: <FolderInput size={14} />, label: t('files.uploadFolder'), disabled: directoryNavigationLocked },
                { key: 'open-full', icon: <FolderOpen size={14} />, label: t('workbench.manageFiles') },
              ],
              onClick: async ({ key }) => {
                if (key === 'upload-folder') {
                  await uploadPaths('picker', await window.termous?.files?.pickDirectory() ?? [])
                } else {
                  await runAction(() => onOpenFull(session))
                }
              },
            }}
            classNames={{ root: 'files-row-menu' }}
          >
            <Button
              type="text"
              className="workbench-files-action-button"
              aria-label={t('workbench.files.moreActions')}
              icon={<MoreHorizontal size={15} />}
            />
          </Dropdown>
        </div>
      </div>
      <div
        className={[
          'workbench-file-list-caption',
          directoryChanging ? 'is-navigating' : '',
          directoryReadFailed ? 'is-error' : '',
        ].filter(Boolean).join(' ')}
        role={directoryReadFailed ? 'alert' : undefined}
      >
        {directoryReadFailed ? (
          <button
            className="workbench-file-caption-error"
            type="button"
            title={files.viewState?.error || undefined}
            onClick={() => void files.retryDirectory()}
          >
            <CircleAlert size={12} aria-hidden="true" />
            <span title={files.viewState?.failedRequestPath || undefined}>
              {t('workbench.files.openDirectoryFailed', {
                path: files.viewState?.failedRequestPath,
              })}
            </span>
            <strong>{t('workbench.files.retryDirectory')}</strong>
          </button>
        ) : directoryChanging ? (
          <span
            className="workbench-file-navigation-status"
            role="status"
            aria-live="polite"
            aria-label={t('workbench.files.directoryChangeAria', {
              target: pendingDirectoryPath,
              current: currentPath,
            })}
          >
            <FileStatusSpinner />
            <span>
              {t(followingTerminalDirectory
                ? 'workbench.files.followingDirectory'
                : 'workbench.files.openingDirectory')}
            </span>
            <code title={pendingDirectoryPath}>{pendingDirectoryPath}</code>
          </span>
        ) : syncNoticeTone && syncMessage ? (
          <span
            id={syncStatus === 'invalid_path' ? pathErrorId : undefined}
            className={`workbench-file-caption-notice is-${syncNoticeTone}`}
            role={syncNoticeTone === 'error' ? 'alert' : 'status'}
          >
            <CircleAlert size={12} aria-hidden="true" />
            <span>{syncMessage}</span>
          </span>
        ) : followProgressVisible && followDetailMessage ? (
          <span
            className="workbench-file-navigation-status"
            role="status"
            aria-live="polite"
          >
            <FileStatusSpinner />
            <span>{followDetailMessage}</span>
          </span>
        ) : initialDirectoryPending || directoryRefreshing ? (
          <span
            className="workbench-file-navigation-status"
            role="status"
            aria-live="polite"
          >
            <FileStatusSpinner />
            <span>{t('workbench.files.refreshing')}</span>
          </span>
        ) : (
          <span>{itemCountLabel}</span>
        )}
      </div>
      <WorkbenchFileList
        entries={files.entries}
        selectedPaths={files.viewState?.selectedPaths ?? []}
        listingPath={normalizeRemotePath(files.viewState?.listing?.path || currentPath)}
        loading={Boolean(files.viewState?.loading)}
        initialPlaceholder={initialDirectoryPlaceholder}
        initialPending={initialDirectoryPending}
        navigationPending={directoryChanging}
        pendingPath={pendingDirectoryPath}
        listRef={files.listRef}
        menuFor={menuFor}
        onSelect={(entry) => files.setSelectedPaths([entry.path])}
        onOpen={openEntry}
        onScroll={files.recordScroll}
        onUploadDrop={(target, event) => void uploadDrop(target, event)}
        onUploadFiles={() => void uploadPickedFiles()}
        uploading={uploadPicking}
      />
      <div className="workbench-file-transfer-overlay">
        <WorkbenchTransferBar
          api={api}
          fileSessionId={files.fileSession.id}
          onActionError={notifyFailure}
        />
      </div>
      <RemotePermissionModal
        entry={permissionEntry}
        open={Boolean(permissionEntry)}
        saving={permissionSaving}
        onCancel={() => setPermissionEntry(null)}
        onSubmit={async (entry, mode) => {
          setPermissionSaving(true)
          try {
            await runAction(async () => {
              await api.chmodFileSessionFile(files.fileSession!.id, entry.path, mode)
              await files.loadDirectory(currentPath)
              setPermissionEntry(null)
            }, t('files.permissionsUpdated'))
          } finally {
            setPermissionSaving(false)
          }
        }}
      />
      {textEditorPath ? (
        <Suspense fallback={null}>
          <RemoteTextEditorModal
            api={api}
            open
            fileSessionId={files.fileSession.id}
            path={textEditorPath}
            theme={theme}
            terminalSettings={data.settings.terminal}
            onClose={() => setTextEditorPath(null)}
            onSaved={() => void files.loadDirectory(currentPath)}
          />
        </Suspense>
      ) : null}
      {imageViewerPath ? (
        <Suspense fallback={null}>
          <RemoteImageViewerModal
            api={api}
            open
            fileSessionId={files.fileSession.id}
            path={imageViewerPath}
            theme={theme}
            onClose={() => setImageViewerPath(null)}
          />
        </Suspense>
      ) : null}
    </section>
  )
}

function buildBreadcrumbItems(
  path: string,
  navigateDirectory: (targetPath: string) => Promise<boolean>,
  rootLabel: string,
  navigationLocked: boolean,
) {
  const segments = normalizeRemotePath(path).split('/').filter(Boolean)
  const paths = ['/']
  for (let index = 0; index < segments.length; index += 1) {
    paths.push(`/${segments.slice(0, index + 1).join('/')}`)
  }
  return paths.map((targetPath, index) => ({
    key: targetPath,
    title: (
      <button
        type="button"
        className={[
          'workbench-files-crumb',
          index === 0 ? 'is-root' : '',
          index === paths.length - 1 ? 'is-current' : '',
        ].filter(Boolean).join(' ')}
        aria-current={index === paths.length - 1 ? 'page' : undefined}
        aria-label={index === 0 ? rootLabel : undefined}
        title={index === 0 ? rootLabel : segments[index - 1]}
        disabled={navigationLocked || index === paths.length - 1}
        onClick={() => void navigateDirectory(targetPath)}
      >
        {index === 0 ? <FolderRoot size={13} strokeWidth={1.9} aria-hidden="true" /> : segments[index - 1]}
      </button>
    ),
  }))
}

function FileStatusSpinner() {
  return (
    <span className="workbench-file-status-spinner" aria-hidden="true">
      <LoaderCircle size={12} />
    </span>
  )
}

function syncStatusMessage(
  status: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (status) {
    case 'preparing':
      return t('workbench.files.followPreparing')
    case 'locating':
      return t('workbench.files.followLocating')
    case 'queued':
    case 'publishing':
    case 'applying':
      return t('workbench.files.syncing')
    case 'waiting-idle':
      return t('workbench.files.waitingTerminalIdle')
    case 'failed':
      return t('workbench.files.syncFailed')
    case 'unsupported':
      return t('workbench.files.followUnsupported')
    case 'reconnect-required':
      return t('workbench.files.followReconnectRequired')
    case 'not_ready':
      return t('workbench.files.followNotReady')
    case 'invalid_path':
      return t('workbench.files.invalidPath')
    default:
      return ''
  }
}
