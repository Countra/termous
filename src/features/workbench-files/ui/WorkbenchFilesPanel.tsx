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
import { getTermousBridge } from '#shared/bridge'
import type { FileGateway } from '#features/files'
import { useTransferRuntime } from '#features/transfers'
import {
  buildRemoteFileActionMenu,
  loadRemoteImageViewerModal,
  loadRemoteTextEditorModal,
  runRemoteFileAction,
  type RemoteFileActionHandlers,
  RemotePermissionModal,
} from '#features/remote-file'
import type { AppTheme as ThemeMode, Settings } from '#common/contracts'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkInput,
  FileSession,
  LocalGrantSource,
  RemoteFileEntry,
} from '#entities/file'
import { joinPath, normalizeRemotePath, parentPath } from '#shared/path'
import type { FileSessionClosureState } from '#entities/file'
import { confirmDialogStyles, uiStyles, WorkspaceEmptyState as WorkbenchEmptyState } from '#shared/ui'
import { WorkbenchBookmarksPopover } from './WorkbenchBookmarksPopover'
import { WorkbenchFileList } from './WorkbenchFileList'
import { WorkbenchTransferBar } from './WorkbenchTransferBar'
import {
  resolveWorkbenchFilesPathNavigationAction,
  resolveWorkbenchFilesPathNavigationTarget,
  type WorkbenchFilesPathNavigationIntent,
} from '../model/workbenchFilesPathNavigation'
import {
  getSessionFilesNavigationState,
  isSessionFilesCwdRefreshPending,
  shouldShowSessionFilesInitialLoading,
} from '../model/sessionFilesState'
import { useWorkbenchSessionFiles } from '../model/useWorkbenchSessionFiles'
import {
  fileSessionRecoveryPresentationKind,
  shouldNotifyFileSessionRecoveryFailure,
  type FileSessionRecoveryState,
} from '../model/workbenchFileSessionLifecycle'
import { isLocalFileDrag } from '../model/workbenchFileDrag'
import styles from './WorkbenchFilesPanel.module.scss'
import controlsStyles from './WorkbenchFileControls.module.scss'
import fileListStyles from './WorkbenchFileList.module.scss'
import transferStyles from './WorkbenchTransferBar.module.scss'

const RemoteTextEditorModal = lazy(loadRemoteTextEditorModal)
const RemoteImageViewerModal = lazy(loadRemoteImageViewerModal)
const imagePattern = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i
const panelClassName = (className: string) => [className, styles[className]].filter(Boolean).join(' ')
const controlsClassName = (className: string) => [panelClassName(className), controlsStyles[className]].filter(Boolean).join(' ')
const fileListClassName = (className: string) => `${className} ${fileListStyles[className]}`
const transferClassName = (className: string) => `${className} ${transferStyles[className]}`

interface WorkbenchFilesPanelProps {
  api: FileGateway
  data: WorkbenchFilesData
  fileSessionClosures: Readonly<Record<string, FileSessionClosureState>>
  session: Session | null
  enabled: boolean
  actionBusy: boolean
  closingSessionIds: ReadonlySet<string>
  theme: ThemeMode
  onOpenFull: (session: Session) => Promise<void>
  onManageBookmarks: (session: Session) => Promise<void>
  onCreateFileBookmark: (input: FileBookmarkInput) => Promise<FileBookmark>
  onUpdateFileBookmark: (
    id: string,
    input: FileBookmarkInput,
  ) => Promise<FileBookmark>
  pathNavigationIntent: WorkbenchFilesPathNavigationIntent | null
  onConsumePathNavigationIntent: (requestId: number) => void
  onConnectFileSession: (
    hostId: string,
    sourceSessionId?: string,
    initialPath?: string,
    replacedFileSessionId?: string,
  ) => Promise<FileSession>
  onReconnectSession: (session: Session) => Promise<void>
  onReconnectFileSession: (fileSessionId: string) => Promise<FileSession>
  onUpdateFileSession: (fileSession: FileSession) => void
}

interface WorkbenchFilesData {
  hosts: Host[]
  fileBookmarkGroups: FileBookmarkGroup[]
  fileBookmarks: FileBookmark[]
  fileSessions: FileSession[]
  sessions: Session[]
  settings: Settings
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
  fileSessionClosures,
  session,
  enabled,
  actionBusy,
  closingSessionIds,
  theme,
  onOpenFull,
  onManageBookmarks,
  onCreateFileBookmark,
  onUpdateFileBookmark,
  pathNavigationIntent,
  onConsumePathNavigationIntent,
  onConnectFileSession,
  onReconnectSession,
  onReconnectFileSession,
  onUpdateFileSession,
}: WorkbenchFilesPanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const runtime = useTransferRuntime()
  const closing = Boolean(session?.id && closingSessionIds.has(session.id))
  const files = useWorkbenchSessionFiles({
    api,
    data,
    fileSessionClosures,
    activeSession: session,
    enabled,
    closingSessionIds,
    onConnectFileSession,
    onReconnectFileSession,
    onUpdateFileSession,
  })
  const sessionHost = session?.host_id
    ? data.hosts.find((host) => host.id === session.host_id)
    : undefined
  const proxyRoute = sessionHost?.proxy_id
    ? sessionHost.jump_host_id
      ? 'jump'
      : 'target'
    : null
  const [pathInput, setPathInput] = useState('/')
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [permissionEntry, setPermissionEntry] = useState<RemoteFileEntry | null>(null)
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [textEditorPath, setTextEditorPath] = useState<string | null>(null)
  const [imageViewerPath, setImageViewerPath] = useState<string | null>(null)
  const [editingPath, setEditingPath] = useState(false)
  const [uploadPicking, setUploadPicking] = useState(false)
  const [sessionReconnectPending, setSessionReconnectPending] = useState(false)
  const [breadcrumbScrollState, setBreadcrumbScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  })
  const pathInputRef = useRef<InputRef>(null)
  const recoveryNotificationsRef = useRef(new Map<string, Set<number>>())
  const breadcrumbViewportRef = useRef<HTMLDivElement>(null)
  const breadcrumbPinnedToEndRef = useRef(true)
  const uploadRefreshTasksRef = useRef(new Map<string, TrackedUploadRefresh>())
  const completedUploadPathsRef = useRef(new Map<string, Set<string>>())
  const pathNavigationRequestRef = useRef<{
    requestId: number
    fileSessionId: string
    connectionGeneration: number
    controller: AbortController
  } | null>(null)
  const pathNavigationRecoveryAttemptRef = useRef<number | null>(null)
  const pathNavigationIntentRef = useRef(pathNavigationIntent)
  const fileSessionRef = useRef(files.fileSession)
  const sourceSessionIdRef = useRef(files.sourceSessionId)
  const navigateDirectoryRef = useRef(files.navigateDirectory)
  const reconnectFileSessionRef = useRef(files.reconnect)
  const consumePathNavigationIntentRef = useRef(onConsumePathNavigationIntent)
  pathNavigationIntentRef.current = pathNavigationIntent
  fileSessionRef.current = files.fileSession
  sourceSessionIdRef.current = files.sourceSessionId
  navigateDirectoryRef.current = files.navigateDirectory
  reconnectFileSessionRef.current = files.reconnect
  consumePathNavigationIntentRef.current = onConsumePathNavigationIntent
  const followTerminal = Boolean(files.viewState?.followTerminal)
  const cwdPendingPath = files.connected
    ? files.viewState?.pendingTerminalPath || (
        files.cwdPendingOperation?.status === 'failed'
          ? ''
          : files.cwdPendingOperation?.path ?? ''
      )
    : ''
  const confirmedCwdPath = files.connected && (
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
  const directoryChanging = files.connected && Boolean(pendingDirectoryPath)
  const directoryReadFailed = Boolean(
    files.viewState?.error && files.viewState.failedRequestPath,
  )
  const syncStatus = files.viewState?.syncStatus ?? ''
  const initialDirectoryPlaceholder = !files.viewState?.listing
  const initialDirectoryPending = shouldShowSessionFilesInitialLoading(
    files.viewState,
    files.connected,
  )
  const directoryRefreshing = Boolean(
    files.connected && navigationState?.refreshing && files.viewState?.listing,
  )
  const directoryLoading = initialDirectoryPending || directoryChanging || directoryRefreshing
  const directoryNavigationLocked = closing
    || !files.connected
    || initialDirectoryPlaceholder
    || directoryChanging
  const followingTerminalDirectory = followTerminal
    && Boolean(files.cwdState?.confirmed_path)
    && normalizeRemotePath(files.cwdState?.confirmed_path || '/') === pendingDirectoryPath
  const fileSessionId = files.fileSession?.id
  const fileSessionStatus = files.fileSession?.status
  const fileSessionConnectionGeneration = files.fileSession?.connection_generation ?? 0
  const pathInputId = `workbench-remote-path-${files.sourceSessionId || 'inactive'}`
  const pathErrorId = `${pathInputId}-error`
  const loadDirectory = files.loadDirectory
  const syncMessage = syncStatusMessage(
    syncStatus,
    files.viewState?.syncError ?? '',
    t,
  )
  const syncNoticeTone = !files.connected
    ? ''
    : syncStatus === 'failed' || syncStatus === 'invalid_path'
      ? 'error'
      : syncStatus === 'unsupported'
        ? 'unsupported'
        : syncStatus === 'reconnect-required'
          ? 'reconnect-required'
          : ''
  const followDirectoryLoading = files.connected
    && followTerminal
    && Boolean(files.viewState?.loading)
  const followVisualState = !followTerminal
    ? 'off'
    : !files.connected
      ? 'active'
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
  const cwdRefreshPending = isSessionFilesCwdRefreshPending(
    files.viewState?.cwdRefresh,
  )
  const cwdOperationPending = Boolean(
    files.cwdPendingOperation
    && files.cwdPendingOperation.status !== 'failed',
  )
  const followProgressVisible = files.connected
    && (
      cwdRefreshPending
      || cwdOperationPending
      || followDirectoryLoading
    )
    && (
      followVisualState === 'preparing'
      || followVisualState === 'locating'
      || followVisualState === 'waiting'
      || followVisualState === 'syncing'
    )
  const recoveryVisible = files.recoveryState.phase !== 'idle'
    || files.fileSession?.status === 'disconnected'
    || files.fileSession?.status === 'failed'
  const recoveryPresentation = fileSessionRecoveryPresentation(
    files.fileSession,
    files.recoveryState,
    t,
    Boolean(!files.fileSession && files.viewState?.error),
    proxyRoute,
  )

  const reconnectSourceSession = async () => {
    if (!session || actionBusy || sessionReconnectPending) {
      return
    }
    setSessionReconnectPending(true)
    try {
      await onReconnectSession(session)
    } finally {
      setSessionReconnectPending(false)
    }
  }

  useEffect(() => {
    if (!shouldNotifyFileSessionRecoveryFailure(
      recoveryNotificationsRef.current,
      files.sourceSessionId,
      files.recoveryState,
    )) {
      return
    }
    notification.error({
      key: `workbench-file-recovery-${files.sourceSessionId}`,
      title: recoveryPresentation.title,
      description: recoveryPresentation.detail,
      duration: 4,
      role: 'alert',
      className: 'termous-notification',
    })
  }, [files.recoveryState, files.sourceSessionId, notification, recoveryPresentation.detail, recoveryPresentation.title])

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
    if (pathNavigationRecoveryAttemptRef.current !== pathNavigationIntent?.requestId) {
      pathNavigationRecoveryAttemptRef.current = null
    }
    const currentRequest = pathNavigationRequestRef.current
    if (
      currentRequest
      && currentRequest.requestId !== pathNavigationIntent?.requestId
    ) {
      currentRequest.controller.abort()
      pathNavigationRequestRef.current = null
    }
    const intentMatchesActiveSession = Boolean(
      !enabled
      ? false
      : pathNavigationIntent
        && session?.id === pathNavigationIntent.sourceSessionId
        && files.sourceSessionId === pathNavigationIntent.sourceSessionId
    )
    if (!pathNavigationIntent || !intentMatchesActiveSession) {
      return
    }

    const requestId = pathNavigationIntent.requestId
    const consumeIntent = () => {
      if (pathNavigationIntentRef.current?.requestId !== requestId) {
        return
      }
      const request = pathNavigationRequestRef.current
      if (request?.requestId === requestId) {
        request.controller.abort()
        pathNavigationRequestRef.current = null
      }
      if (pathNavigationRecoveryAttemptRef.current === requestId) {
        pathNavigationRecoveryAttemptRef.current = null
      }
      consumePathNavigationIntentRef.current(requestId)
    }
    const navigationAction = resolveWorkbenchFilesPathNavigationAction({
      fileSessionStatus,
      recoveryCanRetry: files.recoveryCanRetry,
      recoveryBusy: files.recoveryBusy,
      recoveryAttempted: pathNavigationRecoveryAttemptRef.current === requestId,
    })
    if (navigationAction === 'recover') {
      pathNavigationRecoveryAttemptRef.current = requestId
      void reconnectFileSessionRef.current().catch(() => {
        if (pathNavigationIntentRef.current?.requestId !== requestId) {
          return
        }
        notification.error({
          title: t('files.reconnectFailed'),
          duration: 4,
          role: 'alert',
          className: 'termous-notification',
        })
        consumeIntent()
      })
      return
    }
    if (navigationAction === 'fail') {
      if (files.recoveryState.phase !== 'failed') {
        notification.error({
          title: t('files.reconnectFailed'),
          duration: 4,
          role: 'alert',
          className: 'termous-notification',
        })
      }
      consumeIntent()
      return
    }
    if (
      navigationAction !== 'navigate'
      || !fileSessionId
      || pathNavigationRequestRef.current?.requestId === requestId
    ) {
      return
    }

    const requestedFileSessionId = fileSessionId
    const connectionGeneration = fileSessionConnectionGeneration
    const controller = new AbortController()
    pathNavigationRequestRef.current = {
      requestId,
      fileSessionId: requestedFileSessionId,
      connectionGeneration,
      controller,
    }
    const isCurrentRequest = () => {
      const currentFileSession = fileSessionRef.current
      return Boolean(
        !controller.signal.aborted
        && pathNavigationRequestRef.current?.requestId === requestId
        && pathNavigationRequestRef.current.controller === controller
        && pathNavigationIntentRef.current?.requestId === requestId
        && sourceSessionIdRef.current === pathNavigationIntent.sourceSessionId
        && currentFileSession?.id === requestedFileSessionId
        && currentFileSession.status === 'connected'
        && (currentFileSession.connection_generation ?? 0) === connectionGeneration
      )
    }
    const consumeRequest = () => {
      if (!isCurrentRequest()) {
        return
      }
      pathNavigationRequestRef.current = null
      consumePathNavigationIntentRef.current(requestId)
    }
    const notifyNavigationFailure = (description?: string) => {
      notification.error({
        title: t('files.directoryReadFailed'),
        description,
        duration: 4,
        role: 'alert',
        className: 'termous-notification',
      })
    }

    void (async () => {
      try {
        const entry = await api.statFileSessionFile(
          requestedFileSessionId,
          pathNavigationIntent.path,
          controller.signal,
        )
        if (!isCurrentRequest()) {
          return
        }
        const target = resolveWorkbenchFilesPathNavigationTarget(entry)
        if (!target) {
          notifyNavigationFailure(t('workbench.files.invalidPath'))
          consumeRequest()
          return
        }
        const accepted = await navigateDirectoryRef.current(target.directoryPath)
        if (!isCurrentRequest()) {
          return
        }
        if (!accepted) {
          notifyNavigationFailure()
        }
        consumeRequest()
      } catch {
        if (!isCurrentRequest()) {
          return
        }
        notifyNavigationFailure()
        consumeRequest()
      }
    })()

    return () => {
      if (pathNavigationRequestRef.current?.controller === controller) {
        controller.abort()
        pathNavigationRequestRef.current = null
        if (pathNavigationIntentRef.current?.requestId === requestId) {
          pathNavigationRecoveryAttemptRef.current = null
          consumePathNavigationIntentRef.current(requestId)
        }
      }
    }
  }, [
    api,
    enabled,
    fileSessionConnectionGeneration,
    fileSessionId,
    fileSessionStatus,
    files.recoveryBusy,
    files.recoveryCanRetry,
    files.recoveryState.phase,
    files.sourceSessionId,
    notification,
    pathNavigationIntent,
    session?.id,
    t,
  ])

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
    const filesBridge = getTermousBridge()?.files
    const directories = await filesBridge?.pickDirectory()
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
    const filesBridge = getTermousBridge()?.files
    const cached = await filesBridge?.consumeDroppedFilePaths?.(event.dataTransfer.files.length)
    const paths = cached?.length
      ? cached
      : await filesBridge?.pathsFromFileList(event.dataTransfer.files)
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
      className: `${confirmDialogStyles.modal} confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-root']} termous-modal-root`,
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
      className: `${confirmDialogStyles.modal} confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-root']} termous-modal-root`,
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
    className: `${confirmDialogStyles.modal} confirm-modal`,
    rootClassName: `${confirmDialogStyles['modal-root']} termous-modal-root`,
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
    const filesBridge = getTermousBridge()?.files
    const localPaths = await filesBridge?.readClipboardFilePaths()
    await uploadPaths('clipboard', localPaths ?? [])
  }

  const uploadPickedFiles = async () => {
    if (uploadPicking) {
      return
    }
    setUploadPicking(true)
    try {
      const filesBridge = getTermousBridge()?.files
      await uploadPaths('picker', await filesBridge?.pickFiles() ?? [])
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

  if (!files.fileSession || (files.fileSession.status !== 'connected' && !files.viewState?.listing)) {
    const progress = Math.max(4, Math.min(100, files.fileSession?.progress ?? 4))
    const pendingConnection = files.fileSession?.status === 'connecting'
      || files.fileSession?.status === 'waiting_trust'
    return (
      <div className={transferClassName('workbench-file-connect')}>
        {files.recoveryBusy ? <LoaderCircle className={`${uiStyles['is-spinning']} is-spinning`} size={21} /> : <FolderOpen size={21} />}
        <strong>{recoveryPresentation.title}</strong>
        <span>{recoveryPresentation.detail}</span>
        {pendingConnection ? <Progress percent={progress} showInfo={false} size="small" /> : null}
        {files.recoveryCanRetry || files.recoveryBusy ? (
          <Button
            icon={<RefreshCw size={14} />}
            loading={files.recoveryBusy}
            disabled={files.recoveryBusy}
            onClick={() => void files.reconnect()}
          >
            {t('files.reconnect')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <section
      className={[
        panelClassName('workbench-files-panel'),
        fileListStyles['workbench-files-panel'],
        styles.root,
        directoryChanging ? 'is-changing-directory' : '',
      ].filter(Boolean).join(' ')}
      data-workbench-files-panel
    >
      <div className={`${panelClassName('workbench-files-toolbar')} ${controlsStyles.root}`}>
        <header className={panelClassName('workbench-files-summary')}>
          <div className={panelClassName('workbench-files-summary-copy')}>
            <span className={panelClassName('workbench-files-summary-icon')} aria-hidden="true">
              <FolderOpen size={16} />
            </span>
            <span className={panelClassName('workbench-files-summary-text')}>
              <strong>{t('workbench.files.remoteFiles')}</strong>
              <small>
                <span
                  className={[
                    panelClassName('workbench-files-ready-dot'),
                    files.connected ? '' : panelClassName('is-disconnected'),
                  ].filter(Boolean).join(' ')}
                  aria-hidden="true"
                />
                {files.connected ? t('workbench.files.sftpReady') : recoveryPresentation.title}
              </small>
            </span>
          </div>
          <div className={panelClassName('workbench-files-summary-actions')}>
            <Tooltip title={t('app.reload')}>
              <Button
                type="text"
                className={panelClassName('workbench-files-icon-button')}
                aria-label={t('app.reload')}
                icon={<RefreshCw className={directoryRefreshing ? `${uiStyles['is-spinning']} ${panelClassName('is-spinning')}` : ''} size={14} />}
                disabled={directoryLoading || !files.connected}
                onClick={() => void files.loadDirectory(currentPath)}
              />
            </Tooltip>
            <Tooltip title={t('workbench.manageFiles')}>
              <Button
                type="text"
                className={panelClassName('workbench-files-icon-button')}
                aria-label={t('workbench.manageFiles')}
                icon={<ExternalLink size={14} />}
                onClick={() => void runAction(() => onOpenFull(session))}
              />
            </Tooltip>
          </div>
        </header>
        <div className={panelClassName('workbench-files-location')}>
          <Tooltip title={t('files.parent')}>
            <Button
              type="text"
              className={panelClassName('workbench-files-back')}
              aria-label={t('files.parent')}
              icon={<ChevronLeft size={16} />}
              disabled={currentPath === '/' || directoryNavigationLocked}
              onClick={() => void files.navigateDirectory(parentPath(currentPath))}
            />
          </Tooltip>
          <div
            className={[
              panelClassName('workbench-files-address'),
              editingPath ? panelClassName('is-editing') : '',
              directoryLoading ? panelClassName('is-loading') : '',
              directoryChanging ? panelClassName('is-navigating') : '',
              syncStatus === 'invalid_path' ? panelClassName('is-invalid') : '',
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
                  className={panelClassName('workbench-files-path-input')}
                  status={syncStatus === 'invalid_path' ? 'error' : undefined}
                  disabled={directoryNavigationLocked}
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
                  className={panelClassName('workbench-files-address-action')}
                  aria-label={t('files.go')}
                  icon={<Check size={14} />}
                  disabled={directoryNavigationLocked}
                  onClick={() => void submitPath()}
                />
                <Button
                  type="text"
                  className={panelClassName('workbench-files-address-action')}
                  aria-label={t('workbench.files.cancelPathEdit')}
                  icon={<X size={14} />}
                  onClick={cancelPathEditing}
                />
              </>
            ) : (
              <>
                <div
                  className={[
                    panelClassName('workbench-files-breadcrumb-shell'),
                    breadcrumbScrollState.canScrollLeft ? panelClassName('has-left-overflow') : '',
                    breadcrumbScrollState.canScrollRight ? panelClassName('has-right-overflow') : '',
                  ].filter(Boolean).join(' ')}
                >
                  <div
                    ref={breadcrumbViewportRef}
                    className={panelClassName('workbench-files-breadcrumb-viewport')}
                    onScroll={() => updateBreadcrumbScrollState()}
                    onWheel={handleBreadcrumbWheel}
                  >
                    <Breadcrumb
                      className={panelClassName('workbench-files-breadcrumb')}
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
                      className={`${panelClassName('workbench-files-breadcrumb-scroll')} ${panelClassName('is-left')}`}
                      aria-label={t('workbench.files.scrollPathLeft')}
                      disabled={!breadcrumbScrollState.canScrollLeft}
                      icon={<ChevronLeft size={13} />}
                      onClick={() => scrollBreadcrumb('left')}
                    />
                  </Tooltip>
                  <Tooltip title={t('workbench.files.scrollPathRight')}>
                    <Button
                      type="text"
                      className={`${panelClassName('workbench-files-breadcrumb-scroll')} ${panelClassName('is-right')}`}
                      aria-label={t('workbench.files.scrollPathRight')}
                      disabled={!breadcrumbScrollState.canScrollRight}
                      icon={<ChevronRight size={13} />}
                      onClick={() => scrollBreadcrumb('right')}
                    />
                  </Tooltip>
                </div>
                <WorkbenchBookmarksPopover
                  bookmarks={data.fileBookmarks}
                  groups={data.fileBookmarkGroups}
                  currentPath={currentPath}
                  connected={files.connected}
                  disabled={
                    !enabled
                    || closing
                    || initialDirectoryPlaceholder
                  }
                  navigationBusy={actionBusy || directoryChanging}
                  navigationKey={[
                    session.id,
                    fileSessionId ?? '',
                    files.fileSession?.connection_generation ?? 0,
                    currentPath,
                  ].join(':')}
                  onNavigate={files.navigateDirectory}
                  onCreateBookmark={onCreateFileBookmark}
                  onUpdateBookmark={onUpdateFileBookmark}
                  onManageBookmarks={() => {
                    void onManageBookmarks(session)
                  }}
                />
                <Tooltip title={t('workbench.files.editPath')}>
                  <Button
                    type="text"
                    className={panelClassName('workbench-files-address-action')}
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
        <div className={controlsClassName('workbench-files-toolbar-row')}>
          <Tooltip title={t('files.uploadFiles')}>
            <Button
              type="default"
              className={controlsClassName('workbench-files-upload-button')}
              aria-label={t('files.uploadFiles')}
              icon={<Upload size={15} />}
              loading={uploadPicking}
              disabled={directoryNavigationLocked}
              onClick={() => void uploadPickedFiles()}
            >
              <span className={controlsClassName('workbench-files-upload-label')}>{t('files.uploadFiles')}</span>
            </Button>
          </Tooltip>
          <Tooltip title={t('files.newFolder')}>
            <Button
              type="text"
              className={controlsClassName('workbench-files-action-button')}
              aria-label={t('files.newFolder')}
              icon={<FolderPlus size={15} />}
              disabled={directoryNavigationLocked}
              onClick={createDirectory}
            />
          </Tooltip>
          <Tooltip title={t('files.paste')}>
            <Button
              type="text"
              className={controlsClassName('workbench-files-action-button')}
              aria-label={t('files.paste')}
              icon={<Clipboard size={15} />}
              disabled={directoryNavigationLocked}
              onClick={() => void paste()}
            />
          </Tooltip>
          <Tooltip title={followTooltip}>
            <div
              className={controlsClassName('workbench-files-follow')}
              data-state={followVisualState}
              aria-busy={followProgressVisible}
            >
              <span className={controlsClassName('workbench-files-follow-indicator')} aria-hidden="true">
                {followProgressVisible ? (
                  <LoaderCircle className={controlsClassName('workbench-files-follow-spinner')} size={11} />
                ) : (
                  <span className={controlsClassName('workbench-files-follow-dot')} />
                )}
              </span>
              <span>{t('workbench.files.followLabel')}</span>
              <Switch
                size="small"
                className={controlsClassName('workbench-files-follow-switch')}
                aria-label={t('workbench.files.followTerminal')}
                checked={followTerminal}
                disabled={closing || !files.connected}
                onChange={files.setFollowTerminal}
              />
            </div>
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                { key: 'upload-folder', icon: <FolderInput size={14} />, label: t('files.uploadFolder'), disabled: directoryNavigationLocked },
              ],
              onClick: async ({ key }) => {
                if (key === 'upload-folder') {
                  const filesBridge = getTermousBridge()?.files
                  await uploadPaths('picker', await filesBridge?.pickDirectory() ?? [])
                }
              },
            }}
            classNames={{ root: styles['files-row-menu'] }}
          >
            <Button
              type="text"
              className={controlsClassName('workbench-files-action-button')}
              aria-label={t('workbench.files.moreActions')}
              icon={<MoreHorizontal size={15} />}
            />
          </Dropdown>
        </div>
        {recoveryVisible ? (
          <div
            className={`${panelClassName('workbench-file-recovery')} is-${files.recoveryState.phase}`}
            data-phase={files.recoveryState.phase}
            role={files.recoveryState.phase === 'failed' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <span className={panelClassName('workbench-file-recovery-icon')} aria-hidden="true">
              {files.recoveryBusy ? <LoaderCircle className={`${uiStyles['is-spinning']} ${panelClassName('is-spinning')}`} size={14} /> : <CircleAlert size={14} />}
            </span>
            <span className={panelClassName('workbench-file-recovery-copy')}>
              <strong>{recoveryPresentation.title}</strong>
              <small>{recoveryPresentation.detail}</small>
            </span>
            <Button
              size="small"
              icon={<RefreshCw size={13} />}
              loading={files.recoveryBusy}
              disabled={files.recoveryBusy || !files.recoveryCanRetry}
              onClick={() => void files.reconnect()}
            >
              {t('files.reconnect')}
            </Button>
          </div>
        ) : null}
      </div>
      <div
        className={[
          fileListClassName('workbench-file-list-caption'),
          directoryChanging ? fileListClassName('is-navigating') : '',
          directoryReadFailed ? fileListClassName('is-error') : '',
        ].filter(Boolean).join(' ')}
        role={directoryReadFailed ? 'alert' : undefined}
      >
        {directoryReadFailed ? (
          <button
            className={fileListClassName('workbench-file-caption-error')}
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
            className={fileListClassName('workbench-file-navigation-status')}
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
            className={`${fileListClassName('workbench-file-caption-notice')} ${fileListClassName(`is-${syncNoticeTone}`)}`}
            role={syncNoticeTone === 'error' ? 'alert' : 'status'}
          >
            <CircleAlert size={12} aria-hidden="true" />
            <span>{syncMessage}</span>
            {syncStatus === 'failed' ? (
              <Button
                type="link"
                size="small"
                className={fileListClassName('workbench-file-caption-action')}
                icon={<RefreshCw size={11} />}
                disabled={closing || actionBusy}
                onClick={files.retryCwdSync}
              >
                {t('app.retry')}
              </Button>
            ) : syncStatus === 'reconnect-required' ? (
              <Button
                type="link"
                size="small"
                className={fileListClassName('workbench-file-caption-action')}
                icon={<RefreshCw size={11} />}
                loading={sessionReconnectPending}
                disabled={closing || actionBusy || sessionReconnectPending}
                onClick={() => void reconnectSourceSession()}
              >
                {t('workbench.reconnectSession')}
              </Button>
            ) : null}
          </span>
        ) : followProgressVisible && followDetailMessage ? (
          <span
            className={fileListClassName('workbench-file-navigation-status')}
            role="status"
            aria-live="polite"
          >
            <FileStatusSpinner />
            <span>{followDetailMessage}</span>
          </span>
        ) : initialDirectoryPending || directoryRefreshing ? (
          <span
            className={fileListClassName('workbench-file-navigation-status')}
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
        interactionDisabled={!files.connected}
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
      <div className={panelClassName('workbench-file-transfer-overlay')}>
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
            disabled={closing || !files.connected}
            closing={closing}
            fileSessionId={files.fileSession.id}
            connectionGeneration={files.fileSession.connection_generation ?? 0}
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
          panelClassName('workbench-files-crumb'),
          index === 0 ? panelClassName('is-root') : '',
          index === paths.length - 1 ? panelClassName('is-current') : '',
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
    <span className={fileListClassName('workbench-file-status-spinner')} aria-hidden="true">
      <LoaderCircle size={12} />
    </span>
  )
}

function syncStatusMessage(
  status: string,
  errorCode: string,
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
      return proxyConnectionErrorMessage(errorCode, t)
        || t('workbench.files.syncFailed')
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

function fileSessionRecoveryPresentation(
  session: FileSession | null,
  recovery: FileSessionRecoveryState,
  t: ReturnType<typeof useTranslation>['t'],
  initialError = false,
  proxyRoute: 'target' | 'jump' | null = null,
) {
  switch (fileSessionRecoveryPresentationKind(session, recovery, initialError)) {
    case 'recovering':
      return { title: t('workbench.files.recovering'), detail: t('workbench.files.recoveringHint') }
    case 'terminated':
      return { title: t('workbench.files.sessionExpired'), detail: t('workbench.files.sessionExpiredHint') }
    case 'recovery_failed':
      return { title: t('workbench.files.recoveryFailed'), detail: fileSessionRecoveryErrorMessage(recovery.errorCode, t) }
    case 'disconnected':
      return { title: t('workbench.files.fileDisconnected'), detail: t('workbench.files.fileDisconnectedHint') }
    case 'connect_failed':
      return { title: t('workbench.files.connectFailed'), detail: fileSessionRecoveryErrorMessage(session?.error_code || '', t) }
    case 'waiting_trust':
      return { title: t('workbench.files.waitingTrust'), detail: t('workbench.files.waitingTrustHint') }
    case 'connecting_phase':
      return {
        title: t('workbench.files.connecting'),
        detail: proxyRoute && session!.phase === 'dialing'
          ? t(proxyRoute === 'jump'
            ? 'connection.proxyDialingJumpHost'
            : 'connection.proxyDialingTarget')
          : t(`files.sessionPhase.${session!.phase}`),
      }
    default:
      return { title: t('workbench.files.connecting'), detail: t('workbench.files.preparing') }
  }
}

function fileSessionRecoveryErrorMessage(
  errorCode: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  const proxyErrorMessage = proxyConnectionErrorMessage(errorCode, t)
  if (proxyErrorMessage) {
    return proxyErrorMessage
  }
  switch (errorCode.trim().toUpperCase()) {
    case 'SFTP_FILE_SESSION_NOT_FOUND':
      return t('workbench.files.sessionExpiredHint')
    case 'REQUEST_TIMEOUT':
    case 'SFTP_CONNECT_TIMEOUT':
      return t('workbench.files.recoveryTimeout')
    case 'SFTP_SOURCE_SESSION_NOT_FOUND':
    case 'SFTP_SOURCE_SESSION_DISCONNECTED':
      return t('workbench.files.recoverySourceUnavailable')
    case 'NETWORK_ERROR':
    case 'SFTP_CONNECT_FAILED':
    case 'SFTP_RECONNECT_FAILED':
      return t('workbench.files.recoveryUnavailable')
    default:
      return t('workbench.files.recoveryUnknown')
  }
}

function proxyConnectionErrorMessage(
  errorCode: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (errorCode.trim().toUpperCase()) {
    case 'PROXY_CONFIG_INVALID':
      return t('connection.proxyError.configInvalid')
    case 'PROXY_AUTH_REQUIRED':
      return t('connection.proxyError.authRequired')
    case 'PROXY_TIMEOUT':
      return t('connection.proxyError.timeout')
    case 'PROXY_CONNECT_FAILED':
      return t('connection.proxyError.connectFailed')
    case 'PROXY_TUNNEL_FAILED':
      return t('connection.proxyError.tunnelFailed')
    default:
      return ''
  }
}
