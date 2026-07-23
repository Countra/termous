import { App as AntdApp, Breadcrumb, Button, Dropdown, Grid, Input, Table, Tooltip } from 'antd'
import type { InputRef, MenuProps, TableColumnsType, TableProps } from 'antd'
import type { TableRef } from 'antd/es/table'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Activity,
  Bookmark,
  Check,
  ChevronRight,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clipboard,
  Copy,
  File,
  Folder,
  FolderDown,
  FolderPlus,
  Info,
  ListTree,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Trash2,
  Upload,
  X,
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
  startTransition,
  type CSSProperties,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type SetStateAction,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { TermousApiError, type TermousApi } from '../../api/client'
import { SessionQuickConnect } from '../../components/hosts/SessionQuickConnect'
import { EmptyState } from '../../components/ui/EmptyState'
import { SessionTabButton } from '../../components/ui/SessionTabButton'
import { SessionTabStrip } from '../../components/ui/SessionTabStrip'
import { usePersistentJsonState } from '../../hooks/usePersistentJsonState'
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
import { formatBytes, formatDate, joinPath, normalizeRemotePath, parentPath } from './fileUtils'
import { normalizeRemotePosixPath } from '../../shared/remotePosixPath'
import { FileBookmarksPanel } from './FileBookmarksPanel'
import {
  subscribeFileSessionEvents,
  type FileSessionEventSubscription,
} from './fileSessionEventSubscription'
import {
  canRecoverFileSession,
  cancelFileSessionRecoveryAttempt,
  fileSessionRecoveryOutcome,
  fileSessionRecoveryRequestMethod,
  findFileSessionRecoveryAttempt,
  isFileSessionRecoverySupersededError,
  isTerminatedFileSession,
  shouldCreateFileSessionAfterReconnect,
  terminatedFileSessionSnapshot,
  type FileSessionRecoveryAttempt,
} from './fileSessionRecovery'
import { LocalPathMappingsPanel, type LocalPathRefreshRequest } from './LocalPathMappingsPanel'
import { LocalDownloadDestinationModal } from './LocalDownloadDestinationModal'
import { TransferQueuePanel } from './TransferQueuePanel'
import { useFilesWorkspaceRuntime } from './useFilesWorkspaceRuntime'
import {
  applyFilesWorkspaceSelection,
  beginFilesWorkspaceHistoryNavigation,
  beginFilesWorkspaceNavigation,
  beginFilesWorkspaceRefresh,
  canStartFilesWorkspaceDirectoryLoad,
  cancelFilesWorkspaceDirectoryRequest,
  clearFilesWorkspaceSelection,
  completeFilesWorkspaceDirectoryRequest,
  createRemoteDirectoryViewState,
  defaultFilesWorkspaceLayoutPreferences,
  failFilesWorkspaceDirectoryRequest,
  filesWorkspaceColumnWidthBounds,
  filesWorkspaceLayoutStorageKey,
  getFilesWorkspaceHistoryTarget,
  getFilesWorkspaceSessionState,
  parseFilesWorkspaceLayoutPreferences,
  resolveFilesWorkspaceAutomaticDirectoryRequest,
  resolveFilesWorkspaceSortState,
  setFilesWorkspaceDirectoryStatus,
  setFilesWorkspaceScrollTop,
  setFilesWorkspaceSortState,
  sortFilesWorkspaceEntries,
  type FilesWorkspaceHistoryMode,
  type FilesWorkspaceSortKey,
  type RemoteDirectoryViewState,
} from './filesWorkspaceState'

const RemoteTextEditorModal = lazy(() => import('./RemoteTextEditorModal').then((module) => ({ default: module.RemoteTextEditorModal })))
const RemoteImageViewerModal = lazy(() => import('./RemoteImageViewerModal').then((module) => ({ default: module.RemoteImageViewerModal })))

interface FilesPageProps {
  api: TermousApi
  data: AppData
  theme: ThemeMode
  activeFileSession: FileSession | null
  closingFileSessionIds: readonly string[]
  onOpenFileSession: (hostId: string) => Promise<void>
  onOpenFileSessionLauncher: () => void
  onConnectFileSession: (
    hostId: string,
    sourceSessionId?: string,
    initialPath?: string,
    replacedFileSessionId?: string,
  ) => Promise<FileSession>
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
  onUpdateLocalPathMapping: (id: string, input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onDeleteLocalPathMapping: (id: string) => Promise<void>
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

interface RemoteMoveDragState {
  paths: string[]
}

interface FileContextMenuState {
  fileSessionId: string
  entry: RemoteFileEntry
  x: number
  y: number
}

interface SessionBoundRemoteEntry {
  fileSessionId: string
  entry: RemoteFileEntry
}

interface SessionBoundRemotePath {
  fileSessionId: string
  path: string
}

interface DownloadDestinationRequest {
  fileSessionId: string
  hostId: string
  paths: string[]
}

interface LoadDirectoryOptions {
  kind?: 'navigate' | 'refresh'
  historyMode?: FilesWorkspaceHistoryMode
  historyIndex?: number
  quiet?: boolean
}

type FileColumnKey = 'name' | 'size' | 'modified' | 'permissions'
type FileColumnWidths = Record<FileColumnKey, number>

interface ResizableFileHeaderCellProps extends HTMLAttributes<HTMLTableCellElement> {
  resizeKey?: FileColumnKey
  resizeLabel?: string
  resizeValue?: number
  resizeMinimum?: number
  resizeMaximum?: number
  onResizeStart?: (key: FileColumnKey, event: MouseEvent<HTMLSpanElement>) => void
  onResizeKeyDown?: (key: FileColumnKey, event: KeyboardEvent<HTMLSpanElement>) => void
}

type FileLocationTabKey = 'bookmarks' | 'local'
type TransferScope = 'session' | 'all'

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

const minFileColumnWidths: FileColumnWidths = {
  name: filesWorkspaceColumnWidthBounds.name.min,
  size: filesWorkspaceColumnWidthBounds.size.min,
  modified: filesWorkspaceColumnWidthBounds.modifiedAt.min,
  permissions: filesWorkspaceColumnWidthBounds.permissions.min,
}

const maxFileColumnWidths: FileColumnWidths = {
  name: filesWorkspaceColumnWidthBounds.name.max,
  size: filesWorkspaceColumnWidthBounds.size.max,
  modified: filesWorkspaceColumnWidthBounds.modifiedAt.max,
  permissions: filesWorkspaceColumnWidthBounds.permissions.max,
}

const remoteFileDragMime = 'application/x-termous-remote-files'
const fileDragAutoScrollEdge = 72
const fileDragAutoScrollMaxSpeed = 18
const filesWorkspaceCacheMaxAgeMs = 5_000
const filesWorkspaceVirtualThreshold = 200

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

function resolveStateAction<T>(action: SetStateAction<T>, current: T) {
  return typeof action === 'function'
    ? (action as (previous: T) => T)(current)
    : action
}

export function FilesPage(props: FilesPageProps) {
  return <FilesPageContent {...props} />
}

function FilesPageContent({
  api,
  data,
  theme,
  activeFileSession,
  closingFileSessionIds,
  onOpenFileSession,
  onOpenFileSessionLauncher,
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
  onUpdateLocalPathMapping,
  onDeleteLocalPathMapping,
  onReorderLocalPathMappings,
}: FilesPageProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const screens = Grid.useBreakpoint()
  const filesPageRef = useRef<HTMLElement>(null)
  const filesTableShellRef = useRef<HTMLDivElement>(null)
  const fileTableRef = useRef<TableRef>(null)
  const dragDepthRef = useRef(0)
  const autoScrollFrameRef = useRef<number | null>(null)
  const autoScrollSpeedRef = useRef(0)
  const remoteMoveDragRef = useRef<RemoteMoveDragState | null>(null)
  const remoteDragPreviewRef = useRef<HTMLElement | null>(null)
  const resetDragStateRef = useRef<() => void>(() => undefined)
  const directoryRequestControllersRef = useRef(new Map<string, AbortController>())
  const downloadRefreshTasksRef = useRef(new Map<string, string>())
  const lastSessionLoadKeyRef = useRef('')
  const lastActiveFileSessionIdRef = useRef('')
  const fileSessionSubscriptionsRef = useRef(new Map<string, FileSessionEventSubscription>())
  const fileSessionRecoveryAttemptsRef = useRef(new Map<string, FileSessionRecoveryAttempt>())
  const fileSessionsRef = useRef(data.fileSessions)
  const fileResizeCleanupRef = useRef<(() => void) | null>(null)
  const panelResizeCleanupRef = useRef<(() => void) | null>(null)
  const breadcrumbViewportRef = useRef<HTMLDivElement>(null)
  const breadcrumbPinnedToEndRef = useRef(true)
  const pathInputRef = useRef<InputRef>(null)
  const locationsToggleRef = useRef<HTMLButtonElement>(null)
  const bookmarksLocationTabRef = useRef<HTMLButtonElement>(null)
  const localLocationTabRef = useRef<HTMLButtonElement>(null)
  const inspectorToggleRef = useRef<HTMLButtonElement>(null)
  const transferToggleRef = useRef<HTMLButtonElement>(null)
  const lastTransferTriggerRef = useRef<HTMLButtonElement | null>(null)
  const pendingPanelFocusRestoreRef = useRef<'locations' | 'inspector' | 'transfers' | null>(null)
  const onUpdateFileSessionRef = useRef(onUpdateFileSession)
  const {
    states: workspaceStates,
    pendingTransferOperations,
    pendingTransferActionIds,
    updateSession: updateWorkspaceSession,
    updateExistingSession: updateExistingWorkspaceSession,
    adoptSession: adoptWorkspaceSession,
    retainSessions: retainWorkspaceSessions,
    startPendingTransferOperation,
    updatePendingTransferOperation,
    removePendingTransferOperation,
    beginPendingTransferAction,
    endPendingTransferAction,
    trackUploadRefreshTask: trackWorkspaceUploadRefreshTask,
    hasUploadRefreshTask,
    consumeUploadRefreshTask,
    pruneUploadRefreshTasks,
    markDirectoryDirty,
    clearDirectoryDirty,
    isDirectoryDirty,
  } = useFilesWorkspaceRuntime()
  const workspaceStatesRef = useRef(workspaceStates)
  workspaceStatesRef.current = workspaceStates
  const [quickConnectOpen, setQuickConnectOpen] = useState(false)
  const [quickConnectQuery, setQuickConnectQuery] = useState('')
  const [pathInput, setPathInput] = useState('/')
  const [editingPath, setEditingPath] = useState(false)
  const [breadcrumbScrollState, setBreadcrumbScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  })
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null)
  const [remoteMoveDrag, setRemoteMoveDrag] = useState<RemoteMoveDragState | null>(null)
  const [remoteMoveTargetPath, setRemoteMoveTargetPath] = useState<string | null>(null)
  const [localRefreshRequests, setLocalRefreshRequests] = useState<LocalPathRefreshRequest[]>([])
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [permissionTarget, setPermissionTarget] = useState<SessionBoundRemoteEntry | null>(null)
  const [textEditorTarget, setTextEditorTarget] = useState<SessionBoundRemotePath | null>(null)
  const [imageViewerTarget, setImageViewerTarget] = useState<SessionBoundRemotePath | null>(null)
  const [downloadDestinationRequest, setDownloadDestinationRequest] = useState<DownloadDestinationRequest | null>(null)
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [fileSessionRecoveryAttempts, setFileSessionRecoveryAttempts] = useState<ReadonlyMap<
    string,
    FileSessionRecoveryAttempt
  >>(() => new Map())
  const [locationsOpen, setLocationsOpen] = useState(false)
  const [locationTab, setLocationTab] = useState<FileLocationTabKey>('bookmarks')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [transfersOpen, setTransfersOpen] = useState(false)
  const [transferScope, setTransferScope] = useState<TransferScope>('session')
  const [tableViewportHeight, setTableViewportHeight] = useState(0)
  const closeLocations = useCallback(() => {
    pendingPanelFocusRestoreRef.current = 'locations'
    setLocationsOpen(false)
  }, [])
  const closeInspector = useCallback(() => {
    pendingPanelFocusRestoreRef.current = 'inspector'
    setInspectorOpen(false)
  }, [])
  const openInspector = useCallback(() => {
    setInspectorOpen(true)
    if (window.innerWidth < 1280) {
      setLocationsOpen(false)
    }
  }, [])
  const closeTransfers = useCallback(() => {
    pendingPanelFocusRestoreRef.current = 'transfers'
    setTransfersOpen(false)
  }, [])

  useEffect(() => {
    const target = pendingPanelFocusRestoreRef.current
    if (
      !target
      || (target === 'locations' && locationsOpen)
      || (target === 'inspector' && inspectorOpen)
      || (target === 'transfers' && transfersOpen)
    ) {
      return
    }
    pendingPanelFocusRestoreRef.current = null
    window.requestAnimationFrame(() => {
      if (target === 'locations') {
        locationsToggleRef.current?.focus()
      } else if (target === 'inspector') {
        inspectorToggleRef.current?.focus()
      } else {
        (lastTransferTriggerRef.current ?? transferToggleRef.current)?.focus()
      }
    })
  }, [inspectorOpen, locationsOpen, transfersOpen])
  const [layoutPreferences, setLayoutPreferences] = usePersistentJsonState(
    filesWorkspaceLayoutStorageKey,
    defaultFilesWorkspaceLayoutPreferences,
    (value) => parseFilesWorkspaceLayoutPreferences(JSON.stringify(value)),
  )
  const fileColumnWidths = useMemo<FileColumnWidths>(() => ({
    name: layoutPreferences.columnWidths.name,
    size: layoutPreferences.columnWidths.size,
    modified: layoutPreferences.columnWidths.modifiedAt,
    permissions: layoutPreferences.columnWidths.permissions,
  }), [layoutPreferences.columnWidths])
  const setFileColumnWidths = useCallback((action: SetStateAction<FileColumnWidths>) => {
    setLayoutPreferences((current) => {
      const previous: FileColumnWidths = {
        name: current.columnWidths.name,
        size: current.columnWidths.size,
        modified: current.columnWidths.modifiedAt,
        permissions: current.columnWidths.permissions,
      }
      const next = resolveStateAction(action, previous)
      return {
        ...current,
        columnWidths: {
          name: next.name,
          size: next.size,
          modifiedAt: next.modified,
          permissions: next.permissions,
        },
      }
    })
  }, [setLayoutPreferences])
  const filesPageStyle = {
    '--files-inspector-width': `${layoutPreferences.inspectorWidth}px`,
    '--files-transfer-dock-height': `${layoutPreferences.transferDockHeight}px`,
  } as CSSProperties
  const {
    transfers,
    connected: transferEventsConnected,
    refresh: refreshTransfers,
    upsertTransfer,
    removeTransfer,
  } = useTransferRuntime()
  const failPendingTransferOperation = useCallback((id: string, description: string) => {
    updatePendingTransferOperation(id, { status: 'error', description, indeterminate: false })
  }, [updatePendingTransferOperation])
  const activeFileSessionHost = activeFileSession?.host_id ? data.hosts.find((host) => host.id === activeFileSession.host_id) : undefined
  const transferHostNames = useMemo(
    () => Object.fromEntries(data.hosts.map((host) => [host.id, host.name])),
    [data.hosts],
  )
  const activeFileSessionId = activeFileSession?.id ?? ''
  const activeFileSessionIdRef = useRef(activeFileSessionId)
  activeFileSessionIdRef.current = activeFileSessionId
  const activeFileSessionInitialPath = normalizeRemotePath(activeFileSession?.current_path || '/')
  const workspaceViewState = useMemo(
    () => activeFileSessionId
      ? getFilesWorkspaceSessionState(
          workspaceStates,
          activeFileSessionId,
          activeFileSessionInitialPath,
        )
      : createRemoteDirectoryViewState('/'),
    [activeFileSessionId, activeFileSessionInitialPath, workspaceStates],
  )
  const workspaceScrollTopRef = useRef(workspaceViewState.scrollTop)
  workspaceScrollTopRef.current = workspaceViewState.scrollTop
  const currentPath = workspaceViewState.committedPath
  const displayedPath = workspaceViewState.pendingPath ?? currentPath
  const entries = useMemo(
    () => sortFilesWorkspaceEntries(
      workspaceViewState.listing?.entries ?? [],
      workspaceViewState.sortState,
    ),
    [workspaceViewState.listing, workspaceViewState.sortState],
  )
  const selectedPaths = workspaceViewState.selectedPaths
  const activeEntry = useMemo(
    () => entries.find((entry) => entry.path === workspaceViewState.focusedPath) ?? null,
    [entries, workspaceViewState.focusedPath],
  )
  const directoryRequestLoading = workspaceViewState.directoryStatus === 'initial_loading'
    || workspaceViewState.directoryStatus === 'navigating'
    || workspaceViewState.directoryStatus === 'refreshing'
  const updateActiveWorkspaceView = useCallback((
    updater: (current: RemoteDirectoryViewState) => RemoteDirectoryViewState,
  ) => {
    if (!activeFileSessionId) {
      return
    }
    updateWorkspaceSession(
      activeFileSessionId,
      activeFileSessionInitialPath,
      updater,
    )
  }, [activeFileSessionId, activeFileSessionInitialPath, updateWorkspaceSession])
  const setSelectedPaths = useCallback((action: SetStateAction<string[]>) => {
    updateActiveWorkspaceView((current) => {
      const selected = resolveStateAction(action, current.selectedPaths)
      return {
        ...current,
        selectedPaths: selected,
        anchorPath: selected[selected.length - 1] ?? null,
      }
    })
  }, [updateActiveWorkspaceView])
  const setActiveEntry = useCallback((entry: RemoteFileEntry | null) => {
    updateActiveWorkspaceView((current) => ({
      ...current,
      focusedPath: entry?.path ?? null,
    }))
  }, [updateActiveWorkspaceView])
  const activeFileSessionRecovery = useMemo(
    () => activeFileSessionId
      ? findFileSessionRecoveryAttempt(
          fileSessionRecoveryAttempts,
          activeFileSessionId,
        )
      : undefined,
    [activeFileSessionId, fileSessionRecoveryAttempts],
  )
  const activeFileSessionHasCachedDirectory = Boolean(workspaceViewState.listing)
  const closingFileSessionIdSet = useMemo(() => new Set(closingFileSessionIds), [closingFileSessionIds])
  const closingFileSessionIdsRef = useRef(closingFileSessionIdSet)
  closingFileSessionIdsRef.current = closingFileSessionIdSet
  const activeFileSessionClosing = Boolean(activeFileSessionId && closingFileSessionIdSet.has(activeFileSessionId))
  const fileSessionConnected = activeFileSession?.status === 'connected' && !activeFileSessionClosing
  const initialDirectoryLoading = fileSessionConnected
    && workspaceViewState.listing === null
    && workspaceViewState.directoryStatus === 'idle'
    && !workspaceViewState.error
  const loading = directoryRequestLoading || initialDirectoryLoading
  fileSessionsRef.current = data.fileSessions
  const displayedFileSessionKey = useMemo(
    () => data.fileSessions.map((session) => session.id).join('|'),
    [data.fileSessions],
  )
  const socketFileSessionIds = useMemo(
    () => data.fileSessions
      .filter((session) => (
        !closingFileSessionIdSet.has(session.id)
        && !isTerminatedFileSession(session)
      ))
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
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.includes(entry.path)),
    [entries, selectedPaths],
  )
  const fileTableScrollWidth = useMemo(
    () => (
      78
      + fileColumnWidths.name
      + (screens.md ? fileColumnWidths.size : 0)
      + (screens.lg ? fileColumnWidths.modified : 0)
      + (screens.xl ? fileColumnWidths.permissions : 0)
    ),
    [fileColumnWidths, screens.lg, screens.md, screens.xl],
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

  useEffect(() => {
    onUpdateFileSessionRef.current = onUpdateFileSession
  }, [onUpdateFileSession])

  useEffect(
    () => () => {
      // React 严格模式会在开发环境模拟一次卸载；必须释放加载标记，让第二次挂载重新发起被取消的首次请求。
      lastSessionLoadKeyRef.current = ''
      fileResizeCleanupRef.current?.()
      fileResizeCleanupRef.current = null
      panelResizeCleanupRef.current?.()
      panelResizeCleanupRef.current = null
      directoryRequestControllersRef.current.forEach((controller, fileSessionId) => {
        controller.abort()
        updateExistingWorkspaceSession(
          fileSessionId,
          cancelFilesWorkspaceDirectoryRequest,
        )
      })
      directoryRequestControllersRef.current.clear()
      remoteDragPreviewRef.current?.remove()
      remoteDragPreviewRef.current = null
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      autoScrollSpeedRef.current = 0
    },
    [updateExistingWorkspaceSession],
  )

  useEffect(() => {
    const resetDragState = () => resetDragStateRef.current()
    window.addEventListener('blur', resetDragState)
    document.addEventListener('dragend', resetDragState)
    return () => {
      window.removeEventListener('blur', resetDragState)
      document.removeEventListener('dragend', resetDragState)
    }
  }, [])

  const loadDirectory = useCallback(
    async (nextPath: string, options: LoadDirectoryOptions = {}) => {
      if (!activeFileSession || !fileSessionConnected) {
        return
      }
      const requestSession = activeFileSession
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

      const currentState = getFilesWorkspaceSessionState(
        workspaceStatesRef.current,
        requestSession.id,
        requestSession.current_path || '/',
      )
      const request = options.historyMode === 'traverse'
        ? beginFilesWorkspaceHistoryNavigation(
            currentState,
            options.historyIndex ?? currentState.historyIndex,
          )
        : options.kind === 'refresh'
          ? beginFilesWorkspaceRefresh(currentState)
          : beginFilesWorkspaceNavigation(currentState, normalized, {
              historyMode: options.historyMode,
            })
      if (!request) {
        return
      }

      const controller = new AbortController()
      directoryRequestControllersRef.current.get(requestSession.id)?.abort()
      directoryRequestControllersRef.current.set(requestSession.id, controller)
      updateWorkspaceSession(
        requestSession.id,
        requestSession.current_path || '/',
        () => request.state,
      )
      try {
        const listing = await api.listFileSessionFiles(
          requestSession.id,
          normalized,
          { signal: controller.signal },
        )
        const isCurrentRequest = directoryRequestControllersRef.current.get(requestSession.id) === controller
        updateExistingWorkspaceSession(
          requestSession.id,
          (latest) => completeFilesWorkspaceDirectoryRequest(
            latest,
            request.requestSequence,
            listing,
            Date.now(),
          ),
        )
        if (
          isCurrentRequest
          && fileSessionsRef.current.some((session) => (
            session.id === requestSession.id && session.status === 'connected'
          ))
        ) {
          clearDirectoryDirty(requestSession.id, normalized)
        }
        setDropTargetDirectoryPath(null)
        setRemoteMoveTargetPath(null)
      } catch (loadError) {
        if (controller.signal.aborted) {
          return
        }
        const description = loadError instanceof Error ? loadError.message : t('app.error')
        updateExistingWorkspaceSession(
          requestSession.id,
          (latest) => failFilesWorkspaceDirectoryRequest(
            latest,
            request.requestSequence,
            description,
          ),
        )
        if (options.quiet) {
          return
        }
        const currentSession = fileSessionsRef.current.find((session) => session.id === requestSession.id)
        if (
          activeFileSessionIdRef.current !== requestSession.id
          || currentSession?.status !== 'connected'
          || closingFileSessionIdsRef.current.has(requestSession.id)
        ) {
          return
        }
        notification.error({
          message: t('files.directoryReadFailed'),
          description,
          duration: 5,
          role: 'alert',
          className: 'termous-notification',
        })
      } finally {
        if (directoryRequestControllersRef.current.get(requestSession.id) === controller) {
          directoryRequestControllersRef.current.delete(requestSession.id)
        }
      }
    },
    [
      activeFileSession,
      api,
      clearDirectoryDirty,
      fileSessionConnected,
      notification,
      t,
      updateExistingWorkspaceSession,
      updateWorkspaceSession,
    ],
  )

  const retryDirectoryRequest = useCallback(() => {
    const failedRequest = workspaceViewState.failedRequest
    if (failedRequest) {
      void loadDirectory(failedRequest.path, {
        kind: failedRequest.kind,
        historyMode: failedRequest.historyMode,
        historyIndex: failedRequest.historyIndex ?? undefined,
      })
      return
    }
    void loadDirectory(currentPath, { kind: 'refresh' })
  }, [currentPath, loadDirectory, workspaceViewState.failedRequest])

  const trackUploadRefreshTask = useCallback((task: TransferTask) => {
    if (!isUploadTransfer(task) || !task.file_session_id) {
      return
    }
    trackWorkspaceUploadRefreshTask(task.id, {
      fileSessionId: task.file_session_id,
      targetPath: normalizeRemotePath(task.target_path || '/'),
    })
  }, [trackWorkspaceUploadRefreshTask])

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
      setPathInput('/')
      setFileContextMenu(null)
      setPermissionTarget(null)
      setTextEditorTarget(null)
      setImageViewerTarget(null)
      return
    }
    const sessionChanged = lastActiveFileSessionIdRef.current !== activeFileSession.id
    lastActiveFileSessionIdRef.current = activeFileSession.id
    if (sessionChanged) {
      const cached = getFilesWorkspaceSessionState(
        workspaceStatesRef.current,
        activeFileSession.id,
        activeFileSession.current_path || '/',
      )
      setPathInput(cached.committedPath)
      setEditingPath(false)
      setFileContextMenu(null)
      setPermissionTarget(null)
      setTextEditorTarget(null)
      setImageViewerTarget(null)
    }
    if (!canStartFilesWorkspaceDirectoryLoad(
      activeFileSession.status,
      Boolean(activeFileSessionRecovery),
    )) {
      lastSessionLoadKeyRef.current = ''
      return
    }
    const loadKey = `${activeFileSession.id}:${activeFileSession.connected_at ?? ''}`
    if (lastSessionLoadKeyRef.current === loadKey) {
      return undefined
    }
    const cached = getFilesWorkspaceSessionState(
      workspaceStatesRef.current,
      activeFileSession.id,
      activeFileSession.current_path || '/',
    )
    const cacheDirty = isDirectoryDirty(activeFileSession.id, cached.committedPath)
    const automaticRequest = resolveFilesWorkspaceAutomaticDirectoryRequest(
      cached,
      activeFileSession.current_path || '/',
      Date.now(),
      filesWorkspaceCacheMaxAgeMs,
      cacheDirty,
    )
    if (!automaticRequest) {
      lastSessionLoadKeyRef.current = loadKey
      return undefined
    }
    const request = automaticRequest.kind === 'initial'
      ? {
          path: automaticRequest.path,
          options: { historyMode: 'replace' as const },
        }
      : {
          path: automaticRequest.path,
          options: { kind: 'refresh' as const, quiet: true },
        }

    // 将首次请求推迟到严格模式的试运行清理之后，避免发送一条必然被取消的重复请求。
    const timer = window.setTimeout(() => {
      const currentSession = fileSessionsRef.current.find((session) => session.id === activeFileSession.id)
      if (
        activeFileSessionIdRef.current !== activeFileSession.id
        || currentSession?.status !== 'connected'
        || Boolean(activeFileSessionRecovery)
        || closingFileSessionIdsRef.current.has(activeFileSession.id)
        || directoryRequestControllersRef.current.has(activeFileSession.id)
      ) {
        return
      }
      lastSessionLoadKeyRef.current = loadKey
      void loadDirectory(request.path, request.options)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [activeFileSession, activeFileSessionRecovery, isDirectoryDirty, loadDirectory])

  useEffect(() => {
    if (!editingPath) {
      setPathInput(currentPath)
    }
  }, [activeFileSessionId, currentPath, editingPath])

  useEffect(() => {
    const fileSessionIds = new Set(data.fileSessions.map((session) => session.id))
    retainWorkspaceSessions(fileSessionIds)
  }, [data.fileSessions, retainWorkspaceSessions])

  useEffect(() => {
    const fileSessionsById = new Map(data.fileSessions.map((session) => [session.id, session]))
    directoryRequestControllersRef.current.forEach((controller, fileSessionId) => {
      const fileSession = fileSessionsById.get(fileSessionId)
      if (
        fileSession?.status === 'connected'
        && !closingFileSessionIdSet.has(fileSessionId)
      ) {
        return
      }
      controller.abort()
      directoryRequestControllersRef.current.delete(fileSessionId)
      updateExistingWorkspaceSession(
        fileSessionId,
        cancelFilesWorkspaceDirectoryRequest,
      )
    })
  }, [
    closingFileSessionIdSet,
    data.fileSessions,
    updateExistingWorkspaceSession,
  ])

  useEffect(() => {
    if (!locationsOpen || !inspectorOpen) {
      return undefined
    }
    const keepNarrowPanelsExclusive = () => {
      if (window.innerWidth < 1280) {
        const shouldRestoreFocus = document.activeElement instanceof HTMLElement
          && document.activeElement.closest('#files-locations-drawer') !== null
        if (shouldRestoreFocus) {
          closeLocations()
        } else {
          setLocationsOpen(false)
        }
      }
    }
    keepNarrowPanelsExclusive()
    window.addEventListener('resize', keepNarrowPanelsExclusive)
    return () => window.removeEventListener('resize', keepNarrowPanelsExclusive)
  }, [closeLocations, inspectorOpen, locationsOpen])

  useEffect(() => {
    if (!locationsOpen) {
      return
    }
    window.requestAnimationFrame(() => {
      const target = locationTab === 'bookmarks'
        ? bookmarksLocationTabRef.current
        : localLocationTabRef.current
      target?.focus()
    })
  }, [locationTab, locationsOpen])

  useEffect(() => {
    if (!activeFileSessionId) {
      return
    }
    if (activeFileSessionClosing) {
      directoryRequestControllersRef.current.get(activeFileSessionId)?.abort()
      directoryRequestControllersRef.current.delete(activeFileSessionId)
      updateActiveWorkspaceView((current) => setFilesWorkspaceDirectoryStatus(current, 'closing'))
      return
    }
    const recovering = Boolean(activeFileSessionRecovery)
    if (recovering) {
      directoryRequestControllersRef.current.get(activeFileSessionId)?.abort()
      directoryRequestControllersRef.current.delete(activeFileSessionId)
      updateActiveWorkspaceView((current) => setFilesWorkspaceDirectoryStatus(current, 'recovering'))
      return
    }
    if (activeFileSession?.status === 'failed' || activeFileSession?.status === 'disconnected') {
      directoryRequestControllersRef.current.get(activeFileSessionId)?.abort()
      directoryRequestControllersRef.current.delete(activeFileSessionId)
      updateActiveWorkspaceView((current) => setFilesWorkspaceDirectoryStatus(
        current,
        'offline',
        activeFileSession.last_error || activeFileSession.status_message || '',
      ))
      return
    }
    if (activeFileSession?.status === 'connected') {
      updateActiveWorkspaceView((current) => {
        if (
          current.activeRequest
          || !['offline', 'recovering', 'closing'].includes(current.directoryStatus)
        ) {
          return current
        }
        return {
          ...current,
          directoryStatus: 'idle',
          error: '',
        }
      })
    }
  }, [
    activeFileSession,
    activeFileSessionClosing,
    activeFileSessionId,
    activeFileSessionRecovery,
    updateActiveWorkspaceView,
  ])

  useEffect(() => {
    const transferIds = new Set(transfers.map((task) => task.id))
    pruneUploadRefreshTasks(transferIds)
    const completedTargets = new Map<string, { fileSessionId: string; targetPath: string }>()
    transfers.forEach((task) => {
      if (!isUploadTransfer(task) || !task.file_session_id) {
        return
      }
      if (isTransferActive(task)) {
        trackUploadRefreshTask(task)
      }
      if (!isTransferTerminal(task)) {
        return
      }
      if (!hasUploadRefreshTask(task.id)) {
        return
      }
      const target = consumeUploadRefreshTask(task.id)
      if (task.status === 'completed' && target) {
        completedTargets.set(
          `${target.fileSessionId}\u0000${target.targetPath}`,
          target,
        )
      }
    })
    const currentTargetPath = normalizeRemotePath(currentPath)
    completedTargets.forEach((target) => {
      markDirectoryDirty(target.fileSessionId, target.targetPath)
      if (
        fileSessionConnected
        && target.fileSessionId === activeFileSessionId
        && target.targetPath === currentTargetPath
      ) {
        void loadDirectory(target.targetPath, { kind: 'refresh', quiet: true })
      }
    })
  }, [
    activeFileSessionId,
    consumeUploadRefreshTask,
    currentPath,
    fileSessionConnected,
    hasUploadRefreshTask,
    loadDirectory,
    markDirectoryDirty,
    pruneUploadRefreshTasks,
    trackUploadRefreshTask,
    transfers,
  ])

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
    fileSessionSubscriptionsRef.current.forEach((subscription, fileSessionId) => {
      if (!ids.has(fileSessionId)) {
        fileSessionSubscriptionsRef.current.delete(fileSessionId)
        subscription.dispose()
      }
    })
    ids.forEach((fileSessionId) => {
      if (fileSessionSubscriptionsRef.current.has(fileSessionId)) {
        return
      }
      const subscription = subscribeFileSessionEvents({
        createSocket: () => new WebSocket(api.fileSessionEventsUrl(fileSessionId)),
        getSnapshot: async () => {
          const snapshot = await api.getFileSession(fileSessionId)
          if (snapshot.id !== fileSessionId) {
            throw new Error('file session snapshot identity mismatch')
          }
          return snapshot
        },
        onSnapshot: (snapshot) => onUpdateFileSessionRef.current(snapshot),
        onMessage: (data) => {
          const message = JSON.parse(String(data)) as FileSessionEventMessage
          if (!message.session) {
            return false
          }
          if (message.session.id !== fileSessionId) {
            throw new Error('file session event identity mismatch')
          }
          if (message.type === 'closed') {
            onUpdateFileSessionRef.current(terminatedFileSessionSnapshot(message.session))
            return 'stop'
          }
          onUpdateFileSessionRef.current(message.session)
          return true
        },
        onSnapshotError: (error) => {
          if (!isMissingFileSessionError(error)) {
            return 'retry'
          }
          const current = fileSessionsRef.current.find((session) => session.id === fileSessionId)
          if (current) {
            onUpdateFileSessionRef.current(terminatedFileSessionSnapshot(current))
          }
          return 'stop'
        },
      })
      fileSessionSubscriptionsRef.current.set(fileSessionId, subscription)
    })
  }, [api, socketFileSessionIds])

  useEffect(
    () => () => {
      const subscriptions = [...fileSessionSubscriptionsRef.current.values()]
      fileSessionSubscriptionsRef.current.clear()
      subscriptions.forEach((subscription) => subscription.dispose())
    },
    [updateWorkspaceSession],
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

  const cancelRecoveryForFileSession = useCallback((fileSessionId: string) => {
    if (!cancelFileSessionRecoveryAttempt(
      fileSessionRecoveryAttemptsRef.current,
      fileSessionId,
    )) {
      return
    }
    notification.destroy(`files-session-recovery-${fileSessionId}`)
    setFileSessionRecoveryAttempts(new Map(fileSessionRecoveryAttemptsRef.current))
  }, [notification])

  useEffect(() => {
    closingFileSessionIds.forEach(cancelRecoveryForFileSession)
  }, [cancelRecoveryForFileSession, closingFileSessionIds])

  const closeFileSessionTab = useCallback(
    (fileSessionId: string) => {
      if (closingFileSessionIdSet.has(fileSessionId)) {
        return
      }
      cancelRecoveryForFileSession(fileSessionId)
      void onCloseFileSession(fileSessionId)
    },
    [cancelRecoveryForFileSession, closingFileSessionIdSet, onCloseFileSession],
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

  const connectQuickFileHost = useCallback(
    async (hostId: string) => {
      setQuickConnectOpen(false)
      setQuickConnectQuery('')
      await onOpenFileSession(hostId)
    },
    [onOpenFileSession],
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

  const requireConnectedFileSession = (fileSessionId: string) => {
    const fileSession = fileSessionsRef.current.find((session) => session.id === fileSessionId)
    if (
      fileSession?.status === 'connected'
      && !closingFileSessionIdsRef.current.has(fileSessionId)
    ) {
      return
    }
    const connectionError = new Error(t('files.connectionRequired'))
    notifyError(connectionError)
    throw connectionError
  }

  const publishFileSessionRecoveryState = useCallback(() => {
    setFileSessionRecoveryAttempts(new Map(fileSessionRecoveryAttemptsRef.current))
  }, [])

  const adoptDirectoryStateForRecoveredSession = useCallback((
    originalSessionId: string,
    recovered: FileSession,
  ) => {
    adoptWorkspaceSession(
      originalSessionId,
      recovered.id,
      recovered.current_path || '/',
    )
  }, [adoptWorkspaceSession])

  const notifyFileSessionRecoveryFailure = useCallback((
    sourceSessionId: string,
    errorCode: string,
  ) => {
    notification.error({
      key: `files-session-recovery-${sourceSessionId}`,
      title: t('workbench.files.recoveryFailed'),
      description: fileSessionRecoveryErrorMessage(errorCode, t),
      duration: 4,
      role: 'alert',
      className: 'termous-notification',
    })
  }, [notification, t])

  const recoverFileSession = useCallback(async (session: FileSession) => {
    if (findFileSessionRecoveryAttempt(fileSessionRecoveryAttemptsRef.current, session.id)) {
      return
    }
    const attempt: FileSessionRecoveryAttempt = {
      originalSessionId: session.id,
      targetSessionId: session.id,
      phase: 'requesting',
    }
    notification.destroy(`files-session-recovery-${session.id}`)
    fileSessionRecoveryAttemptsRef.current.set(session.id, attempt)
    publishFileSessionRecoveryState()
    try {
      let recovered: FileSession
      const createReplacement = fileSessionRecoveryRequestMethod(session) === 'create'
      if (!createReplacement) {
        try {
          recovered = await onReconnectFileSession(session.id)
        } catch (error) {
          if (!shouldCreateFileSessionAfterReconnect(error)) {
            throw error
          }
          recovered = await onConnectFileSession(
            session.host_id,
            session.source_session_id ?? '',
            normalizeRemotePath(currentPath || session.current_path || '/'),
            session.id,
          )
        }
      } else {
        recovered = await onConnectFileSession(
          session.host_id,
          session.source_session_id ?? '',
          normalizeRemotePath(currentPath || session.current_path || '/'),
          session.id,
        )
      }
      adoptDirectoryStateForRecoveredSession(session.id, recovered)
      attempt.targetSessionId = recovered.id
      attempt.phase = 'waiting_ready'
      attempt.connectionGeneration = recovered.connection_generation
      fileSessionRecoveryAttemptsRef.current.set(attempt.originalSessionId, attempt)
      publishFileSessionRecoveryState()
    } catch (error) {
      fileSessionRecoveryAttemptsRef.current.delete(attempt.originalSessionId)
      publishFileSessionRecoveryState()
      if (isFileSessionRecoverySupersededError(error)) {
        return
      }
      notifyFileSessionRecoveryFailure(
        attempt.originalSessionId,
        fileSessionRecoveryErrorCode(error),
      )
    }
  }, [
    adoptDirectoryStateForRecoveredSession,
    currentPath,
    notifyFileSessionRecoveryFailure,
    notification,
    onConnectFileSession,
    onReconnectFileSession,
    publishFileSessionRecoveryState,
  ])

  useEffect(() => {
    let changed = false
    const failures: Array<{ sourceSessionId: string; errorCode: string }> = []
    for (const [originalSessionId, attempt] of fileSessionRecoveryAttemptsRef.current) {
      const session = data.fileSessions.find((item) => item.id === attempt.targetSessionId)
      const outcome = fileSessionRecoveryOutcome(attempt, session)
      if (outcome === 'pending') {
        continue
      }
      fileSessionRecoveryAttemptsRef.current.delete(originalSessionId)
      changed = true
      if (outcome === 'failed') {
        failures.push({
          sourceSessionId: originalSessionId,
          errorCode: session?.error_code || 'SFTP_RECONNECT_FAILED',
        })
      } else {
        notification.destroy(`files-session-recovery-${originalSessionId}`)
      }
    }
    if (changed) {
      publishFileSessionRecoveryState()
    }
    failures.forEach(({ sourceSessionId, errorCode }) => {
      notifyFileSessionRecoveryFailure(sourceSessionId, errorCode)
    })
  }, [
    data.fileSessions,
    fileSessionRecoveryAttempts,
    notifyFileSessionRecoveryFailure,
    notification,
    publishFileSessionRecoveryState,
  ])

  const uploadLocalPaths = async (source: LocalGrantSource, paths: string[], targetPath = currentPath) => {
    if (!activeFileSessionId || !fileSessionConnected || paths.length === 0) {
      return
    }
    await runFileAction(async () => {
      const pendingId = startPendingTransferOperation({
        hostId: activeFileSession?.host_id ?? '',
        fileSessionId: activeFileSessionId,
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
        removePendingTransferOperation(pendingId)
      } catch (actionError) {
        failPendingTransferOperation(pendingId, t('files.fileOperationTransferFailed'))
        throw actionError
      }
    }, t('files.transferCreated'))
  }

  const downloadPathsToLocalDir = async (paths: string[], localDir: string) => {
    if (!activeFileSessionId || !fileSessionConnected || paths.length === 0) {
      return false
    }
    let created = false
    await runFileAction(async () => {
      const pendingId = startPendingTransferOperation({
        hostId: activeFileSession?.host_id ?? '',
        fileSessionId: activeFileSessionId,
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
        removePendingTransferOperation(pendingId)
        created = true
      } catch (actionError) {
        failPendingTransferOperation(pendingId, t('files.fileOperationTransferFailed'))
        throw actionError
      }
    }, t('files.transferCreated'))
    return created
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

  const confirmMappedDownload = async (localDir: string) => {
    const request = downloadDestinationRequest
    if (
      !request
      || !activeFileSession
      || !fileSessionConnected
      || request.fileSessionId !== activeFileSession.id
      || request.hostId !== activeFileSession.host_id
    ) {
      return false
    }
    return downloadPathsToLocalDir(request.paths, localDir)
  }

  const manageLocalDownloadDestinations = () => {
    setDownloadDestinationRequest(null)
    setLocationTab('local')
    setLocationsOpen(true)
    if (window.innerWidth < 1280) {
      setInspectorOpen(false)
    }
  }

  const moveRemotePathsToDirectory = async (paths: string[], targetPath: string) => {
    if (!activeFileSession || !fileSessionConnected || paths.length === 0) {
      return
    }
    await runFileAction(async () => {
      await api.moveFileSessionFiles(activeFileSession.id, paths, targetPath, 'rename')
      await loadDirectory(currentPath, { kind: 'refresh' })
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
      await loadDirectory(currentPath, { kind: 'refresh' })
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
        requireConnectedFileSession(activeFileSessionId)
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        const target = joinPath(currentPath, cleanName)
        if (!activeFileSessionId) {
          return
        }
        await api.mkdirFileSessionFile(activeFileSessionId, target)
        await loadDirectory(currentPath, { kind: 'refresh' })
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
        requireConnectedFileSession(activeFileSessionId)
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        if (!activeFileSessionId) {
          return
        }
        await api.renameFileSessionFile(activeFileSessionId, entry.path, joinPath(parentPath(entry.path), cleanName))
        await loadDirectory(currentPath, { kind: 'refresh' })
      },
    })
  }

  const openPermissions = (entry = selectedEntries[0]) => {
    if (!entry || !fileSessionConnected || !activeFileSessionId) {
      return
    }
    setPermissionTarget({ fileSessionId: activeFileSessionId, entry })
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
      setTextEditorTarget(null)
      setImageViewerTarget({
        fileSessionId: activeFileSessionId,
        path: entry.path,
      })
      return
    }
    setImageViewerTarget(null)
    setTextEditorTarget({
      fileSessionId: activeFileSessionId,
      path: entry.path,
    })
  }

  const handleTextFileSaved = (fileSessionId: string, entry: RemoteFileEntry) => {
    updateExistingWorkspaceSession(fileSessionId, (current) => ({
      ...current,
      listing: current.listing
        ? {
            ...current.listing,
            entries: current.listing.entries.map((item) => (
              item.path === entry.path ? entry : item
            )),
          }
        : null,
      focusedPath: entry.path,
      selectedPaths: [entry.path],
      anchorPath: entry.path,
    }))
  }

  const applyPermissions = async (
    fileSessionId: string,
    entry: RemoteFileEntry,
    mode: string,
  ) => {
    try {
      requireConnectedFileSession(fileSessionId)
    } catch {
      setPermissionTarget(null)
      return
    }
    setPermissionSaving(true)
    try {
      const updated = await api.chmodFileSessionFile(fileSessionId, entry.path, mode)
      updateExistingWorkspaceSession(fileSessionId, (current) => ({
        ...current,
        listing: current.listing
          ? {
              ...current.listing,
              entries: current.listing.entries.map((item) => (
                item.path === updated.path ? updated : item
              )),
            }
          : null,
        focusedPath: updated.path,
        selectedPaths: [updated.path],
        anchorPath: updated.path,
      }))
      setPermissionTarget((current) => (
        current?.fileSessionId === fileSessionId ? null : current
      ))
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
        requireConnectedFileSession(activeFileSessionId)
        await api.deleteFileSessionFiles(activeFileSessionId, paths, true)
        await loadDirectory(currentPath, { kind: 'refresh' })
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
      return
    }
    openFileEntry(entry)
  }

  const handleFilePageMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 3) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const target = getFilesWorkspaceHistoryTarget(workspaceViewState, 'back')
    if (!target) {
      return
    }
    void loadDirectory(target.path, {
      historyMode: 'traverse',
      historyIndex: target.historyIndex,
    })
  }

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files')

  const hasRemoteDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes(remoteFileDragMime)

  const findDirectoryDropTargetPath = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return null
    }
    const row = target.closest<HTMLElement>('.files-table-row.is-directory[data-row-key]')
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
    const scrollContainer = shell?.querySelector<HTMLElement>(
      '.ant-table-tbody-virtual-holder, .ant-table-body',
    )
    const speed = autoScrollSpeedRef.current
    if (!scrollContainer || speed === 0) {
      autoScrollFrameRef.current = null
      return
    }
    const previousScrollTop = scrollContainer.scrollTop
    scrollContainer.scrollTop += speed
    if (scrollContainer.scrollTop === previousScrollTop) {
      stopFileDragAutoScroll()
      return
    }
    // 虚拟列表滚动后原 DOM 行可能已复用，等待下一次 dragover 重新确认真实落点。
    setDropTargetDirectoryPath(null)
    setRemoteMoveTargetPath(null)
    autoScrollFrameRef.current = window.requestAnimationFrame(runFileDragAutoScroll)
  }

  const updateFileDragAutoScroll = (event: DragEvent<HTMLElement>) => {
    const shell = filesTableShellRef.current
    if (!shell) {
      return
    }
    const scrollContainer = shell.querySelector<HTMLElement>(
      '.ant-table-tbody-virtual-holder, .ant-table-body',
    )
    if (!scrollContainer) {
      return
    }
    const rect = scrollContainer.getBoundingClientRect()
    const edge = Math.min(fileDragAutoScrollEdge, Math.max(36, rect.height * 0.18))
    const topDistance = event.clientY - rect.top
    const bottomDistance = rect.bottom - event.clientY
    let speed = 0
    if (topDistance >= 0 && topDistance < edge) {
      speed = -Math.max(4, Math.round(((edge - topDistance) / edge) * fileDragAutoScrollMaxSpeed))
    } else if (bottomDistance >= 0 && bottomDistance < edge) {
      speed = Math.max(4, Math.round(((edge - bottomDistance) / edge) * fileDragAutoScrollMaxSpeed))
    }
    const atTop = scrollContainer.scrollTop <= 0
    const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 1
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
    remoteDragPreviewRef.current?.remove()
    remoteDragPreviewRef.current = null
    stopFileDragAutoScroll()
  }
  resetDragStateRef.current = resetDragState

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
    if (!fileSessionConnected) {
      event.dataTransfer.dropEffect = 'none'
      resetDragState()
      return
    }
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
    setDragActive(fileSessionConnected)
    setDropTargetDirectoryPath(fileSessionConnected ? findDirectoryDropTargetPath(event.target) : null)
    if (fileSessionConnected) {
      updateFileDragAutoScroll(event)
    } else {
      stopFileDragAutoScroll()
    }
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
    if (event.relatedTarget === null) {
      resetDragState()
      return
    }
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
    if (!shouldUpload || !fileSessionConnected) {
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
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(remoteFileDragMime, JSON.stringify(paths))
    remoteDragPreviewRef.current?.remove()
    const preview = document.createElement('div')
    preview.className = 'files-remote-drag-preview'
    const icon = event.currentTarget.querySelector<HTMLElement>('.file-kind-icon')?.cloneNode(true)
    if (icon instanceof HTMLElement) {
      preview.append(icon)
    }
    const label = document.createElement('span')
    label.className = 'files-remote-drag-preview-label'
    label.textContent = entry.name
    preview.append(label)
    if (paths.length > 1) {
      const count = document.createElement('span')
      count.className = 'files-remote-drag-preview-count'
      count.textContent = String(paths.length)
      preview.append(count)
    }
    document.body.append(preview)
    remoteDragPreviewRef.current = preview
    event.dataTransfer.setDragImage(preview, 20, 18)
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
  const navigationDisabled = !fileSessionConnected || (
    workspaceViewState.directoryStatus === 'initial_loading'
    && !workspaceViewState.listing
  )
  useEffect(() => {
    if (!fileSessionConnected) {
      setPermissionTarget(null)
    }
  }, [fileSessionConnected])

  useEffect(() => {
    if (
      downloadDestinationRequest
      && (
        !activeFileSession
        || !fileSessionConnected
        || downloadDestinationRequest.fileSessionId !== activeFileSession.id
        || downloadDestinationRequest.hostId !== activeFileSession.host_id
      )
    ) {
      setDownloadDestinationRequest(null)
    }
  }, [activeFileSession, downloadDestinationRequest, fileSessionConnected])

  useEffect(() => {
    if (!activeFileSessionClosing) {
      return
    }
    setFileContextMenu(null)
    setImageViewerTarget(null)
    setPermissionTarget(null)
    resetDragStateRef.current()
  }, [activeFileSessionClosing])

  const orderedEntryPaths = useMemo(
    () => entries.map((entry) => entry.path),
    [entries],
  )
  const selectEntry = useCallback((
    entry: RemoteFileEntry,
    modifiers: {
      ctrlKey?: boolean
      metaKey?: boolean
      shiftKey?: boolean
      contextMenu?: boolean
    } = {},
  ) => {
    updateActiveWorkspaceView((current) => applyFilesWorkspaceSelection(
      current,
      orderedEntryPaths,
      entry.path,
      modifiers,
    ))
  }, [orderedEntryPaths, updateActiveWorkspaceView])
  const focusEntry = useCallback((entry: RemoteFileEntry) => {
    updateActiveWorkspaceView((current) => ({
      ...current,
      focusedPath: entry.path,
    }))
  }, [updateActiveWorkspaceView])

  const rowMenu = (entry: RemoteFileEntry): MenuProps['items'] => {
    const items = buildRemoteFileActionMenu(entry, t) ?? []
    return items.flatMap((item) => {
      if (!item || !('key' in item) || item.key !== 'download') {
        return [item]
      }
      return [
        item,
        {
          key: 'download-to',
          className: 'files-download-destination-menu-item',
          icon: <FolderDown size={14} aria-hidden="true" />,
          label: t('files.downloadTo'),
        },
      ]
    })
  }
  const runRowMenuAction = (entry: RemoteFileEntry, key: string) => {
    setFileContextMenu(null)
    if (!fileSessionConnected) {
      return
    }
    const actionPaths = selectedPaths.includes(entry.path)
      ? selectedPaths
      : [entry.path]
    if (!selectedPaths.includes(entry.path)) {
      selectEntry(entry, { contextMenu: true })
    }
    if (key === 'download-to') {
      if (activeFileSession) {
        setDownloadDestinationRequest({
          fileSessionId: activeFileSession.id,
          hostId: activeFileSession.host_id,
          paths: [...actionPaths],
        })
      }
      return
    }
    const handlers: RemoteFileActionHandlers = {
      openFile: openFileEntry,
      download: () => void downloadPaths(actionPaths),
      copy: () => {
        if (activeFileSession) {
          setRemoteClipboard({ mode: 'copy', hostId: activeFileSession.host_id, paths: actionPaths })
        }
      },
      cut: () => {
        if (activeFileSession) {
          setRemoteClipboard({ mode: 'cut', hostId: activeFileSession.host_id, paths: actionPaths })
        }
      },
      permissions: openPermissions,
      rename: openRename,
      delete: () => confirmDelete(actionPaths),
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
  const fileRowMenuPropsRef = useRef(fileRowMenuProps)
  fileRowMenuPropsRef.current = fileRowMenuProps

  const beginFileColumnResize = (key: FileColumnKey, event: MouseEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    fileResizeCleanupRef.current?.()

    const startX = event.clientX
    const startWidth = fileColumnWidths[key]
    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = Math.min(
        maxFileColumnWidths[key],
        Math.max(minFileColumnWidths[key], Math.round(startWidth + moveEvent.clientX - startX)),
      )
      setFileColumnWidths((current) => current[key] === nextWidth ? current : { ...current, [key]: nextWidth })
    }
    const cleanup = () => {
      document.body.classList.remove('is-files-column-resizing')
      delete document.body.dataset.filesResizeKey
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', cleanup)
      window.removeEventListener('blur', cleanup)
      fileResizeCleanupRef.current = null
    }

    document.body.classList.add('is-files-column-resizing')
    document.body.dataset.filesResizeKey = key
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', cleanup, { once: true })
    window.addEventListener('blur', cleanup, { once: true })
    fileResizeCleanupRef.current = cleanup
  }

  const resizeFileColumnWithKeyboard = (
    key: FileColumnKey,
    event: KeyboardEvent<HTMLSpanElement>,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const delta = (event.shiftKey ? 48 : 16) * (event.key === 'ArrowLeft' ? -1 : 1)
    setFileColumnWidths((current) => ({
      ...current,
      [key]: Math.min(
        maxFileColumnWidths[key],
        Math.max(minFileColumnWidths[key], current[key] + delta),
      ),
    }))
  }
  const beginFileColumnResizeRef = useRef(beginFileColumnResize)
  const resizeFileColumnWithKeyboardRef = useRef(resizeFileColumnWithKeyboard)
  beginFileColumnResizeRef.current = beginFileColumnResize
  resizeFileColumnWithKeyboardRef.current = resizeFileColumnWithKeyboard

  const columns = useMemo<TableColumnsType<RemoteFileEntry>>(() => {
    const resizableHeader = (key: FileColumnKey) => ({
      resizeKey: key,
      resizeLabel: t('files.resizeColumn'),
      resizeValue: fileColumnWidths[key],
      resizeMinimum: minFileColumnWidths[key],
      resizeMaximum: maxFileColumnWidths[key],
      onResizeStart: (
        resizeKey: FileColumnKey,
        event: MouseEvent<HTMLSpanElement>,
      ) => beginFileColumnResizeRef.current(resizeKey, event),
      onResizeKeyDown: (
        resizeKey: FileColumnKey,
        event: KeyboardEvent<HTMLSpanElement>,
      ) => resizeFileColumnWithKeyboardRef.current(resizeKey, event),
    }) as ResizableFileHeaderCellProps
    const sortOrder = (key: FilesWorkspaceSortKey) => (
      workspaceViewState.sortState.key === key && workspaceViewState.sortState.direction
        ? workspaceViewState.sortState.direction === 'ascending'
          ? 'ascend'
          : 'descend'
        : null
    )

    return [
      {
        title: t('files.name'),
        dataIndex: 'name',
        width: fileColumnWidths.name,
        onHeaderCell: () => resizableHeader('name'),
        sorter: true,
        sortDirections: ['ascend', 'descend'],
        sortOrder: sortOrder('name'),
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
              <Tooltip title={fullName} placement="topLeft" mouseEnterDelay={0.35} classNames={{ root: 'file-name-tooltip' }}>
                <span className="file-name-copy">{nameCopy}</span>
              </Tooltip>
            </span>
          )
        },
      },
      {
        title: t('files.size'),
        dataIndex: 'size',
        width: fileColumnWidths.size,
        onHeaderCell: () => resizableHeader('size'),
        sorter: true,
        sortDirections: ['ascend', 'descend'],
        sortOrder: sortOrder('size'),
        responsive: ['md'],
        render: (value: number, entry: RemoteFileEntry) => entry.kind === 'directory' ? '-' : formatBytes(value),
      },
      {
        title: t('files.modified'),
        dataIndex: 'modified_at',
        width: fileColumnWidths.modified,
        onHeaderCell: () => resizableHeader('modified'),
        sorter: true,
        sortDirections: ['ascend', 'descend'],
        sortOrder: sortOrder('modifiedAt'),
        responsive: ['lg'],
        render: (value: string) => formatDate(value),
      },
      {
        title: t('files.permissions'),
        dataIndex: 'permissions',
        width: fileColumnWidths.permissions,
        onHeaderCell: () => resizableHeader('permissions'),
        responsive: ['xl'],
        render: (value: string, entry: RemoteFileEntry) => entry.permission_octal || value || '-',
      },
      {
        key: 'spacer',
        title: '',
        className: 'files-table-spacer-cell',
        render: () => null,
      },
      {
        title: '',
        width: 40,
        className: 'files-table-actions-cell',
        render: (_: unknown, entry: RemoteFileEntry) => (
          <Dropdown
            disabled={!fileSessionConnected}
            menu={fileRowMenuPropsRef.current(entry)}
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
  }, [
    fileColumnWidths,
    fileSessionConnected,
    t,
    workspaceViewState.sortState.direction,
    workspaceViewState.sortState.key,
  ])

  const handleTableChange: TableProps<RemoteFileEntry>['onChange'] = (
    _pagination,
    _filters,
    sorter,
  ) => {
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter
    const key = activeSorter?.field === 'size'
      ? 'size'
      : activeSorter?.field === 'modified_at'
        ? 'modifiedAt'
        : 'name'
    updateActiveWorkspaceView((current) => setFilesWorkspaceSortState(
      current,
      resolveFilesWorkspaceSortState(key, activeSorter?.order),
    ))
  }

  const findFileRow = useCallback((path: string) => (
    Array.from(
      filesTableShellRef.current?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [],
    ).find((row) => row.dataset.rowKey === path)
  ), [])

  const focusFileRow = useCallback((path: string, index: number) => {
    fileTableRef.current?.scrollTo({ key: path, index })
    let attemptsRemaining = 3
    const focusRenderedRow = () => {
      const row = findFileRow(path)
      if (row) {
        row.scrollIntoView({ block: 'nearest' })
        row.focus({ preventScroll: true })
        return
      }
      attemptsRemaining -= 1
      if (attemptsRemaining > 0) {
        window.requestAnimationFrame(focusRenderedRow)
      }
    }
    window.requestAnimationFrame(focusRenderedRow)
  }, [findFileRow])

  const handleFileTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!fileSessionConnected || entries.length === 0) {
      return
    }
    const target = event.target
    if (
      target instanceof Element
      && target.closest(
        'button, input, textarea, select, a, .ant-table-thead, [contenteditable="true"], [role="checkbox"], [role="columnheader"], [role="menuitem"], [role="separator"]',
      )
    ) {
      return
    }
    const focusedIndex = entries.findIndex((entry) => entry.path === workspaceViewState.focusedPath)
    const activeIndex = focusedIndex >= 0 ? focusedIndex : 0
    let nextIndex: number | null = null
    if (event.key === 'ArrowUp') {
      nextIndex = focusedIndex < 0 ? 0 : Math.max(0, activeIndex - 1)
    } else if (event.key === 'ArrowDown') {
      nextIndex = focusedIndex < 0 ? 0 : Math.min(entries.length - 1, activeIndex + 1)
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = entries.length - 1
    } else if (event.key === 'PageUp') {
      nextIndex = Math.max(0, activeIndex - 10)
    } else if (event.key === 'PageDown') {
      nextIndex = Math.min(entries.length - 1, activeIndex + 10)
    }
    if (nextIndex !== null) {
      event.preventDefault()
      const entry = entries[nextIndex]
      if (!entry) {
        return
      }
      if (event.shiftKey) {
        selectEntry(entry, { shiftKey: true })
      } else {
        focusEntry(entry)
      }
      focusFileRow(entry.path, nextIndex)
      return
    }

    const entry = entries[activeIndex]
    if (!entry) {
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      updateActiveWorkspaceView((current) => ({
        ...current,
        focusedPath: entry.path,
        selectedPaths: orderedEntryPaths,
        anchorPath: orderedEntryPaths[0] ?? null,
      }))
    } else if (event.key === ' ') {
      event.preventDefault()
      selectEntry(entry, { ctrlKey: true })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      enterEntry(entry)
    } else if (event.key === 'F2') {
      event.preventDefault()
      openRename(entry)
    } else if (event.key === 'Delete') {
      event.preventDefault()
      confirmDelete(selectedPaths.includes(entry.path) ? selectedPaths : [entry.path])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      updateActiveWorkspaceView(clearFilesWorkspaceSelection)
      setFileContextMenu(null)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const row = findFileRow(entry.path)
      const rect = row?.getBoundingClientRect()
      selectEntry(entry, { contextMenu: true })
      setFileContextMenu({
        fileSessionId: activeFileSessionId,
        entry,
        x: rect?.left ?? event.currentTarget.getBoundingClientRect().left,
        y: rect?.bottom ?? event.currentTarget.getBoundingClientRect().top,
      })
    }
  }

  const updateBreadcrumbScrollState = useCallback((preserveEnd = false) => {
    const viewport = breadcrumbViewportRef.current
    if (!viewport) {
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
      current.canScrollLeft === next.canScrollLeft
      && current.canScrollRight === next.canScrollRight
        ? current
        : next
    ))
  }, [])

  const scrollBreadcrumb = useCallback((direction: 'left' | 'right') => {
    const viewport = breadcrumbViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollBy({
      left: direction === 'left' ? -Math.max(160, viewport.clientWidth * 0.62) : Math.max(160, viewport.clientWidth * 0.62),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [])

  const handleBreadcrumbWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const viewport = breadcrumbViewportRef.current
    if (!viewport) {
      return
    }
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (maxScrollLeft <= 1) {
      return
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) {
      return
    }
    const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, viewport.scrollLeft + delta))
    if (Math.abs(nextScrollLeft - viewport.scrollLeft) <= 1) {
      return
    }
    event.preventDefault()
    viewport.scrollLeft = nextScrollLeft
    updateBreadcrumbScrollState()
  }, [updateBreadcrumbScrollState])

  useEffect(() => {
    const viewport = breadcrumbViewportRef.current
    if (!viewport || editingPath) {
      return undefined
    }
    breadcrumbPinnedToEndRef.current = true
    viewport.scrollLeft = viewport.scrollWidth
    updateBreadcrumbScrollState()
    const observer = new ResizeObserver(() => updateBreadcrumbScrollState(true))
    observer.observe(viewport)
    const breadcrumbList = viewport.querySelector<HTMLElement>('.ant-breadcrumb-ol')
    if (breadcrumbList) {
      observer.observe(breadcrumbList)
    }
    return () => observer.disconnect()
  }, [displayedPath, editingPath, updateBreadcrumbScrollState])

  useEffect(() => {
    const shell = filesTableShellRef.current
    if (!shell) {
      return undefined
    }
    const syncHeight = () => setTableViewportHeight(Math.max(160, shell.clientHeight - 38))
    const observer = new ResizeObserver(syncHeight)
    observer.observe(shell)
    syncHeight()
    return () => observer.disconnect()
  }, [activeFileSessionId, inspectorOpen, transfersOpen])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = filesTableShellRef.current?.querySelector<HTMLElement>(
        '.ant-table-body, .ant-table-tbody-virtual-holder',
      )
      if (scrollContainer && Math.abs(scrollContainer.scrollTop - workspaceScrollTopRef.current) > 1) {
        scrollContainer.scrollTop = workspaceScrollTopRef.current
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeFileSessionId, tableViewportHeight, workspaceViewState.listing])

  useEffect(() => {
    const scrollContainer = filesTableShellRef.current?.querySelector<HTMLElement>(
      '.ant-table-tbody-virtual-holder, .ant-table-body',
    )
    if (!scrollContainer) {
      return undefined
    }
    let commitTimer: number | undefined
    let pendingScrollTop: number | null = null
    const commitScrollTop = () => {
      commitTimer = undefined
      if (pendingScrollTop === null) {
        return
      }
      const scrollTop = pendingScrollTop
      pendingScrollTop = null
      updateActiveWorkspaceView((current) => setFilesWorkspaceScrollTop(
        current,
        scrollTop,
      ))
    }
    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop
      workspaceScrollTopRef.current = scrollTop
      pendingScrollTop = scrollTop
      if (commitTimer !== undefined) {
        window.clearTimeout(commitTimer)
      }
      // 连续滚动期间只更新轻量引用，停顿后再提交会话缓存，避免表格逐像素重渲染。
      commitTimer = window.setTimeout(commitScrollTop, 100)
    }
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      if (commitTimer !== undefined) {
        window.clearTimeout(commitTimer)
      }
      commitScrollTop()
    }
  }, [activeFileSessionId, updateActiveWorkspaceView, workspaceViewState.listing])

  const startPanelResize = (
    event: PointerEvent<HTMLDivElement>,
    mode: 'inspector' | 'transfers',
  ) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    panelResizeCleanupRef.current?.()
    const startPosition = mode === 'inspector' ? event.clientX : event.clientY
    const startValue = mode === 'inspector'
      ? layoutPreferences.inspectorWidth
      : layoutPreferences.transferDockHeight
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = mode === 'inspector'
        ? startPosition - moveEvent.clientX
        : startPosition - moveEvent.clientY
      const minimum = mode === 'inspector' ? 280 : 180
      const maximum = mode === 'inspector' ? 440 : 420
      const next = Math.max(minimum, Math.min(maximum, Math.round(startValue + delta)))
      setLayoutPreferences((current) => mode === 'inspector'
        ? { ...current, inspectorWidth: next }
        : { ...current, transferDockHeight: next })
    }
    const cleanup = () => {
      document.body.classList.remove('is-panel-resizing')
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      panelResizeCleanupRef.current = null
    }
    document.body.classList.add('is-panel-resizing')
    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', cleanup, { once: true })
    window.addEventListener('pointercancel', cleanup, { once: true })
    panelResizeCleanupRef.current = cleanup
  }

  const resizePanelWithKeyboard = (
    event: KeyboardEvent<HTMLDivElement>,
    mode: 'inspector' | 'transfers',
  ) => {
    const direction = mode === 'inspector'
      ? event.key === 'ArrowLeft'
        ? 1
        : event.key === 'ArrowRight'
          ? -1
          : 0
      : event.key === 'ArrowUp'
        ? 1
        : event.key === 'ArrowDown'
          ? -1
          : 0
    if (direction === 0) {
      return
    }
    event.preventDefault()
    const step = event.shiftKey ? 24 : 8
    const minimum = mode === 'inspector' ? 280 : 180
    const maximum = mode === 'inspector' ? 440 : 420
    setLayoutPreferences((current) => {
      const value = mode === 'inspector'
        ? current.inspectorWidth
        : current.transferDockHeight
      const next = Math.max(minimum, Math.min(maximum, value + direction * step))
      return mode === 'inspector'
        ? { ...current, inspectorWidth: next }
        : { ...current, transferDockHeight: next }
    })
  }

  const navigateHistory = (direction: 'back' | 'forward') => {
    const target = getFilesWorkspaceHistoryTarget(workspaceViewState, direction)
    if (!target) {
      return
    }
    void loadDirectory(target.path, {
      historyMode: 'traverse',
      historyIndex: target.historyIndex,
    })
  }

  const beginPathEdit = () => {
    setPathInput(displayedPath)
    setEditingPath(true)
    window.requestAnimationFrame(() => {
      pathInputRef.current?.focus()
      pathInputRef.current?.select()
    })
  }

  const cancelPathEdit = () => {
    setPathInput(currentPath)
    setEditingPath(false)
  }

  const submitPathEdit = () => {
    setEditingPath(false)
    void loadDirectory(pathInput)
  }

  const scopedTransfers = useMemo(
    () => transferScope === 'all'
      ? transfers
      : activeFileSessionId
        ? transfers.filter((task) => task.file_session_id === activeFileSessionId)
        : [],
    [activeFileSessionId, transferScope, transfers],
  )
  const scopedPendingOperations = useMemo(
    () => transferScope === 'all'
      ? pendingTransferOperations
      : activeFileSessionId
        ? pendingTransferOperations.filter((operation) => operation.fileSessionId === activeFileSessionId)
        : [],
    [activeFileSessionId, pendingTransferOperations, transferScope],
  )
  const activeTransfers = useMemo(
    () => transfers.filter(isTransferActive),
    [transfers],
  )
  const pendingRunningOperations = useMemo(
    () => pendingTransferOperations.filter((operation) => operation.status === 'running'),
    [pendingTransferOperations],
  )
  const activeTransferCount = activeTransfers.length + pendingRunningOperations.length
  const currentSessionActiveTransferCount = useMemo(() => {
    if (!activeFileSessionId) {
      return 0
    }
    return transfers.filter((task) => (
      task.file_session_id === activeFileSessionId && isTransferActive(task)
    )).length + pendingTransferOperations.filter((operation) => (
      operation.fileSessionId === activeFileSessionId && operation.status === 'running'
    )).length
  }, [activeFileSessionId, pendingTransferOperations, transfers])
  const activeTransferredBytes = activeTransfers.reduce(
    (total, task) => total + Math.max(0, task.transferred_bytes),
    0,
  )
  const activeTotalBytes = activeTransfers.reduce(
    (total, task) => total + Math.max(0, task.total_bytes),
    0,
  )
  const activeTransferSpeed = activeTransfers.reduce(
    (total, task) => total + Math.max(0, task.speed_bytes_per_sec || task.average_speed_bytes_per_sec),
    0,
  )
  const activeTransferProgress = activeTotalBytes > 0
    ? Math.min(100, Math.max(0, (activeTransferredBytes / activeTotalBytes) * 100))
    : activeTransfers.length > 0
      ? 0
      : 100
  const backTarget = getFilesWorkspaceHistoryTarget(workspaceViewState, 'back')
  const forwardTarget = getFilesWorkspaceHistoryTarget(workspaceViewState, 'forward')
  const directoryNavigationBusy = workspaceViewState.directoryStatus === 'navigating'
    || workspaceViewState.directoryStatus === 'refreshing'
  const directoryHasInlineError = workspaceViewState.directoryStatus === 'failed'
    && Boolean(workspaceViewState.listing)
  const directoryStatusMessage = directoryNavigationBusy
    ? workspaceViewState.directoryStatus === 'navigating'
      ? t('files.loadingDirectory', { path: displayedPath })
      : t('files.refreshingDirectory')
    : directoryHasInlineError
      ? workspaceViewState.error || t('files.directoryReadFailed')
      : ''
  const connectionStatusKey = activeFileSessionClosing
    ? 'closing'
    : activeFileSession?.status ?? 'closed'
  const moreActions: MenuProps = {
    items: [
      {
        key: 'upload-folder',
        icon: <Folder size={14} aria-hidden="true" />,
        label: t('files.uploadFolder'),
        disabled: actionDisabled,
      },
    ],
    onClick: ({ key }) => {
      if (key === 'upload-folder') {
        void pickFolder()
      }
    },
  }
  const selectionMoreActions: MenuProps = {
    items: [
      {
        key: 'permissions',
        icon: <ShieldCheck size={14} aria-hidden="true" />,
        label: t('files.editPermissions'),
        disabled: !fileSessionConnected || selectedPaths.length !== 1,
      },
    ],
    onClick: ({ key }) => {
      if (key === 'permissions') {
        openPermissions()
      }
    },
  }

  const runTransferAction = async (
    id: string,
    action: () => Promise<void>,
    notifyActionError = true,
  ) => {
    if (!beginPendingTransferAction(id)) {
      return false
    }
    try {
      await action()
      return true
    } catch (actionError) {
      if (notifyActionError) {
        notifyError(actionError)
      }
      return false
    } finally {
      endPendingTransferAction(id)
    }
  }

  return (
    <section
      ref={filesPageRef}
      className={[
        'files-page',
        'files-workspace-page',
        inspectorOpen ? 'has-inspector' : '',
        transfersOpen ? 'has-transfer-dock' : '',
        locationsOpen ? 'has-locations' : '',
        dragActive ? 'is-dragging' : '',
        remoteMoveDrag ? 'is-moving' : '',
      ].filter(Boolean).join(' ')}
      style={filesPageStyle}
      onMouseDown={handleFilePageMouseDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={resetDragState}
      onDrop={(event) => void onDrop(event)}
    >
      <main className="files-main-panel">
        <div className="files-session-toolbar terminal-toolbar">
          <SessionTabStrip
            ariaLabel={t('files.sessions')}
            activeId={activeFileSessionId}
            contentKey={displayedFileSessionKey}
            scrollLeftLabel={t('workbench.scrollTabsLeft')}
            scrollRightLabel={t('workbench.scrollTabsRight')}
            tabsClassName="terminal-tabs"
            trailing={(
              <SessionQuickConnect
                hosts={data.hosts}
                triggerLabel={t('files.openFileSession')}
                open={quickConnectOpen}
                query={quickConnectQuery}
                onOpenChange={setQuickConnectOpen}
                onQueryChange={setQuickConnectQuery}
                onConnect={connectQuickFileHost}
                getHostIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
              />
            )}
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
                        startTransition(() => onSelectFileSession(fileSession.id))
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
        </div>

        <div className="files-location-bar" role="toolbar" aria-label={t('files.pathNavigation')}>
          <div className="files-navigation-cluster">
            <div className="files-history-actions">
              <Tooltip title={t('files.back')}>
                <Button
                  type="text"
                  className="files-navigation-button"
                  aria-label={t('files.back')}
                  disabled={navigationDisabled || !backTarget}
                  icon={<ArrowLeft size={15} aria-hidden="true" />}
                  onClick={() => navigateHistory('back')}
                />
              </Tooltip>
              <Tooltip title={t('files.forward')}>
                <Button
                  type="text"
                  className="files-navigation-button"
                  aria-label={t('files.forward')}
                  disabled={navigationDisabled || !forwardTarget}
                  icon={<ArrowRight size={15} aria-hidden="true" />}
                  onClick={() => navigateHistory('forward')}
                />
              </Tooltip>
            </div>
            <span className="files-navigation-divider" aria-hidden="true" />
            <Tooltip title={t('files.parent')}>
              <Button
                type="text"
                className="files-navigation-button"
                aria-label={t('files.parent')}
                disabled={navigationDisabled || displayedPath === '/'}
                icon={<ArrowUp size={15} aria-hidden="true" />}
                onClick={() => void loadDirectory(parentPath(displayedPath))}
              />
            </Tooltip>
          </div>

          <div
            className={[
              'files-path-control',
              editingPath ? 'is-editing' : '',
              directoryNavigationBusy ? 'is-busy' : '',
              directoryHasInlineError ? 'is-error' : '',
            ].filter(Boolean).join(' ')}
            aria-busy={directoryNavigationBusy}
          >
            {editingPath ? (
              <Input
                ref={pathInputRef}
                id="files-path-input"
                name="files-path-input"
                value={pathInput}
                disabled={!fileSessionConnected}
                aria-label={t('files.path')}
                onChange={(event) => setPathInput(event.target.value)}
                onBlur={cancelPathEdit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitPathEdit()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelPathEdit()
                  }
                }}
              />
            ) : (
              <div className={[
                'files-breadcrumb-shell',
                breadcrumbScrollState.canScrollLeft ? 'has-left-overflow' : '',
                breadcrumbScrollState.canScrollRight ? 'has-right-overflow' : '',
              ].filter(Boolean).join(' ')}>
                <span className="files-breadcrumb-scroll-slot is-left">
                  {breadcrumbScrollState.canScrollLeft ? (
                    <Tooltip title={t('files.scrollPathLeft')}>
                      <Button
                        type="text"
                        className="files-breadcrumb-scroll"
                        aria-label={t('files.scrollPathLeft')}
                        icon={<ArrowLeft size={13} aria-hidden="true" />}
                        onClick={() => scrollBreadcrumb('left')}
                      />
                    </Tooltip>
                  ) : null}
                </span>
                <div
                  ref={breadcrumbViewportRef}
                  className="files-breadcrumb-viewport"
                  onScroll={() => updateBreadcrumbScrollState()}
                  onWheel={handleBreadcrumbWheel}
                >
                  <PathTrail
                    path={displayedPath}
                    ariaLabel={t('files.pathNavigation')}
                    rootLabel={t('files.rootDirectory')}
                    dropTargetPath={remoteMoveTargetPath ?? dropTargetDirectoryPath}
                    disabled={navigationDisabled}
                    onNavigate={(path) => void loadDirectory(path)}
                    onDragOver={onBreadcrumbDragOver}
                    onDragLeave={onBreadcrumbDragLeave}
                    onDrop={onBreadcrumbDrop}
                  />
                </div>
                <span className="files-breadcrumb-scroll-slot is-right">
                  {breadcrumbScrollState.canScrollRight ? (
                    <Tooltip title={t('files.scrollPathRight')}>
                      <Button
                        type="text"
                        className="files-breadcrumb-scroll"
                        aria-label={t('files.scrollPathRight')}
                        icon={<ArrowRight size={13} aria-hidden="true" />}
                        onClick={() => scrollBreadcrumb('right')}
                      />
                    </Tooltip>
                  ) : null}
                </span>
              </div>
            )}
            <div className="files-path-actions">
              {editingPath ? (
                <>
                  <Tooltip title={t('app.confirm')}>
                    <Button
                      type="text"
                      className="files-path-action is-confirm"
                      aria-label={t('app.confirm')}
                      disabled={!fileSessionConnected}
                      icon={<Check size={14} aria-hidden="true" />}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={submitPathEdit}
                    />
                  </Tooltip>
                  <Tooltip title={t('app.cancel')}>
                    <Button
                      type="text"
                      className="files-path-action"
                      aria-label={t('app.cancel')}
                      icon={<X size={14} aria-hidden="true" />}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={cancelPathEdit}
                    />
                  </Tooltip>
                </>
              ) : (
                <>
                  <Tooltip
                    title={directoryHasInlineError
                      ? `${directoryStatusMessage} · ${t('app.retry')}`
                      : t('app.reload')}
                  >
                    <Button
                      type="text"
                      className={`files-path-action ${directoryHasInlineError ? 'is-error' : ''}`}
                      aria-label={directoryHasInlineError ? t('app.retry') : t('app.reload')}
                      disabled={navigationDisabled}
                      icon={directoryHasInlineError
                        ? <XCircle size={14} aria-hidden="true" />
                        : (
                            <RefreshCw
                              className={directoryNavigationBusy ? 'is-spinning' : ''}
                              size={14}
                              aria-hidden="true"
                            />
                          )}
                      onClick={directoryHasInlineError
                        ? retryDirectoryRequest
                        : () => void loadDirectory(currentPath, { kind: 'refresh' })}
                    />
                  </Tooltip>
                  <Tooltip title={t('files.editPath')}>
                    <Button
                      type="text"
                      className="files-path-action"
                      aria-label={t('files.editPath')}
                      disabled={navigationDisabled}
                      icon={<Pencil size={14} aria-hidden="true" />}
                      onClick={beginPathEdit}
                    />
                  </Tooltip>
                </>
              )}
            </div>
            {directoryNavigationBusy ? <span className="files-path-progress" aria-hidden="true" /> : null}
            {directoryStatusMessage ? (
              <span
                className="files-directory-live-status"
                role={directoryHasInlineError ? 'alert' : 'status'}
                aria-live={directoryHasInlineError ? 'assertive' : 'polite'}
              >
                {directoryStatusMessage}
              </span>
            ) : null}
          </div>
        </div>

        <div className={`files-command-bar ${selectedPaths.length > 0 ? 'has-selection' : ''}`}>
          <div className="files-command-primary">
            {selectedPaths.length > 0 ? (
              <>
                <span className="files-selection-summary">
                  {t('files.selectedCount', { count: selectedPaths.length })}
                </span>
                <Button
                  type="text"
                  className="files-command-button"
                  disabled={!fileSessionConnected}
                  icon={<Copy size={15} aria-hidden="true" />}
                  onClick={() => copySelected('copy')}
                >
                  {t('files.copy')}
                </Button>
                <Button
                  type="text"
                  className="files-command-button"
                  disabled={!fileSessionConnected}
                  icon={<Scissors size={15} aria-hidden="true" />}
                  onClick={() => copySelected('cut')}
                >
                  {t('files.cut')}
                </Button>
                <Button
                  type="text"
                  className="files-command-button"
                  disabled={!fileSessionConnected || selectedPaths.length !== 1}
                  icon={<Pencil size={15} aria-hidden="true" />}
                  onClick={() => openRename()}
                >
                  {t('files.rename')}
                </Button>
                <Button
                  type="text"
                  className="files-command-button is-low-priority"
                  disabled={!fileSessionConnected || selectedPaths.length !== 1}
                  icon={<ShieldCheck size={15} aria-hidden="true" />}
                  onClick={() => openPermissions()}
                >
                  {t('files.editPermissions')}
                </Button>
                <Dropdown menu={selectionMoreActions} trigger={['click']} classNames={{ root: 'files-row-menu' }}>
                  <Button
                    type="text"
                    className="files-chrome-button files-selection-more"
                    aria-label={t('files.actions')}
                    icon={<MoreHorizontal size={16} aria-hidden="true" />}
                  />
                </Dropdown>
              </>
            ) : (
              <>
                <Button
                  type="primary"
                  className="files-upload-button"
                  disabled={actionDisabled}
                  icon={<Upload size={16} aria-hidden="true" />}
                  onClick={() => void pickFiles()}
                >
                  {t('files.uploadFiles')}
                </Button>
                <Button
                  type="text"
                  className="files-command-button"
                  disabled={actionDisabled}
                  icon={<FolderPlus size={15} aria-hidden="true" />}
                  onClick={openCreateDirectory}
                >
                  {t('files.newFolder')}
                </Button>
                <Button
                  type="text"
                  className="files-command-button is-low-priority"
                  disabled={actionDisabled}
                  icon={<Clipboard size={15} aria-hidden="true" />}
                  onClick={() => void pasteFromClipboard()}
                >
                  {t('files.paste')}
                </Button>
                <Dropdown menu={moreActions} trigger={['click']} classNames={{ root: 'files-row-menu' }}>
                  <Button
                    type="text"
                    className="files-chrome-button"
                    aria-label={t('files.actions')}
                    icon={<MoreHorizontal size={16} aria-hidden="true" />}
                  />
                </Dropdown>
              </>
            )}
          </div>
          <div className="files-command-secondary">
            {selectedPaths.length > 0 ? (
              <>
                <Button
                  type="text"
                  danger
                  className="files-command-button files-delete-command"
                  disabled={!fileSessionConnected}
                  icon={<Trash2 size={15} aria-hidden="true" />}
                  onClick={() => confirmDelete()}
                >
                  {t('app.delete')}
                </Button>
                <span className="files-command-divider" aria-hidden="true" />
              </>
            ) : null}
            <div className="files-view-actions" role="group" aria-label={t('files.workspacePanels')}>
              <Tooltip title={t('files.locations')}>
                <Button
                  ref={locationsToggleRef}
                  type="text"
                  className={`files-workspace-toggle ${locationsOpen ? 'is-active' : ''}`}
                  aria-label={t('files.locations')}
                  aria-pressed={locationsOpen}
                  aria-controls={locationsOpen ? 'files-locations-drawer' : undefined}
                  icon={<ListTree size={15} aria-hidden="true" />}
                  onClick={() => {
                    if (locationsOpen) {
                      closeLocations()
                      return
                    }
                    setLocationsOpen(true)
                    if (window.innerWidth < 1280) {
                      setInspectorOpen(false)
                    }
                  }}
                >
                  <span className="files-workspace-toggle-label">{t('files.locations')}</span>
                </Button>
              </Tooltip>
              <Tooltip title={t('files.details')}>
                <Button
                  ref={inspectorToggleRef}
                  type="text"
                  className={`files-workspace-toggle ${inspectorOpen ? 'is-active' : ''}`}
                  aria-label={t('files.details')}
                  aria-pressed={inspectorOpen}
                  icon={<PanelRight size={15} aria-hidden="true" />}
                  onClick={() => {
                    if (inspectorOpen) {
                      closeInspector()
                      return
                    }
                    openInspector()
                  }}
                >
                  <span className="files-workspace-toggle-label">{t('files.details')}</span>
                </Button>
              </Tooltip>
              <Tooltip title={t('files.transfers')}>
                <Button
                  ref={transferToggleRef}
                  type="text"
                  className={`files-workspace-toggle files-transfer-toggle ${transfersOpen ? 'is-active' : ''}`}
                  aria-label={t('files.transfers')}
                  aria-pressed={transfersOpen}
                  icon={<Activity size={15} aria-hidden="true" />}
                  onClick={() => {
                    lastTransferTriggerRef.current = transferToggleRef.current
                    if (transfersOpen && transferScope === 'session') {
                      closeTransfers()
                    } else {
                      setTransferScope('session')
                      setTransfersOpen(true)
                    }
                  }}
                >
                  <span className="files-workspace-toggle-label">{t('files.transfers')}</span>
                  {currentSessionActiveTransferCount > 0 ? (
                    <span className="files-workspace-toggle-count">{currentSessionActiveTransferCount}</span>
                  ) : null}
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className="files-canvas-row">
          <div
            ref={filesTableShellRef}
            className="files-table-shell"
            tabIndex={activeFileSession ? 0 : -1}
            onKeyDown={handleFileTableKeyDown}
          >
            {!activeFileSession ? (
              <div className="files-workspace-empty">
                <span className="files-workspace-empty-icon">
                  <Folder size={28} aria-hidden="true" />
                </span>
                <strong>{t('files.noFileSession')}</strong>
                <p>{t('files.noFileSessionHint')}</p>
                <Button
                  type="primary"
                  className="files-upload-button"
                  icon={<Plus size={16} aria-hidden="true" />}
                  onClick={onOpenFileSessionLauncher}
                >
                  {t('files.openFileSession')}
                </Button>
              </div>
            ) : activeFileSession.status !== 'connected' && !activeFileSessionHasCachedDirectory ? (
              <FileSessionProgress
                fileSession={activeFileSession}
                closing={activeFileSessionClosing}
                recovering={Boolean(activeFileSessionRecovery)}
                onRecover={recoverFileSession}
              />
            ) : (
              workspaceViewState.directoryStatus === 'initial_loading'
              || initialDirectoryLoading
            ) && !workspaceViewState.listing ? (
              <FilesDirectorySkeleton label={t('files.loadingDirectory')} />
            ) : workspaceViewState.directoryStatus === 'failed' && !workspaceViewState.listing ? (
              <div className="files-workspace-empty is-error" role="alert">
                <span className="files-workspace-empty-icon">
                  <XCircle size={28} aria-hidden="true" />
                </span>
                <strong>{t('files.directoryReadFailed')}</strong>
                <p>{workspaceViewState.error || t('app.error')}</p>
                <Button
                  className="secondary-button"
                  disabled={!fileSessionConnected}
                  icon={<RefreshCw size={15} aria-hidden="true" />}
                  onClick={retryDirectoryRequest}
                >
                  {t('app.retry')}
                </Button>
              </div>
            ) : (
              <>
                <Table
                  ref={fileTableRef}
                  rowKey="path"
                  columns={columns}
                  dataSource={entries}
                  pagination={false}
                  virtual={entries.length >= filesWorkspaceVirtualThreshold}
                  components={{ header: { cell: ResizableFileHeaderCell } }}
                  scroll={{
                    x: fileTableScrollWidth,
                    y: tableViewportHeight,
                  }}
                  size="small"
                  tableLayout="fixed"
                  className="files-table"
                  onChange={handleTableChange}
                  rowSelection={{
                    columnWidth: 38,
                    selectedRowKeys: selectedPaths,
                    getCheckboxProps: () => ({ disabled: !fileSessionConnected }),
                    onChange: (keys) => {
                      if (!fileSessionConnected) {
                        return
                      }
                      const paths = keys.map(String)
                      updateActiveWorkspaceView((current) => ({
                        ...current,
                        selectedPaths: paths,
                        focusedPath: paths[paths.length - 1] ?? current.focusedPath,
                        anchorPath: paths[paths.length - 1] ?? null,
                      }))
                    },
                  }}
                  rowClassName={(entry) => [
                    'files-table-row',
                    `is-${entry.kind}`,
                    workspaceViewState.focusedPath === entry.path ? 'is-focused' : '',
                    dropTargetDirectoryPath === entry.path || remoteMoveTargetPath === entry.path ? 'is-drop-target' : '',
                    remoteMoveTargetPath === entry.path ? 'is-move-target' : '',
                    remoteMoveDrag?.paths.includes(entry.path) ? 'is-being-dragged' : '',
                  ].filter(Boolean).join(' ')}
                  onRow={(entry) => ({
                    tabIndex: workspaceViewState.focusedPath === entry.path ? 0 : -1,
                    draggable: fileSessionConnected && !loading,
                    onFocus: () => focusEntry(entry),
                    onClick: (event) => {
                      if (
                        event.target instanceof Element
                        && event.target.closest('.ant-checkbox, .ant-checkbox-wrapper')
                      ) {
                        return
                      }
                      if (
                        entry.kind === 'directory'
                        && event.target instanceof Element
                        && event.target.closest('.file-name-copy, .file-kind-icon')
                      ) {
                        enterEntry(entry)
                        return
                      }
                      if (fileSessionConnected) {
                        selectEntry(entry, {
                          ctrlKey: event.ctrlKey,
                          metaKey: event.metaKey,
                          shiftKey: event.shiftKey,
                        })
                        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
                          openInspector()
                        }
                      }
                    },
                    onDoubleClick: () => enterEntry(entry),
                    onContextMenu: (event) => {
                      event.preventDefault()
                      if (!fileSessionConnected || loading) {
                        return
                      }
                      selectEntry(entry, { contextMenu: true })
                      setFileContextMenu({
                        fileSessionId: activeFileSessionId,
                        entry,
                        x: event.clientX,
                        y: event.clientY,
                      })
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
                  locale={{
                    emptyText: (
                      <EmptyState
                        title={t('files.emptyDirectory')}
                        description={t('files.emptyDirectoryHint')}
                      />
                    ),
                  }}
                />
                {!fileSessionConnected ? (
                  <FileSessionCachedDirectoryOverlay
                    fileSession={activeFileSession}
                    closing={activeFileSessionClosing}
                    recovering={Boolean(activeFileSessionRecovery)}
                    onRecover={recoverFileSession}
                  />
                ) : null}
              </>
            )}
            {fileContextMenu?.fileSessionId === activeFileSessionId && fileSessionConnected ? (
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

          {inspectorOpen ? (
            <aside
              className="files-inspector"
              aria-label={t('files.details')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeInspector()
                }
              }}
            >
              <div
                className="files-inspector-resize-edge"
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={t('files.resizeInspector')}
                aria-valuemin={280}
                aria-valuemax={440}
                aria-valuenow={layoutPreferences.inspectorWidth}
                onPointerDown={(event) => startPanelResize(event, 'inspector')}
                onKeyDown={(event) => resizePanelWithKeyboard(event, 'inspector')}
              />
              <header className="files-panel-heading">
                <span>
                  <Info size={15} aria-hidden="true" />
                  {t('files.details')}
                </span>
                <Button
                  type="text"
                  className="files-chrome-button"
                  aria-label={t('app.close')}
                  icon={<X size={15} aria-hidden="true" />}
                  onClick={closeInspector}
                />
              </header>
              <FileDetailPanel
                host={activeFileSessionHost}
                entry={activeEntry}
                connected={fileSessionConnected}
                onEditPermissions={openPermissions}
              />
            </aside>
          ) : null}
        </div>

        {transfersOpen ? (
          <section
            className="files-transfer-dock"
            aria-label={t('files.transfers')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeTransfers()
              }
            }}
          >
            <div
              className="files-transfer-resize-edge"
              role="separator"
              tabIndex={0}
              aria-orientation="horizontal"
              aria-label={t('files.resizeTransfers')}
              aria-valuemin={180}
              aria-valuemax={420}
              aria-valuenow={layoutPreferences.transferDockHeight}
              onPointerDown={(event) => startPanelResize(event, 'transfers')}
              onKeyDown={(event) => resizePanelWithKeyboard(event, 'transfers')}
            />
            <header className="files-panel-heading files-transfer-heading">
              <span>
                <Activity size={15} aria-hidden="true" />
                {t('files.transfers')}
              </span>
              <div className="files-transfer-scope" role="group" aria-label={t('files.transferScope')}>
                <button
                  type="button"
                  aria-pressed={transferScope === 'session'}
                  className={transferScope === 'session' ? 'is-active' : ''}
                  onClick={() => setTransferScope('session')}
                >
                  {t('files.currentSession')}
                </button>
                <button
                  type="button"
                  aria-pressed={transferScope === 'all'}
                  className={transferScope === 'all' ? 'is-active' : ''}
                  onClick={() => setTransferScope('all')}
                >
                  {t('files.allSessions')}
                </button>
              </div>
              <Button
                type="text"
                className="files-chrome-button"
                aria-label={t('app.close')}
                icon={<X size={15} aria-hidden="true" />}
                onClick={closeTransfers}
              />
            </header>
            <TransferQueuePanel
              transfers={scopedTransfers}
              pendingOperations={scopedPendingOperations}
              pendingActionIds={pendingTransferActionIds}
              hostNames={transferHostNames}
              showHostContext={transferScope === 'all'}
              liveConnected={transferEventsConnected}
              onRefresh={refreshTransfers}
              onDismissPending={removePendingTransferOperation}
              onCancel={async (id) => {
                const succeeded = await runTransferAction(id, () => api.deleteTransfer(id))
                if (succeeded) {
                  try {
                    await refreshTransfers()
                  } catch (actionError) {
                    notifyError(actionError)
                  }
                }
              }}
              onDelete={(id, options) => runTransferAction(id, async () => {
                await api.deleteTransfer(id)
                removeTransfer(id)
              }, !options?.silent)}
              onRetry={async (id) => {
                await runTransferAction(id, async () => {
                  const task = await api.retryTransfer(id)
                  upsertTransfer(task)
                })
              }}
            />
          </section>
        ) : null}

        <footer className="files-status-bar">
          <span>
            {t('files.itemCount', { count: entries.length })}
            {selectedPaths.length > 0 ? ` · ${t('files.selectedCount', { count: selectedPaths.length })}` : ''}
          </span>
          <span className={`files-status-connection is-${connectionStatusKey}`}>
            <i aria-hidden="true" />
            {activeFileSession
              ? `${activeFileSessionHost?.name ?? shortId(activeFileSession.id)} · ${t(`files.sessionStatus.${connectionStatusKey}`)}`
              : t('files.noFileSession')}
          </span>
          <button
            type="button"
            className={`files-transfer-summary ${activeTransferCount > 0 ? 'is-active' : ''}`}
            onClick={(event) => {
              lastTransferTriggerRef.current = event.currentTarget
              if (transfersOpen && transferScope === 'all') {
                closeTransfers()
              } else {
                setTransferScope('all')
                setTransfersOpen(true)
              }
            }}
          >
            <Activity size={13} aria-hidden="true" />
            {activeTransferCount > 0 ? (
              <>
                <span>{t('files.activeTransferCount', { count: activeTransferCount })}</span>
                {activeTransfers.length > 0 ? (
                  <>
                    <span>{Math.round(activeTransferProgress)}%</span>
                    <span>{t('files.transferSpeed', { value: formatBytes(activeTransferSpeed) })}</span>
                  </>
                ) : null}
              </>
            ) : (
              <span>{t('files.noActiveTransfers')}</span>
            )}
          </button>
        </footer>
      </main>

      {locationsOpen ? (
        <aside
          id="files-locations-drawer"
          className="files-locations-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t('files.locations')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeLocations()
              return
            }
            if (event.key === 'Tab') {
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
              ))
              const first = focusable[0]
              const last = focusable[focusable.length - 1]
              if (!first || !last) {
                return
              }
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
              }
            }
          }}
        >
          <header className="files-panel-heading">
            <span>
              <ListTree size={15} aria-hidden="true" />
              {t('files.locations')}
            </span>
            <Button
              type="text"
              className="files-chrome-button"
              aria-label={t('app.close')}
              icon={<X size={15} aria-hidden="true" />}
              onClick={closeLocations}
            />
          </header>
          <div className="files-locations-tabs" role="group" aria-label={t('files.locations')}>
            <button
              ref={bookmarksLocationTabRef}
              type="button"
              aria-pressed={locationTab === 'bookmarks'}
              className={locationTab === 'bookmarks' ? 'is-active' : ''}
              onClick={() => setLocationTab('bookmarks')}
            >
              <Bookmark size={14} aria-hidden="true" />
              {t('files.bookmarks')}
            </button>
            <button
              ref={localLocationTabRef}
              type="button"
              aria-pressed={locationTab === 'local'}
              className={locationTab === 'local' ? 'is-active' : ''}
              onClick={() => setLocationTab('local')}
            >
              <Folder size={14} aria-hidden="true" />
              {t('files.localMappingsShort')}
            </button>
          </div>
          <div className="files-locations-content">
            {locationTab === 'bookmarks' ? (
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
            ) : (
              <LocalPathMappingsPanel
                api={api}
                mappings={data.localPathMappings}
                embedded
                onCreateMapping={onCreateLocalPathMapping}
                onUpdateMapping={onUpdateLocalPathMapping}
                onDeleteMapping={onDeleteLocalPathMapping}
                onReorderMappings={onReorderLocalPathMappings}
                refreshRequests={localRefreshRequests}
              />
            )}
          </div>
        </aside>
      ) : null}

      {locationsOpen ? (
        <button
          type="button"
          className="files-locations-scrim"
          aria-label={t('app.close')}
          onClick={closeLocations}
        />
      ) : null}

      {dragActive || remoteMoveDrag ? (
        <div
          className={`files-drop-mask ${remoteMoveDrag ? 'is-move' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="files-drop-mask-icon" aria-hidden="true">
            {remoteMoveDrag ? <FolderDown size={17} /> : <Upload size={17} />}
          </span>
          <span className="files-drop-mask-copy">
            <strong>
              {remoteMoveDrag
                ? remoteMoveTargetDirectoryName
                  ? t('files.dropMoveToDirectory', { name: remoteMoveTargetDirectoryName })
                  : t('files.dropMoveChooseDirectory')
                : dropTargetDirectoryName
                  ? t('files.dropUploadToDirectory', { name: dropTargetDirectoryName })
                  : t('files.dropUpload')}
            </strong>
            {remoteMoveDrag?.paths.length && remoteMoveDrag.paths.length > 1 ? (
              <small>{t('files.selectedCount', { count: remoteMoveDrag.paths.length })}</small>
            ) : null}
          </span>
        </div>
      ) : null}
      <LocalDownloadDestinationModal
        open={Boolean(downloadDestinationRequest)}
        api={api}
        mappings={data.localPathMappings}
        onCancel={() => setDownloadDestinationRequest(null)}
        onConfirm={confirmMappedDownload}
        onManageMappings={manageLocalDownloadDestinations}
      />
      <RemotePermissionModal
        entry={permissionTarget?.fileSessionId === activeFileSessionId ? permissionTarget.entry : null}
        open={permissionTarget?.fileSessionId === activeFileSessionId}
        saving={permissionSaving}
        onCancel={() => setPermissionTarget(null)}
        onSubmit={(entry, mode) => {
          if (permissionTarget?.fileSessionId === activeFileSessionId) {
            void applyPermissions(permissionTarget.fileSessionId, entry, mode)
          }
        }}
      />
      {textEditorTarget?.fileSessionId === activeFileSessionId ? (
        <Suspense fallback={null}>
          <RemoteTextEditorModal
            api={api}
            open
            disabled={!fileSessionConnected || activeFileSessionClosing}
            fileSessionId={textEditorTarget.fileSessionId}
            path={textEditorTarget.path}
            theme={theme}
            terminalSettings={data.settings.terminal}
            onClose={() => setTextEditorTarget(null)}
            onSaved={(entry) => handleTextFileSaved(textEditorTarget.fileSessionId, entry)}
          />
        </Suspense>
      ) : null}
      {imageViewerTarget?.fileSessionId === activeFileSessionId ? (
        <Suspense fallback={null}>
          <RemoteImageViewerModal
            api={api}
            open
            fileSessionId={imageViewerTarget.fileSessionId}
            path={imageViewerTarget.path}
            theme={theme}
            onClose={() => setImageViewerTarget(null)}
          />
        </Suspense>
      ) : null}
    </section>
  )
}

interface PathTrailProps {
  path: string
  ariaLabel: string
  rootLabel: string
  dropTargetPath: string | null
  disabled: boolean
  onNavigate: (path: string) => void
  onDragOver: (path: string, event: DragEvent<HTMLButtonElement>) => void
  onDragLeave: (path: string, event: DragEvent<HTMLButtonElement>) => void
  onDrop: (path: string, event: DragEvent<HTMLButtonElement>) => void
}

function PathTrail({
  path,
  ariaLabel,
  rootLabel,
  dropTargetPath,
  disabled,
  onNavigate,
  onDragOver,
  onDragLeave,
  onDrop,
}: PathTrailProps) {
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
        <Tooltip title={index === 0 ? rootLabel : crumb.label} mouseEnterDelay={0.45}>
          <button
            type="button"
            className={`files-workspace-breadcrumb-link ${current ? 'is-current' : ''} ${index === 0 ? 'is-root' : ''} ${
              dropTarget ? 'is-drop-target' : ''
            }`}
            aria-label={index === 0 ? rootLabel : crumb.label}
            aria-current={current ? 'page' : undefined}
            tabIndex={current ? -1 : undefined}
            disabled={disabled}
            onClick={() => {
              if (!current) {
                onNavigate(crumb.path)
              }
            }}
            onDragEnter={(event) => onDragOver(crumb.path, event)}
            onDragOver={(event) => onDragOver(crumb.path, event)}
            onDragLeave={(event) => onDragLeave(crumb.path, event)}
            onDrop={(event) => void onDrop(crumb.path, event)}
          >
            {index === 0 ? <Folder size={14} strokeWidth={2} aria-hidden="true" /> : crumb.label}
          </button>
        </Tooltip>
      ),
    }
  })

  return (
    <Breadcrumb
      className="files-workspace-breadcrumb"
      aria-label={ariaLabel}
      separator={<ChevronRight size={12} strokeWidth={2.2} />}
      items={items}
    />
  )
}

function ResizableFileHeaderCell({
  resizeKey,
  resizeLabel,
  resizeValue,
  resizeMinimum,
  resizeMaximum,
  onResizeStart,
  onResizeKeyDown,
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
          data-resize-key={resizeKey}
          role="separator"
          aria-orientation="vertical"
          aria-label={resizeLabel}
          aria-valuenow={resizeValue}
          aria-valuemin={resizeMinimum}
          aria-valuemax={resizeMaximum}
          aria-valuetext={resizeValue === undefined ? undefined : `${resizeValue}px`}
          tabIndex={0}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => onResizeStart(resizeKey, event)}
          onKeyDown={(event) => onResizeKeyDown?.(resizeKey, event)}
        />
      ) : null}
    </th>
  )
}

function FilesDirectorySkeleton({ label }: { label: string }) {
  return (
    <div className="files-directory-skeleton" role="status" aria-label={label}>
      <div className="files-directory-skeleton-head" />
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="files-directory-skeleton-row">
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}

function FileDetailPanel({
  host,
  entry,
  connected,
  onEditPermissions,
}: {
  host?: Host
  entry: RemoteFileEntry | null
  connected: boolean
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
                <Tooltip title={connected ? null : t('files.connectionRequired')}>
                  <Button
                    type="text"
                    size="small"
                    className="files-inline-action"
                    disabled={!connected}
                    icon={<ShieldCheck size={13} />}
                    onClick={() => onEditPermissions(entry)}
                  >
                    {t('files.editPermissions')}
                  </Button>
                </Tooltip>
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

function FileSessionCachedDirectoryOverlay({
  fileSession,
  closing,
  recovering,
  onRecover,
}: {
  fileSession: FileSession
  closing: boolean
  recovering: boolean
  onRecover: (fileSession: FileSession) => Promise<void>
}) {
  const { t } = useTranslation()
  const terminal = fileSession.status === 'failed' || fileSession.status === 'disconnected'
  const copy = fileSessionRecoveryStatusCopy(fileSession, recovering, closing, t)
  const showRecoveryAction = !closing && (recovering || (terminal && canRecoverFileSession(fileSession)))

  return (
    <div
      className={`files-session-cache-overlay${recovering || closing ? ' is-recovering' : ''}`}
      role={terminal && !recovering && !closing ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="files-session-cache-overlay-icon" aria-hidden="true">
        {recovering || closing ? <CircleDashed size={16} /> : <XCircle size={16} />}
      </span>
      <span className="files-session-cache-overlay-copy">
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </span>
      {showRecoveryAction ? (
        <Button
          className="secondary-button"
          size="small"
          loading={recovering}
          disabled={recovering}
          onClick={() => void onRecover(fileSession)}
        >
          {t('files.reconnect')}
        </Button>
      ) : null}
    </div>
  )
}

function FileSessionProgress({
  fileSession,
  closing,
  recovering,
  onRecover,
}: {
  fileSession: FileSession
  closing: boolean
  recovering: boolean
  onRecover: (fileSession: FileSession) => Promise<void>
}) {
  const { t } = useTranslation()
  const progress = Math.max(0, Math.min(100, fileSession.progress ?? 0))
  const phase = fileSession.phase ?? 'queued'
  const terminal = fileSession.status === 'failed' || fileSession.status === 'disconnected'
  const phaseOrder: FileSessionPhase[] = fileSession.status === 'waiting_trust'
    ? waitingTrustFileSessionPhaseOrder
    : fileSessionPhaseOrder
  const currentIndex = phaseOrder.indexOf(phase)

  if (closing || terminal) {
    const copy = fileSessionRecoveryStatusCopy(fileSession, recovering, closing, t)

    return (
      <div className="files-session-progress is-terminal" role="status" aria-live="polite">
        <div className={`files-session-terminal-icon${recovering || closing ? ' is-recovering' : ''}`}>
          {recovering || closing ? <CircleDashed size={22} aria-hidden="true" /> : <XCircle size={22} aria-hidden="true" />}
        </div>
        <div className="files-session-terminal-copy">
          <strong>{copy.title}</strong>
          <span>{copy.detail}</span>
        </div>
        {!closing && canRecoverFileSession(fileSession) ? (
          <Button
            className="secondary-button"
            size="small"
            loading={recovering}
            disabled={recovering}
            onClick={() => void onRecover(fileSession)}
          >
            {t('files.reconnect')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="files-session-progress" role="status" aria-live="polite">
      <div className="connection-progress-head">
        <span>{t(`files.sessionPhase.${phase}`)}</span>
        <strong>{progress}%</strong>
      </div>
      <div
        className="connection-progress-bar"
        role="progressbar"
        aria-label={t(`files.sessionPhase.${phase}`)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
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
        {recovering ? (
          <Button
            className="secondary-button"
            size="small"
            loading
            disabled
          >
            {t('files.reconnect')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function fileSessionRecoveryStatusCopy(
  fileSession: FileSession,
  recovering: boolean,
  closing: boolean,
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (closing) {
    return {
      title: t('files.closingFileSession'),
      detail: t('files.closingFileSessionHint'),
    }
  }
  if (recovering) {
    return {
      title: t('workbench.files.recovering'),
      detail: t('workbench.files.recoveringHint'),
    }
  }
  if (isTerminatedFileSession(fileSession)) {
    return {
      title: t('workbench.files.sessionExpired'),
      detail: t('workbench.files.sessionExpiredHint'),
    }
  }
  if (fileSession.status === 'disconnected') {
    return {
      title: t('workbench.files.fileDisconnected'),
      detail: t('workbench.files.fileDisconnectedHint'),
    }
  }
  if (fileSession.status === 'failed') {
    return {
      title: t('workbench.files.connectFailed'),
      detail: fileSessionRecoveryErrorMessage(fileSession.error_code || '', t),
    }
  }
  if (fileSession.status === 'waiting_trust') {
    return {
      title: t('workbench.files.waitingTrust'),
      detail: t('workbench.files.waitingTrustHint'),
    }
  }
  return {
    title: t('workbench.files.connecting'),
    detail: t('workbench.files.preparing'),
  }
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

function fileSessionRecoveryErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code) {
      return code
    }
  }
  return 'SFTP_RECONNECT_FAILED'
}

function fileSessionRecoveryErrorMessage(
  errorCode: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (errorCode) {
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

function isMissingFileSessionError(error: unknown) {
  if (error instanceof TermousApiError) {
    return error.code === 'SFTP_FILE_SESSION_NOT_FOUND'
  }
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'SFTP_FILE_SESSION_NOT_FOUND',
  )
}
