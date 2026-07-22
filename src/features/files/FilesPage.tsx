import { App as AntdApp, Breadcrumb, Button, Dropdown, Empty, Input, Table, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clipboard,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  Link,
  MoreHorizontal,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  lazy,
  Suspense,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type MouseEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { HostContextPanel } from '../../components/hosts/HostContextPanel'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { EmptyState } from '../../components/ui/EmptyState'
import { FeatureSidePanel } from '../../components/ui/FeatureSidePanel'
import { SessionTabButton } from '../../components/ui/SessionTabButton'
import { SessionTabStrip } from '../../components/ui/SessionTabStrip'
import { usePersistentBooleanState } from '../../hooks/usePersistentBooleanState'
import { usePersistentJsonState } from '../../hooks/usePersistentJsonState'
import { useRafResizablePanelWidth } from '../../hooks/useRafResizablePanelWidth'
import type {
  AppData,
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
  FileSession,
  FileSessionPhase,
  Host,
  LocalGrantSource,
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
  RemoteDirectoryListing,
  RemoteFileEntry,
  ThemeMode,
  TransferTask,
} from '../../types/domain'
import { useTransferRuntime } from '../../app/useTransferRuntime'
import { buildRemoteFileActionMenu } from '../../components/files/RemoteFileActionMenu'
import { RemotePermissionModal } from '../../components/files/RemotePermissionModal'
import {
  runRemoteFileAction,
  type RemoteFileActionHandlers,
} from '../../components/files/remoteFileActions'
import { fileSortValue, formatBytes, formatDate, joinPath, normalizeRemotePath, parentPath } from './fileUtils'
import { normalizeRemotePosixPath } from '../../shared/remotePosixPath'
import { FileBookmarksPanel } from './FileBookmarksPanel'
import { LocalPathMappingsPanel, type LocalPathRefreshRequest } from './LocalPathMappingsPanel'
import { TransferQueuePanel, type PendingFileOperation } from './TransferQueuePanel'

const RemoteTextEditorModal = lazy(() => import('./RemoteTextEditorModal').then((module) => ({ default: module.RemoteTextEditorModal })))
const RemoteImageViewerModal = lazy(() => import('./RemoteImageViewerModal').then((module) => ({ default: module.RemoteImageViewerModal })))

interface FilesPageProps {
  api: TermousApi
  data: AppData
  theme: ThemeMode
  selectedHostId: string
  activeFileSession: FileSession | null
  closingFileSessionIds: readonly string[]
  onSelectHost: (hostId: string) => void
  onConnectFileSession: (hostId: string) => Promise<FileSession>
  onSelectFileSession: (fileSessionId: string) => void
  onCloseFileSession: (fileSessionId: string) => Promise<void>
  onReconnectFileSession: (fileSessionId: string) => Promise<FileSession>
  onUpdateFileSession: (fileSession: FileSession) => void
  onCreateFileBookmark: (input: FileBookmarkInput) => Promise<FileBookmark>
  onUpdateFileBookmark: (id: string, input: FileBookmarkInput) => Promise<FileBookmark>
  onDeleteFileBookmark: (id: string) => Promise<void>
  onReorderFileBookmarks: (items: FileBookmarkReorderItem[]) => Promise<FileBookmark[]>
  onCreateFileBookmarkGroup: (input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  onUpdateFileBookmarkGroup: (id: string, input: FileBookmarkGroupInput) => Promise<FileBookmarkGroup>
  onDeleteFileBookmarkGroup: (id: string) => Promise<void>
  onReorderFileBookmarkGroups: (items: FileBookmarkGroupReorderItem[]) => Promise<FileBookmarkGroup[]>
  onCreateLocalPathMapping: (input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onReorderLocalPathMappings: (items: LocalPathMappingReorderItem[]) => Promise<LocalPathMapping[]>
}

interface RemoteClipboard {
  mode: 'copy' | 'cut'
  hostId: string
  paths: string[]
}

interface FileSessionEventMessage {
  type: string
  session: FileSession
}

interface UploadRefreshTarget {
  fileSessionId: string
  targetPath: string
}

interface UploadRefreshGroup extends UploadRefreshTarget {
  taskIds: string[]
  hasActive: boolean
  hasCompleted: boolean
  hasTerminal: boolean
}

interface RemoteMoveDragState {
  paths: string[]
}

interface FileContextMenuState {
  entry: RemoteFileEntry
  x: number
  y: number
}

type FileColumnKey = 'name' | 'size' | 'modified' | 'permissions'
type FileColumnWidths = Record<FileColumnKey, number>

interface ResizableFileHeaderCellProps extends HTMLAttributes<HTMLTableCellElement> {
  resizeKey?: FileColumnKey
  onResizeStart?: (key: FileColumnKey, event: MouseEvent<HTMLSpanElement>) => void
}

type FileSideTabKey = 'details' | 'transfers' | 'bookmarks'
type FileLeftTabKey = 'hosts' | 'local'

const fileSessionPhaseOrder: FileSessionPhase[] = [
  'queued',
  'resolving_auth',
  'dialing',
  'host_key_checking',
  'sftp_handshake',
  'ready',
]

const waitingTrustFileSessionPhaseOrder: FileSessionPhase[] = [
  'queued',
  'resolving_auth',
  'dialing',
  'host_key_checking',
  'waiting_host_trust',
  'sftp_handshake',
  'ready',
]

const filesHostPanelWidth = {
  default: 250,
  min: 220,
  max: 360,
}

const filesDetailsPanelWidth = {
  default: 300,
  min: 260,
  max: 420,
}

const defaultFileColumnWidths: FileColumnWidths = {
  name: 220,
  size: 96,
  modified: 154,
  permissions: 104,
}

const minFileColumnWidths: FileColumnWidths = {
  name: 160,
  size: 78,
  modified: 128,
  permissions: 82,
}

const remoteFileDragMime = 'application/x-termous-remote-files'
const fileDragAutoScrollEdge = 72
const fileDragAutoScrollMaxSpeed = 18

const remotePathDisplayName = (path: string) => {
  const normalized = normalizeRemotePath(path)
  if (normalized === '/') {
    return '/'
  }
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

const previewableImageExtensionPattern = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

function isPreviewableImageEntry(entry: RemoteFileEntry) {
  return entry.kind === 'file' && previewableImageExtensionPattern.test(entry.name || entry.path)
}

export function FilesPage(props: FilesPageProps) {
  return <FilesPageContent {...props} />
}

function FilesPageContent({
  api,
  data,
  theme,
  selectedHostId,
  activeFileSession,
  closingFileSessionIds,
  onSelectHost,
  onConnectFileSession,
  onSelectFileSession,
  onCloseFileSession,
  onReconnectFileSession,
  onUpdateFileSession,
  onCreateFileBookmark,
  onUpdateFileBookmark,
  onDeleteFileBookmark,
  onReorderFileBookmarks,
  onCreateFileBookmarkGroup,
  onUpdateFileBookmarkGroup,
  onDeleteFileBookmarkGroup,
  onReorderFileBookmarkGroups,
  onCreateLocalPathMapping,
  onReorderLocalPathMappings,
}: FilesPageProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const filesPageRef = useRef<HTMLElement>(null)
  const filesTableShellRef = useRef<HTMLDivElement>(null)
  const dragDepthRef = useRef(0)
  const autoScrollFrameRef = useRef<number | null>(null)
  const autoScrollSpeedRef = useRef(0)
  const remoteMoveDragRef = useRef<RemoteMoveDragState | null>(null)
  const directoryHistoryRef = useRef<string[]>([])
  const uploadRefreshTasksRef = useRef(new Map<string, UploadRefreshTarget>())
  const downloadRefreshTasksRef = useRef(new Map<string, string>())
  const pendingOperationTimersRef = useRef<number[]>([])
  const lastSessionLoadKeyRef = useRef('')
  const lastActiveFileSessionIdRef = useRef('')
  const fileSessionSocketsRef = useRef(new Map<string, WebSocket>())
  const fileResizeCleanupRef = useRef<(() => void) | null>(null)
  const onUpdateFileSessionRef = useRef(onUpdateFileSession)
  const [currentPath, setCurrentPath] = useState('/')
  const [pathInput, setPathInput] = useState('/')
  const [entries, setEntries] = useState<RemoteFileEntry[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [activeEntry, setActiveEntry] = useState<RemoteFileEntry | null>(null)
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null)
  const [remoteMoveDrag, setRemoteMoveDrag] = useState<RemoteMoveDragState | null>(null)
  const [remoteMoveTargetPath, setRemoteMoveTargetPath] = useState<string | null>(null)
  const [localRefreshRequests, setLocalRefreshRequests] = useState<LocalPathRefreshRequest[]>([])
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [permissionEntry, setPermissionEntry] = useState<RemoteFileEntry | null>(null)
  const [textEditorPath, setTextEditorPath] = useState<string | null>(null)
  const [imageViewerPath, setImageViewerPath] = useState<string | null>(null)
  const [pendingTransferOperations, setPendingTransferOperations] = useState<PendingFileOperation[]>([])
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [connectingHostIds, setConnectingHostIds] = useState<Set<string>>(() => new Set())
  const [fileColumnWidths, setFileColumnWidths] = useState<FileColumnWidths>(defaultFileColumnWidths)
  const [hostPanelCollapsed, setHostPanelCollapsed] = usePersistentBooleanState(
    'termous.ui.files.hostPanelCollapsed.v1',
    false,
  )
  const [detailsCollapsed, setDetailsCollapsed] = usePersistentBooleanState(
    'termous.ui.files.detailsCollapsed.v1',
    false,
  )
  const [detailsActiveTab, setDetailsActiveTab] = usePersistentJsonState<FileSideTabKey>(
    'termous.ui.files.detailsActiveTab.v1',
    'details',
    parseFileSideTabKey,
  )
  const [leftActiveTab, setLeftActiveTab] = usePersistentJsonState<FileLeftTabKey>(
    'termous.ui.files.leftActiveTab.v1',
    'hosts',
    parseFileLeftTabKey,
  )
  const expandHostPanel = useCallback(() => setHostPanelCollapsed(false), [setHostPanelCollapsed])
  const expandDetailsPanel = useCallback(() => setDetailsCollapsed(false), [setDetailsCollapsed])
  const hostPanelResize = useRafResizablePanelWidth({
    storageKey: 'termous.ui.files.hostPanelWidth.v1',
    defaultWidth: filesHostPanelWidth.default,
    minWidth: filesHostPanelWidth.min,
    maxWidth: filesHostPanelWidth.max,
    side: 'left',
    targetRef: filesPageRef,
    cssVariableName: '--files-host-width',
    onExpand: expandHostPanel,
  })
  const detailsPanelResize = useRafResizablePanelWidth({
    storageKey: 'termous.ui.files.detailsPanelWidth.v1',
    defaultWidth: filesDetailsPanelWidth.default,
    minWidth: filesDetailsPanelWidth.min,
    maxWidth: filesDetailsPanelWidth.max,
    side: 'right',
    targetRef: filesPageRef,
    cssVariableName: '--files-details-width',
    onExpand: expandDetailsPanel,
  })
  const filesPageStyle = {
    '--files-host-width': `${hostPanelResize.width}px`,
    '--files-details-width': `${detailsPanelResize.width}px`,
  } as CSSProperties
  const { transfers, upsertTransfer, removeTransfer } = useTransferRuntime()
  const showTransferQueuePanel = () => {
    setDetailsCollapsed(false)
    setDetailsActiveTab('transfers')
  }
  const updatePendingTransferOperation = useCallback((id: string, patch: Partial<PendingFileOperation>) => {
    setPendingTransferOperations((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])
  const startPendingTransferOperation = useCallback((operation: Omit<PendingFileOperation, 'id'>) => {
    const id = `file-op-${Date.now()}-${Math.random().toString(16).slice(2)}`
    setPendingTransferOperations((current) => [{ ...operation, id }, ...current].slice(0, 4))
    return id
  }, [])
  const finishPendingTransferOperation = useCallback((id: string, status: 'success' | 'error', description: string) => {
    updatePendingTransferOperation(id, { status, description, progress: 100, indeterminate: false })
    const timer = window.setTimeout(() => {
      setPendingTransferOperations((current) => current.filter((item) => item.id !== id))
    }, 900)
    pendingOperationTimersRef.current.push(timer)
  }, [updatePendingTransferOperation])

  useEffect(() => () => {
    pendingOperationTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    pendingOperationTimersRef.current = []
  }, [])
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const selectedHostIdStable = selectedHost?.id ?? ''
  const activeFileSessionHost = activeFileSession?.host_id ? data.hosts.find((host) => host.id === activeFileSession.host_id) : undefined
  const activeFileSessionId = activeFileSession?.id ?? ''
  const closingFileSessionIdSet = useMemo(() => new Set(closingFileSessionIds), [closingFileSessionIds])
  const activeFileSessionClosing = Boolean(activeFileSessionId && closingFileSessionIdSet.has(activeFileSessionId))
  const fileSessionConnected = activeFileSession?.status === 'connected' && !activeFileSessionClosing
  const fileSessionConnectedRef = useRef(fileSessionConnected)
  fileSessionConnectedRef.current = fileSessionConnected
  const displayedFileSessionKey = useMemo(
    () => data.fileSessions.map((session) => session.id).join('|'),
    [data.fileSessions],
  )
  const socketFileSessionIds = useMemo(
    () => data.fileSessions
      .filter((session) => !closingFileSessionIdSet.has(session.id))
      .map((session) => session.id)
      .join('|'),
    [closingFileSessionIdSet, data.fileSessions],
  )
  const syncingFileSessionIds = useMemo(
    () =>
      data.fileSessions
        .filter((session) => (
          !closingFileSessionIdSet.has(session.id)
          && (session.status === 'connecting' || session.status === 'waiting_trust')
        ))
        .map((session) => session.id)
        .join('|'),
    [closingFileSessionIdSet, data.fileSessions],
  )
  const selectedHostConnecting = selectedHostIdStable ? connectingHostIds.has(selectedHostIdStable) : false

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.includes(entry.path)),
    [entries, selectedPaths],
  )
  const fileTableScrollWidth = useMemo(
    () => 88 + Object.values(fileColumnWidths).reduce((total, width) => total + width, 0),
    [fileColumnWidths],
  )
  const dropTargetDirectory = useMemo(
    () => entries.find((entry) => entry.kind === 'directory' && entry.path === dropTargetDirectoryPath) ?? null,
    [dropTargetDirectoryPath, entries],
  )
  const remoteMoveTargetDirectory = useMemo(
    () => entries.find((entry) => entry.kind === 'directory' && entry.path === remoteMoveTargetPath) ?? null,
    [remoteMoveTargetPath, entries],
  )
  const dropTargetDirectoryName = dropTargetDirectory?.name ?? (dropTargetDirectoryPath ? remotePathDisplayName(dropTargetDirectoryPath) : '')
  const remoteMoveTargetDirectoryName = remoteMoveTargetDirectory?.name ?? (remoteMoveTargetPath ? remotePathDisplayName(remoteMoveTargetPath) : '')
  const filesLeftTabs = (
    <div className="files-left-tabs" role="tablist" aria-label={t('files.leftTabs')}>
      <button
        type="button"
        className={leftActiveTab === 'hosts' ? 'is-active' : ''}
        role="tab"
        aria-selected={leftActiveTab === 'hosts'}
        onClick={() => setLeftActiveTab('hosts')}
      >
        {t('files.remoteHosts')}
      </button>
      <button
        type="button"
        className={leftActiveTab === 'local' ? 'is-active' : ''}
        role="tab"
        aria-selected={leftActiveTab === 'local'}
        onClick={() => setLeftActiveTab('local')}
        onDragEnter={(event) => {
          if (remoteMoveDragRef.current || remoteMoveDrag || Array.from(event.dataTransfer.types).includes(remoteFileDragMime)) {
            setLeftActiveTab('local')
          }
        }}
      >
        {t('files.localMappingsShort')}
      </button>
    </div>
  )

  const applyListing = useCallback((listing: RemoteDirectoryListing) => {
    setCurrentPath(listing.path)
    setPathInput(listing.path)
    setEntries([...listing.entries].sort((left, right) => fileSortValue(left).localeCompare(fileSortValue(right))))
    setSelectedPaths([])
    setActiveEntry(null)
    setDropTargetDirectoryPath(null)
    setRemoteMoveTargetPath(null)
  }, [])

  useEffect(() => {
    onUpdateFileSessionRef.current = onUpdateFileSession
  }, [onUpdateFileSession])

  useEffect(
    () => () => {
      fileResizeCleanupRef.current?.()
      fileResizeCleanupRef.current = null
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      autoScrollSpeedRef.current = 0
    },
    [],
  )

  const loadDirectory = useCallback(
    async (nextPath: string, options?: { recordHistory?: boolean }) => {
      if (!activeFileSessionId || !fileSessionConnected) {
        setEntries([])
        return
      }
      const normalized = normalizeRemotePosixPath(nextPath)
      if (!normalized) {
        notification.warning({
          message: t('workbench.files.invalidPath'),
          duration: 3,
          role: 'alert',
          className: 'termous-notification',
        })
        return
      }
      setLoading(true)
      try {
        const listing = await api.listFileSessionFiles(activeFileSessionId, normalized)
        if (options?.recordHistory !== false && normalizeRemotePath(currentPath) !== normalizeRemotePath(listing.path)) {
          directoryHistoryRef.current.push(normalizeRemotePath(currentPath))
        }
        applyListing(listing)
      } catch (loadError) {
        notification.error({
          message: t('files.directoryReadFailed'),
          description: loadError instanceof Error ? loadError.message : t('app.error'),
          duration: 5,
          role: 'alert',
          className: 'termous-notification',
        })
      } finally {
        setLoading(false)
      }
    },
    [activeFileSessionId, api, applyListing, currentPath, fileSessionConnected, notification, t],
  )

  const trackUploadRefreshTask = useCallback((task: TransferTask) => {
    if (!isUploadTransfer(task) || !task.file_session_id) {
      return
    }
    uploadRefreshTasksRef.current.set(task.id, {
      fileSessionId: task.file_session_id,
      targetPath: normalizeRemotePath(task.target_path || '/'),
    })
  }, [])

  const trackDownloadRefreshTask = useCallback((task: TransferTask) => {
    if (!isDownloadTransfer(task) || !task.target_path) {
      return
    }
    downloadRefreshTasksRef.current.set(task.id, task.target_path)
  }, [])

  useEffect(() => {
    if (!activeFileSession) {
      lastSessionLoadKeyRef.current = ''
      lastActiveFileSessionIdRef.current = ''
      setCurrentPath('/')
      setPathInput('/')
      setEntries([])
      setSelectedPaths([])
      setActiveEntry(null)
      setTextEditorPath(null)
      setImageViewerPath(null)
      return
    }
    const sessionChanged = lastActiveFileSessionIdRef.current !== activeFileSession.id
    lastActiveFileSessionIdRef.current = activeFileSession.id
    if (sessionChanged) {
      const nextPath = normalizeRemotePath(activeFileSession.current_path || '/')
      directoryHistoryRef.current = []
      setCurrentPath(nextPath)
      setPathInput(nextPath)
      setEntries([])
      setSelectedPaths([])
      setActiveEntry(null)
      setTextEditorPath(null)
      setImageViewerPath(null)
    }
    if (activeFileSession.status !== 'connected') {
      lastSessionLoadKeyRef.current = ''
      return
    }
    const loadKey = `${activeFileSession.id}:${activeFileSession.connected_at ?? ''}`
    if (lastSessionLoadKeyRef.current !== loadKey) {
      lastSessionLoadKeyRef.current = loadKey
      const nextPath = normalizeRemotePath(activeFileSession.current_path || '/')
      void loadDirectory(nextPath, { recordHistory: false })
    }
  }, [activeFileSession, loadDirectory])

  useEffect(() => {
    const transferById = new Map(transfers.map((task) => [task.id, task]))

    transfers.forEach((task) => {
      if (isUploadTransfer(task) && task.file_session_id) {
        uploadRefreshTasksRef.current.set(task.id, {
          fileSessionId: task.file_session_id,
          targetPath: normalizeRemotePath(task.target_path || '/'),
        })
      }
    })

    const currentTargetPath = normalizeRemotePath(currentPath)
    const refreshGroups = new Map<string, UploadRefreshGroup>()
    const missingTaskIds: string[] = []

    uploadRefreshTasksRef.current.forEach((target, taskId) => {
      const task = transferById.get(taskId)
      if (!task) {
        missingTaskIds.push(taskId)
        return
      }

      const groupKey = `${target.fileSessionId}\u0000${target.targetPath}`
      let group = refreshGroups.get(groupKey)
      if (!group) {
        group = {
          ...target,
          taskIds: [],
          hasActive: false,
          hasCompleted: false,
          hasTerminal: false,
        }
        refreshGroups.set(groupKey, group)
      }
      group.taskIds.push(taskId)
      if (isTransferActive(task)) {
        group.hasActive = true
      }
      if (task.status === 'completed') {
        group.hasCompleted = true
      }
      if (isTransferTerminal(task)) {
        group.hasTerminal = true
      }
    })

    missingTaskIds.forEach((taskId) => {
      uploadRefreshTasksRef.current.delete(taskId)
    })

    refreshGroups.forEach((group) => {
      if (group.hasActive || !group.hasTerminal) {
        return
      }

      const isCurrentTarget = group.fileSessionId === activeFileSessionId && group.targetPath === currentTargetPath
      if (group.hasCompleted && fileSessionConnected && isCurrentTarget) {
        void loadDirectory(group.targetPath)
      }

      group.taskIds.forEach((taskId) => {
        const task = transferById.get(taskId)
        if (!task || isTransferTerminal(task)) {
          uploadRefreshTasksRef.current.delete(taskId)
        }
      })
    })
  }, [activeFileSessionId, currentPath, fileSessionConnected, loadDirectory, transfers])

  useEffect(() => {
    const transferById = new Map(transfers.map((task) => [task.id, task]))
    transfers.forEach((task) => {
      if (isDownloadTransfer(task) && task.target_path && (isTransferActive(task) || downloadRefreshTasksRef.current.has(task.id))) {
        downloadRefreshTasksRef.current.set(task.id, task.target_path)
      }
    })

    const completedRequests: LocalPathRefreshRequest[] = []
    const taskIdsToDelete: string[] = []
    downloadRefreshTasksRef.current.forEach((targetPath, taskId) => {
      const task = transferById.get(taskId)
      if (!task) {
        taskIdsToDelete.push(taskId)
        return
      }
      if (isTransferActive(task)) {
        return
      }
      if (task.status === 'completed') {
        completedRequests.push({ id: task.id, targetPath })
      }
      if (isTransferTerminal(task)) {
        taskIdsToDelete.push(taskId)
      }
    })

    taskIdsToDelete.forEach((taskId) => {
      downloadRefreshTasksRef.current.delete(taskId)
    })

    if (completedRequests.length > 0) {
      setLocalRefreshRequests((current) => [...current, ...completedRequests].slice(-50))
    }
  }, [transfers])

  useEffect(() => {
    const ids = new Set(socketFileSessionIds ? socketFileSessionIds.split('|') : [])
    fileSessionSocketsRef.current.forEach((socket, fileSessionId) => {
      if (!ids.has(fileSessionId)) {
        socket.close()
        fileSessionSocketsRef.current.delete(fileSessionId)
      }
    })
    ids.forEach((fileSessionId) => {
      if (fileSessionSocketsRef.current.has(fileSessionId)) {
        return
      }
      const socket = new WebSocket(api.fileSessionEventsUrl(fileSessionId))
      fileSessionSocketsRef.current.set(fileSessionId, socket)
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as FileSessionEventMessage
          if (message.session?.id) {
            onUpdateFileSessionRef.current(message.session)
          }
        } catch {
          socket.close()
        }
      })
      socket.addEventListener('close', () => {
        if (fileSessionSocketsRef.current.get(fileSessionId) === socket) {
          fileSessionSocketsRef.current.delete(fileSessionId)
        }
      })
    })
  }, [api, socketFileSessionIds])

  useEffect(
    () => () => {
      fileSessionSocketsRef.current.forEach((socket) => socket.close())
      fileSessionSocketsRef.current.clear()
    },
    [],
  )

  useEffect(() => {
    const ids = syncingFileSessionIds ? syncingFileSessionIds.split('|') : []
    if (ids.length === 0) {
      return undefined
    }
    let disposed = false
    const syncSessions = async () => {
      await Promise.all(
        ids.map(async (fileSessionId) => {
          try {
            const session = await api.getFileSession(fileSessionId)
            if (!disposed) {
              onUpdateFileSessionRef.current(session)
            }
          } catch {
            // 事件流可能会因窗口休眠或网络抖动漏帧，轮询兜底失败时保持当前 UI 状态即可。
          }
        }),
      )
    }
    void syncSessions()
    const timer = window.setInterval(() => {
      void syncSessions()
    }, 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [api, syncingFileSessionIds])

  useEffect(() => {
    if (!fileContextMenu) {
      return undefined
    }

    const closeOnPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.files-row-menu')) {
        return
      }
      setFileContextMenu(null)
    }
    const closeOnKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFileContextMenu(null)
      }
    }
    const closeOnBlur = () => setFileContextMenu(null)

    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnKeyDown)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnKeyDown)
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [fileContextMenu])

  const closeFileSessionTab = useCallback(
    (fileSessionId: string) => {
      if (closingFileSessionIdSet.has(fileSessionId)) {
        return
      }
      void onCloseFileSession(fileSessionId)
    },
    [closingFileSessionIdSet, onCloseFileSession],
  )

  const closeFileSessionFromTab = useCallback(
    (event: MouseEvent<HTMLElement>, fileSessionId: string) => {
      if (event.button !== 1) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      closeFileSessionTab(fileSessionId)
    },
    [closeFileSessionTab],
  )

  const notifyError = (actionError: unknown) => {
    notification.error({
      title: t('app.error'),
      description: actionError instanceof Error ? actionError.message : t('app.error'),
      duration: 5,
      role: 'alert',
      className: 'termous-notification',
    })
  }

  const runFileAction = async (action: () => Promise<void>, success?: string) => {
    try {
      await action()
      if (success) {
        notification.success({ title: success, duration: 3, role: 'status', className: 'termous-notification' })
      }
    } catch (actionError) {
      notifyError(actionError)
    }
  }

  const connectSelectedHost = async () => {
    if (!selectedHostIdStable || connectingHostIds.has(selectedHostIdStable)) {
      return
    }
    setConnectingHostIds((current) => new Set(current).add(selectedHostIdStable))
    try {
      const fileSession = await onConnectFileSession(selectedHostIdStable)
      onUpdateFileSession(fileSession)
      notification.success({ title: t('files.fileSessionCreated'), duration: 3, role: 'status', className: 'termous-notification' })
    } catch (actionError) {
      notifyError(actionError)
    } finally {
      setConnectingHostIds((current) => {
        const next = new Set(current)
        next.delete(selectedHostIdStable)
        return next
      })
    }
  }

  const uploadLocalPaths = async (source: LocalGrantSource, paths: string[], targetPath = currentPath) => {
    if (!activeFileSessionId || !fileSessionConnected || paths.length === 0) {
      return
    }
    showTransferQueuePanel()
    await runFileAction(async () => {
      const pendingId = startPendingTransferOperation({
        title: t('files.fileOperationUploadTitle'),
        description: t('files.fileOperationTransferGrant'),
        progress: 0,
        status: 'running',
        indeterminate: true,
      })
      try {
        const grant = await api.createLocalFileGrant(source, paths)
        updatePendingTransferOperation(pendingId, {
          description: t('files.fileOperationTransferCreate'),
          progress: 0,
          indeterminate: true,
        })
        const task = await api.createFileSessionUploadTransfer(activeFileSessionId, grant.id, targetPath, 'rename')
        trackUploadRefreshTask(task)
        upsertTransfer(task)
        finishPendingTransferOperation(pendingId, 'success', t('files.fileOperationTransferReady'))
      } catch (actionError) {
        finishPendingTransferOperation(pendingId, 'error', t('files.fileOperationTransferFailed'))
        throw actionError
      }
    }, t('files.transferCreated'))
  }

  const downloadPathsToLocalDir = async (paths: string[], localDir: string) => {
    if (!activeFileSessionId || !fileSessionConnected || paths.length === 0) {
      return
    }
    showTransferQueuePanel()
    await runFileAction(async () => {
      const pendingId = startPendingTransferOperation({
        title: t('files.fileOperationDownloadTitle'),
        description: t('files.fileOperationTransferCreate'),
        progress: 0,
        status: 'running',
        indeterminate: true,
      })
      try {
        const task = await api.createFileSessionDownloadTransfer(activeFileSessionId, paths, localDir, 'rename')
        trackDownloadRefreshTask(task)
        upsertTransfer(task)
        finishPendingTransferOperation(pendingId, 'success', t('files.fileOperationTransferReady'))
      } catch (actionError) {
        finishPendingTransferOperation(pendingId, 'error', t('files.fileOperationTransferFailed'))
        throw actionError
      }
    }, t('files.transferCreated'))
  }

  const downloadPaths = async (paths: string[]) => {
    if (!activeFileSessionId || !fileSessionConnected || paths.length === 0) {
      return
    }
    const localDirs = await window.termous?.files?.pickDirectory()
    const localDir = localDirs?.[0]
    if (!localDir) {
      return
    }
    await downloadPathsToLocalDir(paths, localDir)
  }

  const downloadSelected = () => downloadPaths(selectedPaths)

  const moveRemotePathsToDirectory = async (paths: string[], targetPath: string) => {
    if (!activeFileSession || !fileSessionConnected || paths.length === 0) {
      return
    }
    await runFileAction(async () => {
      await api.moveFileSessionFiles(activeFileSession.id, paths, targetPath, 'rename')
      await loadDirectory(currentPath)
      setRemoteClipboard((current) => {
        if (!current || current.hostId !== activeFileSession.host_id || !current.paths.some((path) => paths.includes(path))) {
          return current
        }
        return null
      })
    }, t('files.operationDone'))
  }

  const pasteRemoteClipboard = async () => {
    if (!fileSessionConnected || !remoteClipboard || !activeFileSession || remoteClipboard.hostId !== activeFileSession.host_id) {
      return false
    }
    await runFileAction(async () => {
      if (remoteClipboard.mode === 'cut') {
        await api.moveFileSessionFiles(activeFileSession.id, remoteClipboard.paths, currentPath, 'rename')
        setRemoteClipboard(null)
      } else {
        await api.copyFileSessionFiles(activeFileSession.id, remoteClipboard.paths, currentPath, 'rename')
      }
      await loadDirectory(currentPath)
    }, t('files.operationDone'))
    return true
  }

  const pasteFromClipboard = async () => {
    if (await pasteRemoteClipboard()) {
      return
    }
    const paths = await window.termous?.files?.readClipboardFilePaths()
    if (paths?.length) {
      await uploadLocalPaths('clipboard', paths)
    }
  }

  const openCreateDirectory = () => {
    if (!fileSessionConnected) {
      return
    }
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
        if (!fileSessionConnectedRef.current) {
          return
        }
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        const target = joinPath(currentPath, cleanName)
        if (!activeFileSessionId) {
          return
        }
        await api.mkdirFileSessionFile(activeFileSessionId, target)
        await loadDirectory(currentPath)
      },
    })
  }

  const openRename = (entry = selectedEntries[0]) => {
    if (!entry || !fileSessionConnected) {
      return
    }
    let name = entry.name
    modal.confirm({
      title: t('files.rename'),
      icon: null,
      content: <Input autoFocus defaultValue={entry.name} onChange={(event) => { name = event.target.value }} />,
      okText: t('app.update'),
      cancelText: t('app.cancel'),
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        if (!fileSessionConnectedRef.current) {
          return
        }
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        if (!activeFileSessionId) {
          return
        }
        await api.renameFileSessionFile(activeFileSessionId, entry.path, joinPath(parentPath(entry.path), cleanName))
        await loadDirectory(currentPath)
      },
    })
  }

  const openPermissions = (entry = selectedEntries[0]) => {
    if (!entry || !fileSessionConnected) {
      return
    }
    setPermissionEntry(entry)
    setActiveEntry(entry)
    setSelectedPaths([entry.path])
  }

  const openFileEntry = (entry = selectedEntries[0]) => {
    if (!entry || !fileSessionConnected) {
      return
    }
    if (entry.kind !== 'file') {
      notification.warning({
        title: t('files.openFileOnlyFiles'),
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
      return
    }
    setActiveEntry(entry)
    setSelectedPaths([entry.path])
    if (isPreviewableImageEntry(entry)) {
      setTextEditorPath(null)
      setImageViewerPath(entry.path)
      return
    }
    setImageViewerPath(null)
    setTextEditorPath(entry.path)
  }

  const handleTextFileSaved = (entry: RemoteFileEntry) => {
    const refreshPath = currentPath
    setEntries((current) => current.map((item) => (item.path === entry.path ? entry : item)))
    setActiveEntry(entry)
    setSelectedPaths([entry.path])
    if (activeFileSessionId && fileSessionConnected) {
      void loadDirectory(refreshPath).then(() => {
        setActiveEntry(entry)
        setSelectedPaths([entry.path])
      })
    }
  }

  const applyPermissions = async (entry: RemoteFileEntry, mode: string) => {
    if (!activeFileSessionId || !fileSessionConnectedRef.current) {
      return
    }
    setPermissionSaving(true)
    try {
      const updated = await api.chmodFileSessionFile(activeFileSessionId, entry.path, mode)
      setEntries((current) => current.map((item) => (item.path === updated.path ? updated : item)))
      await loadDirectory(currentPath)
      setSelectedPaths([updated.path])
      setActiveEntry(updated)
      setPermissionEntry(null)
      notification.success({
        title: t('files.permissionsUpdated'),
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
    } catch (actionError) {
      notifyError(actionError)
    } finally {
      setPermissionSaving(false)
    }
  }

  const confirmDelete = (paths = selectedPaths) => {
    if (!activeFileSessionId || !fileSessionConnected || paths.length === 0) {
      return
    }
    modal.confirm({
      title: t('files.deleteTitle'),
      content: t('files.deleteDescription', { count: paths.length }),
      okText: t('app.delete'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        if (!fileSessionConnectedRef.current) {
          return
        }
        await api.deleteFileSessionFiles(activeFileSessionId, paths, true)
        await loadDirectory(currentPath)
      },
    })
  }

  const pickFiles = async () => {
    const paths = await window.termous?.files?.pickFiles()
    await uploadLocalPaths('picker', paths ?? [])
  }

  const pickFolder = async () => {
    const paths = await window.termous?.files?.pickDirectory()
    await uploadLocalPaths('picker', paths ?? [])
  }

  const copySelected = (mode: 'copy' | 'cut') => {
    if (selectedPaths.length === 0 || !activeFileSession || !fileSessionConnected) {
      return
    }
    setRemoteClipboard({ mode, hostId: activeFileSession.host_id, paths: selectedPaths })
    notification.success({ title: mode === 'cut' ? t('files.cutReady') : t('files.copyReady'), duration: 2 })
  }

  const enterEntry = (entry: RemoteFileEntry) => {
    if (!fileSessionConnected) {
      return
    }
    setActiveEntry(entry)
    if (entry.kind === 'directory') {
      void loadDirectory(entry.path)
    }
  }

  const handleFilePageMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 3) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const previousPath = directoryHistoryRef.current.pop()
    if (!previousPath || previousPath === currentPath) {
      return
    }
    void loadDirectory(previousPath, { recordHistory: false })
  }

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files')

  const hasRemoteDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes(remoteFileDragMime)

  const findDirectoryDropTargetPath = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return null
    }
    const row = target.closest<HTMLTableRowElement>('tr.files-table-row.is-directory')
    const rowKey = row?.getAttribute('data-row-key')
    if (!rowKey) {
      return null
    }
    return entries.some((entry) => entry.kind === 'directory' && entry.path === rowKey) ? rowKey : null
  }

  const canMovePathToDirectory = (sourcePath: string, targetPath: string) => {
    const source = normalizeRemotePath(sourcePath)
    const target = normalizeRemotePath(targetPath)
    const sourceEntry = entries.find((entry) => entry.path === source)
    if (!sourceEntry || parentPath(source) === target) {
      return false
    }
    return sourceEntry.kind !== 'directory' || (target !== source && !target.startsWith(`${source}/`))
  }

  const canDropRemoteMoveToPath = (targetPath: string, sourcePaths: string[]) => (
    sourcePaths.length > 0 && sourcePaths.every((sourcePath) => canMovePathToDirectory(sourcePath, targetPath))
  )

  const findRemoteMoveTargetPath = (target: EventTarget | null, sourcePaths: string[]) => {
    const targetPath = findDirectoryDropTargetPath(target)
    if (!targetPath || sourcePaths.length === 0) {
      return null
    }
    return sourcePaths.every((sourcePath) => canMovePathToDirectory(sourcePath, targetPath)) ? targetPath : null
  }

  const stopFileDragAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = null
    }
    autoScrollSpeedRef.current = 0
  }

  const runFileDragAutoScroll = () => {
    const shell = filesTableShellRef.current
    const speed = autoScrollSpeedRef.current
    if (!shell || speed === 0) {
      autoScrollFrameRef.current = null
      return
    }
    shell.scrollTop += speed
    autoScrollFrameRef.current = window.requestAnimationFrame(runFileDragAutoScroll)
  }

  const updateFileDragAutoScroll = (event: DragEvent<HTMLElement>) => {
    const shell = filesTableShellRef.current
    if (!shell) {
      return
    }
    const rect = shell.getBoundingClientRect()
    const edge = Math.min(fileDragAutoScrollEdge, Math.max(36, rect.height * 0.18))
    const topDistance = event.clientY - rect.top
    const bottomDistance = rect.bottom - event.clientY
    let speed = 0
    if (topDistance >= 0 && topDistance < edge) {
      speed = -Math.max(4, Math.round(((edge - topDistance) / edge) * fileDragAutoScrollMaxSpeed))
    } else if (bottomDistance >= 0 && bottomDistance < edge) {
      speed = Math.max(4, Math.round(((edge - bottomDistance) / edge) * fileDragAutoScrollMaxSpeed))
    }
    const atTop = shell.scrollTop <= 0
    const atBottom = shell.scrollTop + shell.clientHeight >= shell.scrollHeight - 1
    if ((speed < 0 && atTop) || (speed > 0 && atBottom)) {
      speed = 0
    }
    if (speed === 0) {
      stopFileDragAutoScroll()
      return
    }
    autoScrollSpeedRef.current = speed
    if (autoScrollFrameRef.current === null) {
      autoScrollFrameRef.current = window.requestAnimationFrame(runFileDragAutoScroll)
    }
  }

  const resetDragState = () => {
    dragDepthRef.current = 0
    setDragActive(false)
    setDropTargetDirectoryPath(null)
    remoteMoveDragRef.current = null
    setRemoteMoveDrag(null)
    setRemoteMoveTargetPath(null)
    stopFileDragAutoScroll()
  }

  const onBreadcrumbDragOver = (targetPath: string, event: DragEvent<HTMLButtonElement>) => {
    const normalizedTargetPath = normalizeRemotePath(targetPath)
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (remoteDrag || hasRemoteDraggedFiles(event)) {
      event.preventDefault()
      event.stopPropagation()
      const allowed = remoteDrag ? canDropRemoteMoveToPath(normalizedTargetPath, remoteDrag.paths) : false
      event.dataTransfer.dropEffect = allowed ? 'move' : 'none'
      setRemoteMoveTargetPath(allowed ? normalizedTargetPath : null)
      return
    }
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = fileSessionConnected ? 'copy' : 'none'
    setDragActive(fileSessionConnected)
    setDropTargetDirectoryPath(fileSessionConnected ? normalizedTargetPath : null)
  }

  const onBreadcrumbDragLeave = (targetPath: string, event: DragEvent<HTMLButtonElement>) => {
    if (remoteMoveDragRef.current || remoteMoveDrag || hasRemoteDraggedFiles(event) || hasDraggedFiles(event)) {
      event.preventDefault()
      event.stopPropagation()
    }
    if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return
    }
    const normalizedTargetPath = normalizeRemotePath(targetPath)
    setDropTargetDirectoryPath((current) => current === normalizedTargetPath ? null : current)
    setRemoteMoveTargetPath((current) => current === normalizedTargetPath ? null : current)
  }

  const onBreadcrumbDrop = async (targetPath: string, event: DragEvent<HTMLButtonElement>) => {
    const normalizedTargetPath = normalizeRemotePath(targetPath)
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (remoteDrag || hasRemoteDraggedFiles(event)) {
      event.preventDefault()
      event.stopPropagation()
      const sourcePaths = remoteDrag?.paths ?? []
      const allowed = canDropRemoteMoveToPath(normalizedTargetPath, sourcePaths)
      resetDragState()
      if (allowed) {
        await moveRemotePathsToDirectory(sourcePaths, normalizedTargetPath)
      }
      return
    }
    const shouldUpload = hasDraggedFiles(event)
    if (!shouldUpload) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    resetDragState()
    const cachedPaths = await window.termous?.files?.consumeDroppedFilePaths?.(event.dataTransfer.files.length)
    const paths = cachedPaths?.length
      ? cachedPaths
      : await window.termous?.files?.pathsFromFileList(event.dataTransfer.files)
    if (fileSessionConnected && (!paths || paths.length === 0)) {
      notification.warning({
        title: t('files.dropPathUnavailable'),
        duration: 4,
        role: 'status',
        className: 'termous-notification',
      })
      return
    }
    await uploadLocalPaths('drop', paths ?? [], normalizedTargetPath)
  }

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (remoteMoveDragRef.current || remoteMoveDrag || hasRemoteDraggedFiles(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (remoteDrag || hasRemoteDraggedFiles(event)) {
      event.preventDefault()
      event.stopPropagation()
      const sourcePaths = remoteDrag?.paths ?? []
      const targetPath = findRemoteMoveTargetPath(event.target, sourcePaths)
      event.dataTransfer.dropEffect = targetPath ? 'move' : 'none'
      setRemoteMoveTargetPath(targetPath)
      updateFileDragAutoScroll(event)
      return
    }
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = fileSessionConnected ? 'copy' : 'none'
    setDragActive(true)
    setDropTargetDirectoryPath(fileSessionConnected ? findDirectoryDropTargetPath(event.target) : null)
    updateFileDragAutoScroll(event)
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (remoteMoveDragRef.current || remoteMoveDrag || hasRemoteDraggedFiles(event)) {
      event.preventDefault()
      event.stopPropagation()
      if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
        return
      }
      stopFileDragAutoScroll()
      setRemoteMoveTargetPath(null)
      return
    }
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setDragActive(false)
      stopFileDragAutoScroll()
    }
  }

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (remoteDrag || hasRemoteDraggedFiles(event)) {
      const sourcePaths = remoteDrag?.paths ?? []
      const targetPath = findRemoteMoveTargetPath(event.target, sourcePaths)
      event.preventDefault()
      event.stopPropagation()
      resetDragState()
      if (targetPath) {
        await moveRemotePathsToDirectory(sourcePaths, targetPath)
      }
      return
    }
    const shouldUpload = hasDraggedFiles(event)
    const targetPath = fileSessionConnected ? findDirectoryDropTargetPath(event.target) ?? currentPath : currentPath
    event.preventDefault()
    event.stopPropagation()
    resetDragState()
    if (!shouldUpload) {
      return
    }
    const cachedPaths = await window.termous?.files?.consumeDroppedFilePaths?.(event.dataTransfer.files.length)
    const paths = cachedPaths?.length
      ? cachedPaths
      : await window.termous?.files?.pathsFromFileList(event.dataTransfer.files)
    if (fileSessionConnected && (!paths || paths.length === 0)) {
      notification.warning({
        title: t('files.dropPathUnavailable'),
        duration: 4,
        role: 'status',
        className: 'termous-notification',
      })
      return
    }
    await uploadLocalPaths('drop', paths ?? [], targetPath)
  }

  const shouldIgnoreRemoteDragStart = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false
    }
    return Boolean(target.closest('.ant-checkbox, .files-icon-button, .files-table-column-resizer'))
  }

  const remoteDragPathsForEntry = (entry: RemoteFileEntry) => {
    if (selectedPaths.includes(entry.path)) {
      return selectedPaths
    }
    return [entry.path]
  }

  const startRemoteMoveDrag = (entry: RemoteFileEntry, event: DragEvent<HTMLElement>) => {
    if (!fileSessionConnected || loading || shouldIgnoreRemoteDragStart(event.target)) {
      event.preventDefault()
      return
    }
    const paths = remoteDragPathsForEntry(entry)
    setSelectedPaths(paths)
    setActiveEntry(entry)
    remoteMoveDragRef.current = { paths }
    setRemoteMoveDrag({ paths })
    setRemoteMoveTargetPath(null)
    event.dataTransfer.effectAllowed = 'copyMove'
    event.dataTransfer.setData(remoteFileDragMime, JSON.stringify(paths))
    event.dataTransfer.setData('text/plain', entry.name)
  }

  const updateRemoteMoveTarget = (entry: RemoteFileEntry, event: DragEvent<HTMLElement>) => {
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (!remoteDrag || entry.kind !== 'directory') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const targetPath = findRemoteMoveTargetPath(event.currentTarget, remoteDrag.paths)
    event.dataTransfer.dropEffect = targetPath ? 'move' : 'none'
    setRemoteMoveTargetPath(targetPath)
    updateFileDragAutoScroll(event)
  }

  const dropRemoteMoveTarget = async (entry: RemoteFileEntry, event: DragEvent<HTMLElement>) => {
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (!remoteDrag || entry.kind !== 'directory') {
      return
    }
    const sourcePaths = remoteDrag.paths
    const targetPath = findRemoteMoveTargetPath(event.currentTarget, sourcePaths)
    event.preventDefault()
    event.stopPropagation()
    resetDragState()
    if (targetPath) {
      await moveRemotePathsToDirectory(sourcePaths, targetPath)
    }
  }

  const actionDisabled = !fileSessionConnected || loading
  useEffect(() => {
    if (!activeFileSessionClosing) {
      return
    }
    setFileContextMenu(null)
    setImageViewerPath(null)
    setPermissionEntry(null)
    dragDepthRef.current = 0
    setDragActive(false)
    setDropTargetDirectoryPath(null)
    remoteMoveDragRef.current = null
    setRemoteMoveDrag(null)
    setRemoteMoveTargetPath(null)
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = null
    }
    autoScrollSpeedRef.current = 0
  }, [activeFileSessionClosing])
  const rowMenu = (entry: RemoteFileEntry): MenuProps['items'] => buildRemoteFileActionMenu(entry, t)
  const runRowMenuAction = (entry: RemoteFileEntry, key: string) => {
    setFileContextMenu(null)
    if (!fileSessionConnected) {
      return
    }
    setSelectedPaths([entry.path])
    setActiveEntry(entry)
    const handlers: RemoteFileActionHandlers = {
      openFile: openFileEntry,
      download: (target) => void downloadPaths([target.path]),
      copy: (target) => {
        if (activeFileSession) {
          setRemoteClipboard({ mode: 'copy', hostId: activeFileSession.host_id, paths: [target.path] })
        }
      },
      cut: (target) => {
        if (activeFileSession) {
          setRemoteClipboard({ mode: 'cut', hostId: activeFileSession.host_id, paths: [target.path] })
        }
      },
      permissions: openPermissions,
      rename: openRename,
      delete: (target) => confirmDelete([target.path]),
    }
    runRemoteFileAction(entry, key, handlers)
  }
  const fileRowMenuProps = (entry: RemoteFileEntry): MenuProps => ({
    items: rowMenu(entry),
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      runRowMenuAction(entry, String(key))
    },
  })

  const beginFileColumnResize = (key: FileColumnKey, event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    fileResizeCleanupRef.current?.()

    const startX = event.clientX
    const startWidth = fileColumnWidths[key]
    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = Math.max(minFileColumnWidths[key], Math.round(startWidth + moveEvent.clientX - startX))
      setFileColumnWidths((current) => current[key] === nextWidth ? current : { ...current, [key]: nextWidth })
    }
    const cleanup = () => {
      document.body.classList.remove('is-files-column-resizing')
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', cleanup)
      fileResizeCleanupRef.current = null
    }

    document.body.classList.add('is-files-column-resizing')
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', cleanup, { once: true })
    fileResizeCleanupRef.current = cleanup
  }

  const resizableHeader = (key: FileColumnKey) => ({
    resizeKey: key,
    onResizeStart: beginFileColumnResize,
  }) as ResizableFileHeaderCellProps

  const columns = [
    {
      title: t('files.name'),
      dataIndex: 'name',
      width: fileColumnWidths.name,
      onHeaderCell: () => resizableHeader('name'),
      sorter: (left: RemoteFileEntry, right: RemoteFileEntry) => fileSortValue(left).localeCompare(fileSortValue(right)),
      render: (_: unknown, entry: RemoteFileEntry) => {
        const fullName = entry.target ? `${entry.name} -> ${entry.target}` : entry.name
        const nameCopy = (
          <>
            <strong>{entry.name}</strong>
            {entry.target ? <small>{entry.target}</small> : null}
          </>
        )

        return (
          <span className="file-name-cell">
            <span className={`file-kind-icon is-${entry.kind}`}>
              {entry.kind === 'directory' ? <Folder size={16} /> : <File size={16} />}
            </span>
            {entry.kind === 'directory' ? (
              <Tooltip title={fullName} placement="topLeft" mouseEnterDelay={0.35} classNames={{ root: 'file-name-tooltip' }}>
                <button
                  type="button"
                  className="file-name-button"
                  onClick={(event) => {
                    event.stopPropagation()
                    enterEntry(entry)
                  }}
                >
                  {nameCopy}
                </button>
              </Tooltip>
            ) : (
              <Tooltip title={fullName} placement="topLeft" mouseEnterDelay={0.35} classNames={{ root: 'file-name-tooltip' }}>
                <span className="file-name-copy">{nameCopy}</span>
              </Tooltip>
            )}
          </span>
        )
      },
    },
    { title: t('files.size'), dataIndex: 'size', width: fileColumnWidths.size, onHeaderCell: () => resizableHeader('size'), render: (value: number, entry: RemoteFileEntry) => entry.kind === 'directory' ? '-' : formatBytes(value) },
    { title: t('files.modified'), dataIndex: 'modified_at', width: fileColumnWidths.modified, onHeaderCell: () => resizableHeader('modified'), render: (value: string) => formatDate(value) },
    {
      title: t('files.permissions'),
      dataIndex: 'permissions',
      width: fileColumnWidths.permissions,
      onHeaderCell: () => resizableHeader('permissions'),
      render: (value: string, entry: RemoteFileEntry) => entry.permission_octal || value || '-',
    },
    {
      title: '',
      width: 44,
      render: (_: unknown, entry: RemoteFileEntry) => (
        <Dropdown
          disabled={!fileSessionConnected}
          menu={fileRowMenuProps(entry)}
          trigger={['click']}
          classNames={{ root: 'files-row-menu' }}
        >
          <Button
            type="text"
            className="files-icon-button"
            aria-label={t('files.actions')}
            icon={<MoreHorizontal size={16} />}
          />
        </Dropdown>
      ),
    },
  ]

  return (
    <section
      ref={filesPageRef}
      className={`files-page ${hostPanelCollapsed ? 'is-host-collapsed' : ''} ${
        detailsCollapsed ? 'is-details-collapsed' : ''
      } ${dragActive ? 'is-dragging' : ''} ${remoteMoveDrag ? 'is-moving' : ''}`}
      style={filesPageStyle}
      onMouseDown={handleFilePageMouseDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={resetDragState}
      onDrop={(event) => void onDrop(event)}
    >
      {leftActiveTab === 'hosts' || hostPanelCollapsed ? (
        <HostContextPanel
          hosts={data.hosts}
          groups={data.groups}
          selectedHostId={selectedHostIdStable}
          collapsed={hostPanelCollapsed}
          collapsedTitle={t('nav.files')}
          emptyDescription={t('files.noHostHint')}
          searchPlaceholder={t('files.hostSearch')}
          className="files-host-context-panel"
          contentBefore={filesLeftTabs}
          resizing={hostPanelResize.resizing}
          onToggleCollapsed={() => setHostPanelCollapsed((current) => !current)}
          onResizePointerDown={hostPanelResize.beginResize}
          getHostIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
          onSelectHost={onSelectHost}
        />
      ) : (
        <LocalPathMappingsPanel
          api={api}
          mappings={data.localPathMappings}
          collapsed={hostPanelCollapsed}
          resizing={hostPanelResize.resizing}
          remoteDragMime={remoteFileDragMime}
          remoteDragPaths={remoteMoveDrag?.paths ?? []}
          tabs={filesLeftTabs}
          onToggleCollapsed={() => setHostPanelCollapsed((current) => !current)}
          onResizePointerDown={hostPanelResize.beginResize}
          onCreateMapping={onCreateLocalPathMapping}
          onReorderMappings={onReorderLocalPathMappings}
          onDownloadToLocalDir={downloadPathsToLocalDir}
          refreshRequests={localRefreshRequests}
        />
      )}

      <main className="files-main-panel">
        <div className="files-session-toolbar">
          <SessionTabStrip
            ariaLabel={t('files.sessions')}
            activeId={activeFileSessionId}
            contentKey={displayedFileSessionKey}
            scrollLeftLabel={t('workbench.scrollTabsLeft')}
            scrollRightLabel={t('workbench.scrollTabsRight')}
            className="files-session-tabs-shell"
            tabsClassName="files-session-tabs"
          >
            {data.fileSessions.length === 0 ? (
              <SessionTabButton empty icon={<Folder size={18} />} label={t('files.noFileSession')} />
            ) : (
              data.fileSessions.map((fileSession) => {
                const host = data.hosts.find((item) => item.id === fileSession.host_id)
                const label = host?.name ?? shortId(fileSession.id)
                const sessionClosing = closingFileSessionIdSet.has(fileSession.id)
                return (
                  <SessionTabButton
                    key={fileSession.id}
                    active={fileSession.id === activeFileSessionId}
                    role="tab"
                    aria-selected={fileSession.id === activeFileSessionId}
                    data-session-tab-id={fileSession.id}
                    onClick={() => {
                      if (!sessionClosing) {
                        onSelectFileSession(fileSession.id)
                      }
                    }}
                    onMouseDown={(event) => {
                      if (event.button === 1) {
                        event.preventDefault()
                      }
                    }}
                    onAuxClick={(event) => closeFileSessionFromTab(event, fileSession.id)}
                    icon={<Folder size={18} />}
                    label={label}
                    status={fileSession.status}
                    statusLabel={t(`files.sessionStatus.${fileSession.status}`)}
                    closing={sessionClosing}
                    closingLabel={t('files.sessionStatus.closing')}
                    closeLabel={`${t('app.close')} ${label}`}
                    onClose={() => closeFileSessionTab(fileSession.id)}
                  />
                )
              })
            )}
          </SessionTabStrip>
          <ConnectionActionButton
            disabled={!selectedHostIdStable || selectedHostConnecting}
            loading={selectedHostConnecting}
            icon={<Link size={15} />}
            onClick={() => void connectSelectedHost()}
          >
            {t('files.connect')}
          </ConnectionActionButton>
        </div>
        <div className="files-main-toolbar">
          <div className="files-path-stack">
            <PathTrail
              path={currentPath}
              dropTargetPath={remoteMoveTargetPath ?? dropTargetDirectoryPath}
              disabled={!fileSessionConnected}
              onNavigate={(path) => void loadDirectory(path)}
              onDragOver={onBreadcrumbDragOver}
              onDragLeave={onBreadcrumbDragLeave}
              onDrop={onBreadcrumbDrop}
            />
            <Input.Search
              id="files-path-input"
              name="files-path-input"
              size="large"
              value={pathInput}
              disabled={!fileSessionConnected}
              onChange={(event) => setPathInput(event.target.value)}
              onSearch={(value) => void loadDirectory(value)}
              enterButton={t('files.go')}
              className="files-path-input"
            />
          </div>
          <div className="files-toolbar-actions">
            <Tooltip title={t('files.parent')}>
              <Button
                className="secondary-button"
                aria-label={t('files.parent')}
                disabled={actionDisabled || currentPath === '/'}
                icon={<ArrowLeft size={15} />}
                onClick={() => void loadDirectory(parentPath(currentPath))}
              />
            </Tooltip>
            <Tooltip title={t('app.reload')}>
              <Button
                className="secondary-button"
                aria-label={t('app.reload')}
                disabled={actionDisabled}
                icon={<RefreshCw className={loading ? 'is-spinning' : ''} size={15} />}
                onClick={() => void loadDirectory(currentPath)}
              />
            </Tooltip>
            <Button className="secondary-button" disabled={actionDisabled} icon={<FolderPlus size={15} />} onClick={openCreateDirectory}>
              {t('files.newFolder')}
            </Button>
            <Button className="secondary-button" disabled={actionDisabled} icon={<Upload size={15} />} onClick={() => void pickFiles()}>
              {t('files.uploadFiles')}
            </Button>
            <Button className="secondary-button" disabled={actionDisabled} icon={<Folder size={15} />} onClick={() => void pickFolder()}>
              {t('files.uploadFolder')}
            </Button>
            <Button
              type="primary"
              className="primary-button"
              disabled={!fileSessionConnected || selectedPaths.length === 0}
              icon={<Download size={15} />}
              onClick={() => void downloadSelected()}
            >
              {t('files.download')}
            </Button>
            <Button className="secondary-button" disabled={!fileSessionConnected || selectedPaths.length === 0} icon={<Copy size={15} />} onClick={() => copySelected('copy')}>
              {t('files.copy')}
            </Button>
            <Button className="secondary-button" disabled={!fileSessionConnected || selectedPaths.length === 0} icon={<Scissors size={15} />} onClick={() => copySelected('cut')}>
              {t('files.cut')}
            </Button>
            <Button className="secondary-button" disabled={actionDisabled} icon={<Clipboard size={15} />} onClick={() => void pasteFromClipboard()}>
              {t('files.paste')}
            </Button>
            <Button className="danger-button" disabled={!fileSessionConnected || selectedPaths.length === 0} icon={<Trash2 size={15} />} onClick={() => confirmDelete()}>
              {t('app.delete')}
            </Button>
          </div>
        </div>

        <div ref={filesTableShellRef} className="files-table-shell">
          {!activeFileSession ? (
            <div className="files-session-empty">
              <Empty description={t('files.noFileSession')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : activeFileSession.status !== 'connected' ? (
            <FileSessionProgress fileSession={activeFileSession} onReconnect={onReconnectFileSession} />
          ) : (
            <Table
              rowKey="path"
              columns={columns}
              dataSource={entries}
              loading={loading}
              pagination={false}
              components={{ header: { cell: ResizableFileHeaderCell } }}
              scroll={{ x: fileTableScrollWidth }}
              size="middle"
              tableLayout="fixed"
              className="files-table"
              rowSelection={{
                columnWidth: 44,
                selectedRowKeys: selectedPaths,
                getCheckboxProps: () => ({ disabled: !fileSessionConnected }),
                onChange: (keys) => {
                  if (fileSessionConnected) {
                    setSelectedPaths(keys.map(String))
                  }
                },
              }}
              rowClassName={(entry) => [
                'files-table-row',
                `is-${entry.kind}`,
                dropTargetDirectoryPath === entry.path || remoteMoveTargetPath === entry.path ? 'is-drop-target' : '',
                remoteMoveTargetPath === entry.path ? 'is-move-target' : '',
                remoteMoveDrag?.paths.includes(entry.path) ? 'is-being-dragged' : '',
              ].filter(Boolean).join(' ')}
              onRow={(entry) => ({
                draggable: fileSessionConnected && !loading,
                onClick: () => {
                  if (fileSessionConnected) {
                    setActiveEntry(entry)
                  }
                },
                onDoubleClick: () => enterEntry(entry),
                onContextMenu: (event) => {
                  event.preventDefault()
                  if (!fileSessionConnected) {
                    return
                  }
                  setSelectedPaths([entry.path])
                  setActiveEntry(entry)
                  setFileContextMenu({ entry, x: event.clientX, y: event.clientY })
                },
                onDragStart: (event) => startRemoteMoveDrag(entry, event),
                onDragOver: (event) => updateRemoteMoveTarget(entry, event),
                onDragLeave: (event) => {
                  const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
                  if (!remoteDrag || entry.kind !== 'directory') {
                    return
                  }
                  if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
                    return
                  }
                  setRemoteMoveTargetPath((current) => current === entry.path ? null : current)
                },
                onDrop: (event) => void dropRemoteMoveTarget(entry, event),
                onDragEnd: resetDragState,
              })}
              locale={{ emptyText: <EmptyState title={t('files.emptyDirectory')} description={t('files.emptyDirectoryHint')} /> }}
            />
          )}
          {fileContextMenu && fileSessionConnected ? (
            <Dropdown
              open
              trigger={[]}
              placement="bottomLeft"
              menu={fileRowMenuProps(fileContextMenu.entry)}
              classNames={{ root: 'files-row-menu' }}
              onOpenChange={(open) => {
                if (!open) {
                  setFileContextMenu(null)
                }
              }}
            >
              <span
                className="files-context-menu-anchor"
                style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
              />
            </Dropdown>
          ) : null}
        </div>
        {dragActive || remoteMoveDrag ? (
          <div className={`files-drop-mask ${remoteMoveDrag ? 'is-move' : ''}`}>
            {remoteMoveDrag
              ? remoteMoveTargetDirectoryName
                ? t('files.dropMoveToDirectory', { name: remoteMoveTargetDirectoryName })
                : t('files.dropMoveChooseDirectory')
              : dropTargetDirectoryName
                ? t('files.dropUploadToDirectory', { name: dropTargetDirectoryName })
                : t('files.dropUpload')}
          </div>
        ) : null}
      </main>

      <FeatureSidePanel<FileSideTabKey>
        activeKey={detailsActiveTab}
        ariaLabel={t('nav.files')}
        className="files-right-rail"
        collapsed={detailsCollapsed}
        collapseLabel={t('app.collapse')}
        expandLabel={t('app.expand')}
        resizing={detailsPanelResize.resizing}
        onActiveKeyChange={setDetailsActiveTab}
        onCollapsedChange={setDetailsCollapsed}
        onResizePointerDown={detailsPanelResize.beginResize}
        tabs={[
          {
            key: 'details',
            label: t('files.details'),
            icon: <File size={17} aria-hidden="true" />,
            children: (
              <FileDetailPanel
                host={activeFileSessionHost ?? selectedHost}
                entry={activeEntry ?? selectedEntries[0] ?? null}
                onEditPermissions={openPermissions}
              />
            ),
          },
          {
            key: 'transfers',
            label: t('files.transfers'),
            icon: <Upload size={17} aria-hidden="true" />,
            children: (
              <TransferQueuePanel
                transfers={transfers}
                pendingOperations={pendingTransferOperations}
                onCancel={async (id) => {
                  try {
                    await api.deleteTransfer(id)
                  } catch (actionError) {
                    notifyError(actionError)
                  }
                }}
                onDelete={async (id) => {
                  try {
                    await api.deleteTransfer(id)
                    removeTransfer(id)
                  } catch (actionError) {
                    notifyError(actionError)
                  }
                }}
                onRetry={async (id) => {
                  try {
                    const task = await api.retryTransfer(id)
                    upsertTransfer(task)
                  } catch (actionError) {
                    notifyError(actionError)
                  }
                }}
              />
            ),
          },
          {
            key: 'bookmarks',
            label: t('files.bookmarks'),
            icon: <Bookmark size={17} aria-hidden="true" />,
            children: (
              <FileBookmarksPanel
                bookmarks={data.fileBookmarks}
                groups={data.fileBookmarkGroups}
                currentPath={currentPath}
                connected={fileSessionConnected}
                onNavigate={loadDirectory}
                onCreateBookmark={onCreateFileBookmark}
                onUpdateBookmark={onUpdateFileBookmark}
                onDeleteBookmark={onDeleteFileBookmark}
                onReorderBookmarks={onReorderFileBookmarks}
                onCreateGroup={onCreateFileBookmarkGroup}
                onUpdateGroup={onUpdateFileBookmarkGroup}
                onDeleteGroup={onDeleteFileBookmarkGroup}
                onReorderGroups={onReorderFileBookmarkGroups}
              />
            ),
          },
        ]}
      />
      <RemotePermissionModal
        entry={permissionEntry}
        open={Boolean(permissionEntry)}
        saving={permissionSaving}
        onCancel={() => setPermissionEntry(null)}
        onSubmit={(entry, mode) => void applyPermissions(entry, mode)}
      />
      {textEditorPath && activeFileSessionId ? (
        <Suspense fallback={null}>
          <RemoteTextEditorModal
            api={api}
            open={Boolean(textEditorPath && activeFileSessionId)}
            disabled={activeFileSessionClosing}
            fileSessionId={activeFileSessionId}
            path={textEditorPath}
            theme={theme}
            terminalSettings={data.settings.terminal}
            onClose={() => setTextEditorPath(null)}
            onSaved={(entry) => handleTextFileSaved(entry)}
          />
        </Suspense>
      ) : null}
      {imageViewerPath && activeFileSessionId ? (
        <Suspense fallback={null}>
          <RemoteImageViewerModal
            api={api}
            open={Boolean(imageViewerPath && activeFileSessionId)}
            fileSessionId={activeFileSessionId}
            path={imageViewerPath}
            theme={theme}
            onClose={() => setImageViewerPath(null)}
          />
        </Suspense>
      ) : null}
    </section>
  )
}

interface PathTrailProps {
  path: string
  dropTargetPath: string | null
  disabled: boolean
  onNavigate: (path: string) => void
  onDragOver: (path: string, event: DragEvent<HTMLButtonElement>) => void
  onDragLeave: (path: string, event: DragEvent<HTMLButtonElement>) => void
  onDrop: (path: string, event: DragEvent<HTMLButtonElement>) => void
}

function PathTrail({ path, dropTargetPath, disabled, onNavigate, onDragOver, onDragLeave, onDrop }: PathTrailProps) {
  const parts = normalizeRemotePath(path).split('/').filter(Boolean)
  const normalizedDropTargetPath = dropTargetPath ? normalizeRemotePath(dropTargetPath) : null
  const crumbs = [{ label: '/', path: '/' }]
  parts.forEach((part, index) => {
    crumbs.push({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` })
  })
  const items = crumbs.map((crumb, index) => {
    const current = index === crumbs.length - 1
    const dropTarget = normalizedDropTargetPath === crumb.path
    return {
      key: crumb.path,
      title: (
        <button
          type="button"
          className={`files-breadcrumb-link ${current ? 'is-current' : ''} ${index === 0 ? 'is-root' : ''} ${
            dropTarget ? 'is-drop-target' : ''
          }`}
          aria-current={current ? 'page' : undefined}
          disabled={disabled}
          onClick={() => onNavigate(crumb.path)}
          onDragEnter={(event) => onDragOver(crumb.path, event)}
          onDragOver={(event) => onDragOver(crumb.path, event)}
          onDragLeave={(event) => onDragLeave(crumb.path, event)}
          onDrop={(event) => void onDrop(crumb.path, event)}
        >
          {crumb.label}
        </button>
      ),
    }
  })

  return (
    <Breadcrumb
      className="files-breadcrumb"
      aria-label="Path"
      separator={<ChevronRight size={12} strokeWidth={2.2} />}
      items={items}
    />
  )
}

function parseFileSideTabKey(value: unknown): FileSideTabKey {
  if (value === 'transfers' || value === 'bookmarks') {
    return value
  }
  return 'details'
}

function parseFileLeftTabKey(value: unknown): FileLeftTabKey {
  if (value === 'local') {
    return value
  }
  return 'hosts'
}

function ResizableFileHeaderCell({
  resizeKey,
  onResizeStart,
  className,
  children,
  ...props
}: ResizableFileHeaderCellProps) {
  const resizable = resizeKey && onResizeStart

  return (
    <th {...props} className={`${className ?? ''}${resizable ? ' is-files-resizable-column' : ''}`.trim()}>
      {children}
      {resizable ? (
        <span
          className="files-table-column-resizer"
          aria-hidden="true"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => onResizeStart(resizeKey, event)}
        />
      ) : null}
    </th>
  )
}

function FileDetailPanel({
  host,
  entry,
  onEditPermissions,
}: {
  host?: Host
  entry: RemoteFileEntry | null
  onEditPermissions: (entry: RemoteFileEntry) => void
}) {
  const { t } = useTranslation()
  const extended = entry?.extended?.filter((item) => item.type || item.data) ?? []

  return (
    <section className="files-detail-panel">
      {entry ? (
        <>
          <div className="files-detail-hero">
            <span className={`files-detail-kind-icon is-${entry.kind}`}>
              {entry.kind === 'directory' ? <Folder size={19} aria-hidden="true" /> : <File size={19} aria-hidden="true" />}
            </span>
            <div className="files-detail-hero-copy">
              <strong>{entry.name}</strong>
              <span>{host ? host.name : t('files.noHost')}</span>
            </div>
          </div>
          <dl className="files-detail-list">
            <div>
              <dt>{t('files.path')}</dt>
              <dd>{renderFileDetailValue(entry.path)}</dd>
            </div>
            <div>
              <dt>{t('files.kind')}</dt>
              <dd>{renderFileDetailValue(t(`files.kindName.${entry.kind}`))}</dd>
            </div>
            <div>
              <dt>{t('files.size')}</dt>
              <dd>{renderFileDetailValue(entry.kind === 'directory' ? '-' : formatBytes(entry.size))}</dd>
            </div>
            <div>
              <dt>{t('files.mode')}</dt>
              <dd>{renderFileDetailValue(entry.mode)}</dd>
            </div>
            <div>
              <dt>{t('files.permissions')}</dt>
              <dd className="files-permission-detail">
                {renderFileDetailValue(formatPermission(entry))}
                <Button
                  type="text"
                  size="small"
                  className="files-inline-action"
                  icon={<ShieldCheck size={13} />}
                  onClick={() => onEditPermissions(entry)}
                >
                  {t('files.editPermissions')}
                </Button>
              </dd>
            </div>
            <div>
              <dt>{t('files.modified')}</dt>
              <dd>{renderFileDetailValue(formatDate(entry.modified_at))}</dd>
            </div>
            <div>
              <dt>{t('files.accessed')}</dt>
              <dd>{renderFileDetailValue(formatDate(entry.accessed_at))}</dd>
            </div>
            <div>
              <dt>{t('files.hidden')}</dt>
              <dd>{renderFileDetailValue(entry.is_hidden ? t('files.yes') : t('files.no'))}</dd>
            </div>
            <div>
              <dt>{t('files.ownerUid')}</dt>
              <dd>{renderFileDetailValue(entry.uid)}</dd>
            </div>
            <div>
              <dt>{t('files.groupGid')}</dt>
              <dd>{renderFileDetailValue(entry.gid)}</dd>
            </div>
            {entry.target ? (
              <div>
                <dt>{t('files.symlinkTarget')}</dt>
                <dd>{renderFileDetailValue(entry.target)}</dd>
              </div>
            ) : null}
            {extended.map((item, index) => (
              <div key={`${item.type}-${index}`}>
                <dt>{item.type || t('files.extendedType')}</dt>
                <dd>{renderFileDetailValue(item.data)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <div className="files-quiet-empty">
          <strong>{t('files.noSelection')}</strong>
          <span>{t('files.noSelectionHint')}</span>
        </div>
      )}
    </section>
  )
}

function renderFileDetailValue(value?: string | number | null) {
  const display = value === undefined || value === null || value === '' ? '-' : String(value)
  return (
    <Tooltip
      title={display === '-' ? null : display}
      placement="topRight"
      mouseEnterDelay={0.35}
      classNames={{ root: 'file-detail-tooltip' }}
    >
      <span className="files-detail-value">{display}</span>
    </Tooltip>
  )
}

function FileSessionProgress({
  fileSession,
  onReconnect,
}: {
  fileSession: FileSession
  onReconnect: (fileSessionId: string) => Promise<FileSession>
}) {
  const { t } = useTranslation()
  const progress = Math.max(0, Math.min(100, fileSession.progress ?? 0))
  const phase = fileSession.phase ?? 'queued'
  const failed = fileSession.status === 'failed'
  const phaseOrder: FileSessionPhase[] = failed
    ? [...fileSessionPhaseOrder.filter((item) => item !== 'ready'), 'failed' as const]
    : fileSession.status === 'waiting_trust'
      ? waitingTrustFileSessionPhaseOrder
      : fileSessionPhaseOrder
  const currentIndex = phaseOrder.indexOf(phase)
  const message = fileSession.last_error || fileSession.status_message

  return (
    <div className="files-session-progress" role="status" aria-live="polite">
      <div className="connection-progress-head">
        <span>{t(`files.sessionPhase.${phase}`)}</span>
        <strong>{progress}%</strong>
      </div>
      <div className="connection-progress-bar">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="connection-phase-row files-session-phase-row">
        {phaseOrder.map((item, index) => {
          const state = fileSessionPhaseState(fileSession, index, currentIndex)
          const Icon = state === 'done' ? CheckCircle2 : state === 'failed' ? XCircle : state === 'active' ? CircleDashed : Circle
          return (
            <span key={item} className={`connection-phase is-${state}`} title={t(`files.sessionPhase.${item}`)}>
              <Icon size={13} aria-hidden="true" />
              <span>{t(`files.sessionPhaseShort.${item}`)}</span>
            </span>
          )
        })}
      </div>
      <div className="files-session-progress-footer">
        <span>{t(`files.sessionStatus.${fileSession.status}`)}</span>
        {message ? <small>{message}</small> : null}
        {failed ? (
          <Button className="secondary-button" size="small" onClick={() => void onReconnect(fileSession.id)}>
            {t('files.reconnect')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function fileSessionPhaseState(fileSession: FileSession, index: number, currentIndex: number) {
  if (fileSession.status === 'failed') {
    return index === currentIndex ? 'failed' : index < currentIndex ? 'done' : 'idle'
  }
  if (fileSession.status === 'waiting_trust') {
    return index === currentIndex ? 'active' : index < currentIndex ? 'done' : 'idle'
  }
  if (currentIndex < 0) {
    return 'idle'
  }
  if (index < currentIndex) {
    return 'done'
  }
  if (index === currentIndex) {
    return 'active'
  }
  return 'idle'
}

function formatPermission(entry: RemoteFileEntry) {
  if (entry.permission_octal && entry.permissions) {
    return `${entry.permissions} (${entry.permission_octal})`
  }
  return entry.permission_octal || entry.permissions || '-'
}

function isUploadTransfer(task: TransferTask) {
  return task.type.startsWith('upload')
}

function isDownloadTransfer(task: TransferTask) {
  return task.type.startsWith('download')
}

function isTransferActive(task: TransferTask) {
  return task.status === 'queued' || task.status === 'running'
}

function isTransferTerminal(task: TransferTask) {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
}

function shortId(id: string) {
  return id.length > 6 ? id.slice(-6) : id
}
