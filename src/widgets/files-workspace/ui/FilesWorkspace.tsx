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
  useId,
  lazy,
  Suspense,
  useMemo,
  useRef,
  useState,
  startTransition,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SetStateAction,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import { TermousApiError } from '#shared/api'
import { SessionQuickConnect } from '#features/hosts'
import { confirmDialogStyles, EmptyState, SessionTabButton, SessionTabStrip, uiStyles } from '#shared/ui'
import { usePersistentJsonState } from '#shared/hooks'
import type { TerminalSettings } from '#common/contracts'
import type { Host } from '#entities/host'
import type { ThemeMode } from '#shared/theme'
import type {
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
  FileSession,
  FileSessionPhase,
  LocalGrantSource,
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
  RemoteFileEntry,
  TransferTask,
} from '#entities/file'
import type { FileGateway } from '#features/files'
import { useTransferRuntime } from '#features/transfers'
import {
  buildRemoteFileActionMenu,
  loadRemoteImageViewerModal,
  loadRemoteTextEditorModal,
  RemotePermissionModal,
  runRemoteFileAction,
  type RemoteFileActionHandlers,
} from '#features/remote-file'
import { formatBytes, formatDate } from '#shared/format'
import {
  joinPath,
  normalizeRemotePath,
  normalizeRemotePosixPath,
  parentPath,
} from '#shared/path'
import { FileBookmarksRail, FileBookmarksSidebar } from '#features/file-bookmarks'
import { FilesBottomDrawer, TransferQueueDock, TransferQueuePanel } from '#features/transfers'
import { FilesSidePanel, type FilesSidePanelMode } from './FilesSidePanel'
import {
  subscribeFileSessionEvents,
  type FileSessionEventSubscription,
} from '../model/fileSessionEventSubscription'
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
} from '#entities/file'
import type {
  LocalDownloadRequest,
  LocalDownloadTarget,
  LocalDownloadRefreshRequest,
} from '#features/local-download'
import {
  LocalDownloadConsole,
  LocalDownloadQuickTarget,
  beginRemoteFileDrag,
  isLocalPathWithin,
  releaseRemoteFileDrag,
  REMOTE_FILE_DRAG_MIME,
  resolveLocalDownloadQuickTarget,
  resolveRemoteFileDrag,
  validateRemoteFileDrag,
  type RemoteFileDragTransaction,
} from '#features/local-download'
import { useFilesWorkspaceRuntime } from '../model/useFilesWorkspaceRuntime'
import { useShortcutRuntime } from '#entities/shortcuts'
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
  isActiveFilesWorkspaceDirectoryResult,
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
} from '../model/filesWorkspaceState'
import styles from './FilesWorkspace.module.scss'

const RemoteTextEditorModal = lazy(loadRemoteTextEditorModal)
const RemoteImageViewerModal = lazy(loadRemoteImageViewerModal)

export interface FilesWorkspaceData {
  hosts: Host[]
  fileSessions: FileSession[]
  fileBookmarkGroups: FileBookmarkGroup[]
  fileBookmarks: FileBookmark[]
  localPathMappings: LocalPathMapping[]
  settings: {
    terminal: TerminalSettings
  }
}

export interface FilesWorkspaceBookmarkManagementIntent {
  requestId: number
  fileSessionId: string
}

export interface FilesWorkspaceProps {
  fileGateway: FileGateway
  getHostIconUrl: (iconId: string) => string
  data: FilesWorkspaceData
  theme: ThemeMode
  activeFileSession: FileSession | null
  closingFileSessionIds: readonly string[]
  bookmarkManagementIntent: FilesWorkspaceBookmarkManagementIntent | null
  onConsumeBookmarkManagementIntent: (requestId: number) => void
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
  fileSessionId: string
  hostId: string
  connectionGeneration: number
  paths: string[]
}

function matchesRemoteClipboard(
  current: RemoteClipboard | null,
  expected: RemoteClipboard | null,
) {
  return current !== null && current === expected
}

interface FileSessionEventMessage {
  type: string
  session: FileSession
}

interface RemoteMoveDragState {
  paths: string[]
  transactionId: string
}

type LocalDownloadDropSource = 'console' | 'quick-target'

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
  connectionGeneration: number
  paths: string[]
}

interface LoadDirectoryOptions {
  kind?: 'navigate' | 'refresh'
  historyMode?: FilesWorkspaceHistoryMode
  historyIndex?: number
  quiet?: boolean
  onError?: (description: string) => void
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

type FilesAuxiliarySurface = 'none' | 'local' | 'transfers'
type FilesSidePanelState = FilesSidePanelMode | 'none'
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

const fileDragAutoScrollEdge = 72
const fileDragAutoScrollMaxSpeed = 18
const filesWorkspaceCacheMaxAgeMs = 5_000
const filesWorkspaceVirtualThreshold = 200

const renderFilesRowMenu = (content: ReactNode) => (
  <div data-files-row-menu>{content}</div>
)

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

export function FilesWorkspace(props: FilesWorkspaceProps) {
  return <FilesWorkspaceContent {...props} />
}

function FilesWorkspaceContent({
  fileGateway,
  getHostIconUrl,
  data,
  theme,
  activeFileSession,
  closingFileSessionIds,
  bookmarkManagementIntent,
  onConsumeBookmarkManagementIntent,
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
}: FilesWorkspaceProps) {
  const { t } = useTranslation()
  const api = fileGateway
  const { runtime: shortcutRuntime } = useShortcutRuntime()
  const filesShortcutInstanceId = useId()
  const filesShortcutContextId = `files.page:${filesShortcutInstanceId}`
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
  const localDownloadDropSourcesRef = useRef(new Set<LocalDownloadDropSource>())
  const localDownloadOperationSourcesRef = useRef(new Set<LocalDownloadDropSource>())
  const localDownloadTaskRef = useRef<{ key: string; promise: Promise<boolean> } | null>(null)
  const resetDragStateRef = useRef<() => void>(() => undefined)
  const directoryRequestControllersRef = useRef(new Map<string, {
    controller: AbortController
    connectionGeneration: number
  }>())
  const downloadRefreshTasksRef = useRef(new Map<string, { mappingId?: string; targetPath: string }>())
  const lastSessionLoadKeyRef = useRef('')
  const lastActiveFileSessionRef = useRef<{
    id: string
    connectionGeneration: number
  } | null>(null)
  const fileSessionSubscriptionsRef = useRef(new Map<string, FileSessionEventSubscription>())
  const fileSessionRecoveryAttemptsRef = useRef(new Map<string, FileSessionRecoveryAttempt>())
  const fileSessionsRef = useRef(data.fileSessions)
  const localPathMappingsRef = useRef(data.localPathMappings)
  const fileResizeCleanupRef = useRef<(() => void) | null>(null)
  const breadcrumbViewportRef = useRef<HTMLDivElement>(null)
  const breadcrumbPinnedToEndRef = useRef(true)
  const pathInputRef = useRef<InputRef>(null)
  const bookmarkRailToggleRef = useRef<HTMLButtonElement>(null)
  const consumedBookmarkManagementIntentRef = useRef<number | null>(null)
  const bookmarkMutationPendingRef = useRef(false)
  const localConsoleToggleRef = useRef<HTMLButtonElement>(null)
  const inspectorToggleRef = useRef<HTMLButtonElement>(null)
  const sidePanelRef = useRef<HTMLElement>(null)
  const sidePanelModeRef = useRef<FilesSidePanelState>('none')
  const transferToggleRef = useRef<HTMLButtonElement>(null)
  const lastTransferTriggerRef = useRef<HTMLButtonElement | null>(null)
  const pendingPanelFocusRestoreRef = useRef<'local' | 'inspector' | 'transfers' | null>(null)
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
  const [localDownloadDropActive, setLocalDownloadDropActive] = useState(false)
  const [localDownloadOperationActive, setLocalDownloadOperationActive] = useState(false)
  const [localRefreshRequests, setLocalRefreshRequests] = useState<LocalDownloadRefreshRequest[]>([])
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [permissionTarget, setPermissionTarget] = useState<SessionBoundRemoteEntry | null>(null)
  const [textEditorTarget, setTextEditorTarget] = useState<SessionBoundRemotePath | null>(null)
  const [imageViewerTarget, setImageViewerTarget] = useState<SessionBoundRemotePath | null>(null)

  const updateLocalDownloadDropSource = useCallback((
    source: LocalDownloadDropSource,
    active: boolean,
  ) => {
    const sources = localDownloadDropSourcesRef.current
    if (active) {
      sources.add(source)
      dragDepthRef.current = 0
      setDragActive(false)
      setDropTargetDirectoryPath(null)
      setRemoteMoveTargetPath(null)
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
        autoScrollFrameRef.current = null
      }
      autoScrollSpeedRef.current = 0
    } else {
      sources.delete(source)
    }
    setLocalDownloadDropActive(sources.size > 0)
  }, [])

  const handleLocalConsoleDropActiveChange = useCallback(
    (active: boolean) => updateLocalDownloadDropSource('console', active),
    [updateLocalDownloadDropSource],
  )

  const handleLocalQuickTargetDropActiveChange = useCallback(
    (active: boolean) => updateLocalDownloadDropSource('quick-target', active),
    [updateLocalDownloadDropSource],
  )
  const updateLocalDownloadOperationSource = useCallback((
    source: LocalDownloadDropSource,
    active: boolean,
  ) => {
    const sources = localDownloadOperationSourcesRef.current
    if (active) {
      if (sources.size > 0 && !sources.has(source)) {
        return false
      }
      sources.add(source)
    } else {
      sources.delete(source)
    }
    setLocalDownloadOperationActive(sources.size > 0)
    return true
  }, [])
  const handleLocalConsoleOperationActiveChange = useCallback(
    (active: boolean) => updateLocalDownloadOperationSource('console', active),
    [updateLocalDownloadOperationSource],
  )
  const handleLocalQuickTargetOperationActiveChange = useCallback(
    (active: boolean) => updateLocalDownloadOperationSource('quick-target', active),
    [updateLocalDownloadOperationSource],
  )
  const [downloadDestinationRequest, setDownloadDestinationRequest] = useState<DownloadDestinationRequest | null>(null)
  const [localDownloadTarget, setLocalDownloadTarget] = useState<LocalDownloadTarget | null>(null)
  const effectiveLocalDownloadTarget = useMemo(
    () => resolveLocalDownloadQuickTarget(data.localPathMappings, localDownloadTarget),
    [data.localPathMappings, localDownloadTarget],
  )
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [fileSessionRecoveryAttempts, setFileSessionRecoveryAttempts] = useState<ReadonlyMap<
    string,
    FileSessionRecoveryAttempt
  >>(() => new Map())
  const [auxiliarySurface, setAuxiliarySurface] = useState<FilesAuxiliarySurface>('none')
  const [bookmarkMutationPending, setBookmarkMutationPending] = useState(false)
  const [sidePanelMode, setSidePanelMode] = useState<FilesSidePanelState>('none')
  const [transferScope, setTransferScope] = useState<TransferScope>('session')
  const [tableViewportHeight, setTableViewportHeight] = useState(0)
  sidePanelModeRef.current = sidePanelMode
  const bookmarksExpanded = sidePanelMode === 'bookmarks'
  const inspectorOpen = sidePanelMode === 'details'
  const localConsoleOpen = auxiliarySurface === 'local'
  const transfersOpen = auxiliarySurface === 'transfers'
  const updateSidePanelMode = useCallback((mode: FilesSidePanelState) => {
    sidePanelModeRef.current = mode
    setSidePanelMode(mode)
  }, [])
  const closeLocalConsole = useCallback(() => {
    pendingPanelFocusRestoreRef.current = 'local'
    setAuxiliarySurface('none')
  }, [])
  const closeBookmarksWorkbench = useCallback((
    reason: 'dismiss' | 'navigation' | 'pointer' = 'dismiss',
  ) => {
    const panel = reason === 'pointer'
      ? document.getElementById('files-bookmarks-workbench')
      : null
    if (sidePanelModeRef.current !== 'bookmarks') {
      return
    }
    updateSidePanelMode('none')
    window.requestAnimationFrame(() => {
      if (sidePanelModeRef.current !== 'none') {
        return
      }
      if (reason === 'navigation') {
        filesTableShellRef.current?.focus()
      } else if (reason === 'pointer') {
        const active = document.activeElement
        if (!active || active === document.body || panel?.contains(active)) {
          filesTableShellRef.current?.focus()
        }
      } else {
        bookmarkRailToggleRef.current?.focus()
      }
    })
  }, [updateSidePanelMode])
  const openBookmarksWorkbench = useCallback(() => {
    if (localDownloadOperationSourcesRef.current.size > 0) {
      return
    }
    setAuxiliarySurface('none')
    updateSidePanelMode('bookmarks')
  }, [updateSidePanelMode])
  const openLocalConsole = useCallback(() => {
    if (localDownloadOperationSourcesRef.current.size > 0) {
      return
    }
    setAuxiliarySurface('local')
    if (
      sidePanelModeRef.current === 'bookmarks'
      || window.innerWidth < 1280
    ) {
      updateSidePanelMode('none')
    }
  }, [updateSidePanelMode])
  const closeInspector = useCallback(() => {
    if (sidePanelModeRef.current !== 'details') {
      return
    }
    pendingPanelFocusRestoreRef.current = 'inspector'
    updateSidePanelMode('none')
  }, [updateSidePanelMode])
  const openInspector = useCallback(() => {
    if (
      window.innerWidth < 1280
      && auxiliarySurface !== 'none'
      && localDownloadOperationSourcesRef.current.size > 0
    ) {
      return
    }
    updateSidePanelMode('details')
    if (window.innerWidth < 1280 && auxiliarySurface !== 'none') {
      setAuxiliarySurface('none')
    }
  }, [auxiliarySurface, updateSidePanelMode])
  const closeTransfers = useCallback(() => {
    pendingPanelFocusRestoreRef.current = 'transfers'
    setAuxiliarySurface('none')
  }, [])

  useEffect(() => {
    const target = pendingPanelFocusRestoreRef.current
    if (
      !target
      || (target === 'local' && localConsoleOpen)
      || (target === 'inspector' && inspectorOpen)
      || (target === 'transfers' && transfersOpen)
    ) {
      return
    }
    pendingPanelFocusRestoreRef.current = null
    window.requestAnimationFrame(() => {
      if (target === 'local') {
        localConsoleToggleRef.current?.focus()
      } else if (target === 'inspector') {
        inspectorToggleRef.current?.focus()
      } else {
        (lastTransferTriggerRef.current ?? transferToggleRef.current)?.focus()
      }
    })
  }, [inspectorOpen, localConsoleOpen, transfersOpen])
  const [layoutPreferences, setLayoutPreferences] = usePersistentJsonState(
    filesWorkspaceLayoutStorageKey,
    defaultFilesWorkspaceLayoutPreferences,
    (value) => parseFilesWorkspaceLayoutPreferences(JSON.stringify(value)),
  )
  const bookmarkRailExpanded = layoutPreferences.bookmarkRailExpanded
  const toggleBookmarkRail = useCallback(() => {
    const expanded = !bookmarkRailExpanded
    setLayoutPreferences((current) => ({
      ...current,
      bookmarkRailExpanded: expanded,
    }))
    if (!expanded && sidePanelModeRef.current === 'bookmarks') {
      updateSidePanelMode('none')
    }
  }, [bookmarkRailExpanded, setLayoutPreferences, updateSidePanelMode])
  useEffect(() => {
    if (
      !bookmarkManagementIntent
      || activeFileSession?.id !== bookmarkManagementIntent.fileSessionId
      || consumedBookmarkManagementIntentRef.current === bookmarkManagementIntent.requestId
    ) {
      return
    }
    consumedBookmarkManagementIntentRef.current = bookmarkManagementIntent.requestId
    setAuxiliarySurface('none')
    updateSidePanelMode('bookmarks')
    setLayoutPreferences((current) => (
      current.bookmarkRailExpanded
        ? current
        : { ...current, bookmarkRailExpanded: true }
    ))
    onConsumeBookmarkManagementIntent(bookmarkManagementIntent.requestId)
  }, [
    activeFileSession?.id,
    bookmarkManagementIntent,
    onConsumeBookmarkManagementIntent,
    setLayoutPreferences,
    updateSidePanelMode,
  ])
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
  const runBookmarkMutation = useCallback(async <T,>(operation: () => Promise<T>) => {
    if (bookmarkMutationPendingRef.current) {
      throw new Error(t('files.bookmarkMutationBusy'))
    }
    bookmarkMutationPendingRef.current = true
    setBookmarkMutationPending(true)
    try {
      return await operation()
    } finally {
      bookmarkMutationPendingRef.current = false
      setBookmarkMutationPending(false)
    }
  }, [t])
  const createFileBookmark = useCallback(
    (input: FileBookmarkInput) => runBookmarkMutation(() => onCreateFileBookmark(input)),
    [onCreateFileBookmark, runBookmarkMutation],
  )
  const updateFileBookmark = useCallback(
    (id: string, input: FileBookmarkInput) => (
      runBookmarkMutation(() => onUpdateFileBookmark(id, input))
    ),
    [onUpdateFileBookmark, runBookmarkMutation],
  )
  const deleteFileBookmark = useCallback(
    (id: string) => runBookmarkMutation(() => onDeleteFileBookmark(id)),
    [onDeleteFileBookmark, runBookmarkMutation],
  )
  const reorderFileBookmarks = useCallback(
    (items: FileBookmarkReorderItem[]) => (
      runBookmarkMutation(() => onReorderFileBookmarks(items))
    ),
    [onReorderFileBookmarks, runBookmarkMutation],
  )
  const createFileBookmarkGroup = useCallback(
    (input: FileBookmarkGroupInput) => (
      runBookmarkMutation(() => onCreateFileBookmarkGroup(input))
    ),
    [onCreateFileBookmarkGroup, runBookmarkMutation],
  )
  const updateFileBookmarkGroup = useCallback(
    (id: string, input: FileBookmarkGroupInput) => (
      runBookmarkMutation(() => onUpdateFileBookmarkGroup(id, input))
    ),
    [onUpdateFileBookmarkGroup, runBookmarkMutation],
  )
  const deleteFileBookmarkGroup = useCallback(
    (id: string) => runBookmarkMutation(() => onDeleteFileBookmarkGroup(id)),
    [onDeleteFileBookmarkGroup, runBookmarkMutation],
  )
  const reorderFileBookmarkGroups = useCallback(
    (items: FileBookmarkGroupReorderItem[]) => (
      runBookmarkMutation(() => onReorderFileBookmarkGroups(items))
    ),
    [onReorderFileBookmarkGroups, runBookmarkMutation],
  )
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
  const activeFileSessionHostId = activeFileSession?.host_id ?? ''
  const activeFileSessionConnectionGeneration = activeFileSession?.connection_generation ?? 0
  const fileListingCurrent = (
    workspaceViewState.listing !== null
    && workspaceViewState.listingConnectionGeneration
      === activeFileSessionConnectionGeneration
  )
  const fileActionsEnabled = fileSessionConnected && fileListingCurrent
  const selectedPathsKey = [...selectedPaths].sort().join('\u0000')
  const stableSelectedPaths = useMemo(
    () => selectedPathsKey ? selectedPathsKey.split('\u0000') : [],
    [selectedPathsKey],
  )
  const localDownloadSession = useMemo(() => activeFileSessionId ? {
    connected: fileActionsEnabled,
    fileSessionId: activeFileSessionId,
    hostId: activeFileSessionHostId,
    connectionGeneration: activeFileSessionConnectionGeneration,
  } : null, [
    activeFileSessionConnectionGeneration,
    activeFileSessionHostId,
    activeFileSessionId,
    fileActionsEnabled,
  ])
  const localDownloadSelection = useMemo<LocalDownloadRequest['selection'] | null>(() => {
    if (downloadDestinationRequest) {
      return {
        fileSessionId: downloadDestinationRequest.fileSessionId,
        hostId: downloadDestinationRequest.hostId,
        connectionGeneration: downloadDestinationRequest.connectionGeneration,
        paths: downloadDestinationRequest.paths,
      }
    }
    if (!activeFileSessionId || stableSelectedPaths.length === 0) {
      return null
    }
    return {
      fileSessionId: activeFileSessionId,
      hostId: activeFileSessionHostId,
      connectionGeneration: activeFileSessionConnectionGeneration,
      paths: stableSelectedPaths,
    }
  }, [
    activeFileSessionConnectionGeneration,
    activeFileSessionHostId,
    activeFileSessionId,
    downloadDestinationRequest,
    stableSelectedPaths,
  ])
  const initialDirectoryLoading = fileSessionConnected
    && workspaceViewState.listing === null
    && workspaceViewState.directoryStatus === 'idle'
    && !workspaceViewState.error
  const loading = directoryRequestLoading || initialDirectoryLoading
  fileSessionsRef.current = data.fileSessions
  localPathMappingsRef.current = data.localPathMappings
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
      directoryRequestControllersRef.current.forEach((request, fileSessionId) => {
        request.controller.abort()
        updateExistingWorkspaceSession(
          fileSessionId,
          cancelFilesWorkspaceDirectoryRequest,
        )
      })
      directoryRequestControllersRef.current.clear()
      releaseRemoteFileDrag(remoteMoveDragRef.current?.transactionId)
      remoteMoveDragRef.current = null
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
      if (!activeFileSession) {
        return false
      }
      const requestSession = fileSessionsRef.current.find(
        (session) => session.id === activeFileSession.id,
      )
      if (
        !requestSession
        || activeFileSessionIdRef.current !== activeFileSession.id
        || requestSession.status !== 'connected'
        || (requestSession.connection_generation ?? 0)
          !== (activeFileSession.connection_generation ?? 0)
        || closingFileSessionIdsRef.current.has(requestSession.id)
      ) {
        return false
      }
      const normalized = normalizeRemotePosixPath(nextPath)
      if (!normalized) {
        notification.warning({
          message: t('workbench.files.invalidPath'),
          duration: 3,
          role: 'alert',
          className: 'termous-notification',
        })
        return false
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
        return false
      }

      const controller = new AbortController()
      directoryRequestControllersRef.current.get(requestSession.id)?.controller.abort()
      directoryRequestControllersRef.current.set(requestSession.id, {
        controller,
        connectionGeneration: requestSession.connection_generation ?? 0,
      })
      updateWorkspaceSession(
        requestSession.id,
        requestSession.current_path || '/',
        () => request.state,
      )
      const cancelRequestState = () => {
        updateExistingWorkspaceSession(
          requestSession.id,
          (latest) => (
            latest.activeRequest?.requestSequence === request.requestSequence
              ? cancelFilesWorkspaceDirectoryRequest(latest)
              : latest
          ),
        )
      }
      try {
        const listing = await api.listFileSessionFiles(
          requestSession.id,
          normalized,
          { signal: controller.signal },
        )
        const currentRequest = directoryRequestControllersRef.current.get(requestSession.id)
        const currentSession = fileSessionsRef.current.find(
          (session) => session.id === requestSession.id,
        )
        const isCurrentRequest = currentRequest?.controller === controller
        const isCurrentGeneration = (
          currentSession?.status === 'connected'
          && (currentSession.connection_generation ?? 0)
            === (requestSession.connection_generation ?? 0)
          && !closingFileSessionIdsRef.current.has(requestSession.id)
        )
        if (!isCurrentRequest || !isCurrentGeneration) {
          cancelRequestState()
          return false
        }
        updateExistingWorkspaceSession(
          requestSession.id,
          (latest) => completeFilesWorkspaceDirectoryRequest(
            latest,
            request.requestSequence,
            listing,
            Date.now(),
            requestSession.connection_generation ?? 0,
          ),
        )
        if (isActiveFilesWorkspaceDirectoryResult(
          requestSession,
          activeFileSessionIdRef.current,
          currentSession,
        )) {
          clearDirectoryDirty(requestSession.id, normalized)
          setDropTargetDirectoryPath(null)
          setRemoteMoveTargetPath(null)
          return true
        }
        return false
      } catch (loadError) {
        if (controller.signal.aborted) {
          cancelRequestState()
          return false
        }
        const currentRequest = directoryRequestControllersRef.current.get(requestSession.id)
        const currentSession = fileSessionsRef.current.find(
          (session) => session.id === requestSession.id,
        )
        if (
          currentRequest?.controller !== controller
          || currentSession?.status !== 'connected'
          || (currentSession.connection_generation ?? 0)
            !== (requestSession.connection_generation ?? 0)
          || closingFileSessionIdsRef.current.has(requestSession.id)
        ) {
          cancelRequestState()
          return false
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
        if (
          !isActiveFilesWorkspaceDirectoryResult(
            requestSession,
            activeFileSessionIdRef.current,
            currentSession,
          )
          || closingFileSessionIdsRef.current.has(requestSession.id)
        ) {
          return false
        }
        options.onError?.(description)
        if (options.quiet) {
          return false
        }
        notification.error({
          message: t('files.directoryReadFailed'),
          description,
          duration: 5,
          role: 'alert',
          className: 'termous-notification',
        })
        return false
      } finally {
        if (
          directoryRequestControllersRef.current.get(requestSession.id)?.controller
            === controller
        ) {
          directoryRequestControllersRef.current.delete(requestSession.id)
        }
      }
    },
    [
      activeFileSession,
      api,
      clearDirectoryDirty,
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

  const loadBookmarkDirectory = useCallback(
    (path: string) => loadDirectory(path, {
      quiet: true,
      onError: (description) => {
        notification.error({
          title: t('files.bookmarkNavigationFailed'),
          description,
          duration: 4,
          role: 'alert',
          className: 'termous-notification',
        })
      },
    }),
    [loadDirectory, notification, t],
  )

  const trackUploadRefreshTask = useCallback((task: TransferTask) => {
    if (!isUploadTransfer(task) || !task.file_session_id) {
      return
    }
    trackWorkspaceUploadRefreshTask(task.id, {
      fileSessionId: task.file_session_id,
      targetPath: normalizeRemotePath(task.target_path || '/'),
    })
  }, [trackWorkspaceUploadRefreshTask])

  const trackDownloadRefreshTask = useCallback((task: TransferTask, mappingId?: string) => {
    if (!isDownloadTransfer(task) || !task.target_path) {
      return
    }
    downloadRefreshTasksRef.current.set(task.id, {
      mappingId,
      targetPath: task.target_path,
    })
  }, [])

  useEffect(() => {
    if (!activeFileSession) {
      lastSessionLoadKeyRef.current = ''
      lastActiveFileSessionRef.current = null
      setPathInput('/')
      setFileContextMenu(null)
      setPermissionTarget(null)
      setTextEditorTarget(null)
      setImageViewerTarget(null)
      return
    }
    const previousSession = lastActiveFileSessionRef.current
    const connectionGeneration = activeFileSession.connection_generation ?? 0
    const fileSessionChanged = previousSession?.id !== activeFileSession.id
    const connectionChanged = fileSessionChanged
      || previousSession?.connectionGeneration !== connectionGeneration
    lastActiveFileSessionRef.current = {
      id: activeFileSession.id,
      connectionGeneration,
    }
    if (connectionChanged) {
      const cached = getFilesWorkspaceSessionState(
        workspaceStatesRef.current,
        activeFileSession.id,
        activeFileSession.current_path || '/',
      )
      setPathInput(cached.committedPath)
      setEditingPath(false)
      setFileContextMenu(null)
      setPermissionTarget(null)
      setImageViewerTarget(null)
      if (fileSessionChanged) {
        setTextEditorTarget(null)
      }
    }
    if (!canStartFilesWorkspaceDirectoryLoad(
      activeFileSession.status,
      Boolean(activeFileSessionRecovery),
    )) {
      lastSessionLoadKeyRef.current = ''
      return
    }
    const loadKey = [
      activeFileSession.id,
      activeFileSession.connection_generation ?? 0,
      activeFileSession.connected_at ?? '',
    ].join(':')
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
      activeFileSession.connection_generation ?? 0,
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
        || (currentSession.connection_generation ?? 0)
          !== (activeFileSession.connection_generation ?? 0)
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
    directoryRequestControllersRef.current.forEach((request, fileSessionId) => {
      const fileSession = fileSessionsById.get(fileSessionId)
      if (
        fileSession?.status === 'connected'
        && (fileSession.connection_generation ?? 0) === request.connectionGeneration
        && !closingFileSessionIdSet.has(fileSessionId)
      ) {
        return
      }
      request.controller.abort()
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
    if (auxiliarySurface === 'none' || sidePanelMode === 'none') {
      return undefined
    }
    const keepNarrowPanelsExclusive = () => {
      if (window.innerWidth < 1280) {
        if (sidePanelRef.current?.contains(document.activeElement)) {
          if (sidePanelModeRef.current === 'details') {
            pendingPanelFocusRestoreRef.current = 'inspector'
          }
        }
        updateSidePanelMode('none')
      }
    }
    keepNarrowPanelsExclusive()
    window.addEventListener('resize', keepNarrowPanelsExclusive)
    return () => window.removeEventListener('resize', keepNarrowPanelsExclusive)
  }, [auxiliarySurface, sidePanelMode, updateSidePanelMode])

  useEffect(() => {
    if (!activeFileSessionId) {
      return
    }
    if (activeFileSessionClosing) {
      directoryRequestControllersRef.current.get(activeFileSessionId)?.controller.abort()
      directoryRequestControllersRef.current.delete(activeFileSessionId)
      updateActiveWorkspaceView((current) => setFilesWorkspaceDirectoryStatus(current, 'closing'))
      return
    }
    const recovering = Boolean(activeFileSessionRecovery)
    if (recovering) {
      directoryRequestControllersRef.current.get(activeFileSessionId)?.controller.abort()
      directoryRequestControllersRef.current.delete(activeFileSessionId)
      updateActiveWorkspaceView((current) => setFilesWorkspaceDirectoryStatus(current, 'recovering'))
      return
    }
    if (activeFileSession?.status === 'failed' || activeFileSession?.status === 'disconnected') {
      directoryRequestControllersRef.current.get(activeFileSessionId)?.controller.abort()
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
        const existing = downloadRefreshTasksRef.current.get(task.id)
        downloadRefreshTasksRef.current.set(task.id, {
          mappingId: existing?.mappingId,
          targetPath: task.target_path,
        })
      }
    })

    const completedRequests: LocalDownloadRefreshRequest[] = []
    const taskIdsToDelete: string[] = []
    downloadRefreshTasksRef.current.forEach((target, taskId) => {
      const task = transferById.get(taskId)
      if (!task) {
        taskIdsToDelete.push(taskId)
        return
      }
      if (isTransferActive(task)) {
        return
      }
      if (task.status === 'completed') {
        completedRequests.push({
          id: task.id,
          mappingId: target.mappingId,
          targetPath: target.targetPath,
        })
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
      if (event.target instanceof Element && event.target.closest('[data-files-row-menu]')) {
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

  const isCurrentFileListingAvailable = (
    fileSessionId: string,
    connectionGeneration: number,
  ) => {
    const fileSession = fileSessionsRef.current.find(
      (session) => session.id === fileSessionId,
    )
    const viewState = workspaceStatesRef.current[fileSessionId]
    return (
      fileSession?.status === 'connected'
      && !closingFileSessionIdsRef.current.has(fileSessionId)
      && (fileSession.connection_generation ?? 0) === connectionGeneration
      && viewState?.listing !== null
      && viewState?.listingConnectionGeneration === connectionGeneration
    )
  }

  const requireCurrentFileListing = (
    fileSessionId: string,
    connectionGeneration: number,
  ) => {
    if (isCurrentFileListingAvailable(fileSessionId, connectionGeneration)) {
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
    const fileSessionId = activeFileSessionIdRef.current
    const fileSession = fileSessionsRef.current.find(
      (session) => session.id === fileSessionId,
    )
    const connectionGeneration = fileSession?.connection_generation ?? 0
    if (
      !fileSessionId
      || paths.length === 0
      || !isCurrentFileListingAvailable(fileSessionId, connectionGeneration)
    ) {
      return
    }
    await runFileAction(async () => {
      const pendingId = startPendingTransferOperation({
        hostId: activeFileSession?.host_id ?? '',
        fileSessionId,
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
        requireCurrentFileListing(fileSessionId, connectionGeneration)
        const task = await api.createFileSessionUploadTransfer(fileSessionId, grant.id, targetPath, 'rename')
        trackUploadRefreshTask(task)
        upsertTransfer(task)
        removePendingTransferOperation(pendingId)
      } catch (actionError) {
        failPendingTransferOperation(pendingId, t('files.fileOperationTransferFailed'))
        throw actionError
      }
    }, t('files.transferCreated'))
  }

  const downloadPathsToLocalDir = async (
    paths: string[],
    localDir: string,
    source: Pick<DownloadDestinationRequest, 'fileSessionId' | 'hostId' | 'connectionGeneration'> = {
      fileSessionId: activeFileSession?.id ?? '',
      hostId: activeFileSession?.host_id ?? '',
      connectionGeneration: activeFileSession?.connection_generation ?? 0,
    },
    mappingId?: string,
    signal?: AbortSignal,
  ) => {
    const currentSession = fileSessionsRef.current.find((session) => session.id === source.fileSessionId)
    if (
      signal?.aborted
      ||
      paths.length === 0
      || !currentSession
      || currentSession.host_id !== source.hostId
      || !isCurrentFileListingAvailable(
        currentSession.id,
        source.connectionGeneration,
      )
    ) {
      return false
    }
    let created = false
    await runFileAction(async () => {
      const pendingId = startPendingTransferOperation({
        hostId: source.hostId,
        fileSessionId: source.fileSessionId,
        title: t('files.fileOperationDownloadTitle'),
        description: t('files.fileOperationTransferCreate'),
        progress: 0,
        status: 'running',
        indeterminate: true,
      })
      try {
        const latestSession = fileSessionsRef.current.find((session) => session.id === source.fileSessionId)
        if (
          signal?.aborted
          ||
          !latestSession
          || latestSession.host_id !== source.hostId
          || !isCurrentFileListingAvailable(
            latestSession.id,
            source.connectionGeneration,
          )
        ) {
          throw new Error(t('files.connectionRequired'))
        }
        const task = await api.createFileSessionDownloadTransfer(
          source.fileSessionId,
          paths,
          localDir,
          'rename',
          signal,
        )
        trackDownloadRefreshTask(task, mappingId)
        upsertTransfer(task)
        removePendingTransferOperation(pendingId)
        created = true
      } catch (actionError) {
        if (signal?.aborted) {
          removePendingTransferOperation(pendingId)
          return
        }
        failPendingTransferOperation(pendingId, t('files.fileOperationTransferFailed'))
        throw actionError
      }
    })
    if (created) {
      notification.success({
        title: t('files.transferCreated'),
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
    }
    return created
  }

  const downloadPaths = async (paths: string[]) => {
    if (!activeFileSessionId || !fileActionsEnabled || paths.length === 0) {
      return
    }
    const filesBridge = getTermousBridge()?.files
    const localDirs = await filesBridge?.pickDirectory()
    const localDir = localDirs?.[0]
    if (!localDir) {
      return
    }
    await downloadPathsToLocalDir(paths, localDir)
  }

  const downloadToLocalTarget = async (
    request: LocalDownloadRequest,
    signal?: AbortSignal,
  ) => {
    const mapping = localPathMappingsRef.current.find(
      (item) => item.id === request.target.mappingId,
    )
    if (
      !mapping?.available
      || mapping.path !== request.target.mappingPath
      || !isLocalPathWithin(request.target.path, mapping.path)
      || signal?.aborted
    ) {
      return false
    }
    const source = {
      fileSessionId: request.selection.fileSessionId,
      hostId: request.selection.hostId,
      connectionGeneration: Number(request.selection.connectionGeneration),
    }
    const operationKey = JSON.stringify([
      source.fileSessionId,
      source.hostId,
      source.connectionGeneration,
      request.target.mappingId,
      request.target.path,
      [...request.selection.paths].sort(),
    ])
    if (localDownloadTaskRef.current) {
      return false
    }
    const operation = downloadPathsToLocalDir(
      [...request.selection.paths],
      request.target.path,
      source,
      request.target.mappingId,
      signal,
    )
    localDownloadTaskRef.current = { key: operationKey, promise: operation }
    try {
      return await operation
    } finally {
      if (
        localDownloadTaskRef.current?.key === operationKey
        && localDownloadTaskRef.current.promise === operation
      ) {
        localDownloadTaskRef.current = null
      }
    }
  }

  const moveRemotePathsToDirectory = async (
    transaction: RemoteFileDragTransaction,
    targetPath: string,
  ) => {
    const clipboardSnapshot = remoteClipboard
    const currentSession = fileSessionsRef.current.find(
      (session) => session.id === activeFileSessionIdRef.current,
    )
    if (!currentSession) {
      return
    }
    if (!isCurrentFileListingAvailable(
      currentSession.id,
      currentSession.connection_generation ?? 0,
    )) {
      return
    }
    const initialValidation = validateRemoteFileDrag(transaction, {
      connected:
        currentSession.status === 'connected'
        && !closingFileSessionIdsRef.current.has(currentSession.id),
      fileSessionId: currentSession.id,
      hostId: currentSession.host_id,
      connectionGeneration: currentSession.connection_generation ?? 0,
    })
    if (!initialValidation.ok) {
      return
    }
    await runFileAction(async () => {
      const latestSession = fileSessionsRef.current.find(
        (session) => session.id === transaction.fileSessionId,
      )
      const latestValidation = latestSession
        ? validateRemoteFileDrag(transaction, {
            connected:
              latestSession.status === 'connected'
              && activeFileSessionIdRef.current === latestSession.id
              && !closingFileSessionIdsRef.current.has(latestSession.id),
            fileSessionId: latestSession.id,
            hostId: latestSession.host_id,
            connectionGeneration: latestSession.connection_generation ?? 0,
          })
        : null
      if (!latestValidation?.ok) {
        throw new Error(t('files.connectionRequired'))
      }
      await api.moveFileSessionFiles(
        transaction.fileSessionId,
        [...transaction.paths],
        targetPath,
        'rename',
      )
      setRemoteClipboard((current) => {
        if (
          !matchesRemoteClipboard(current, clipboardSnapshot)
          || !current
          || current.hostId !== transaction.hostId
          || !current.paths.some((path) => transaction.paths.includes(path))
        ) {
          return current
        }
        return null
      })
      await loadDirectory(currentPath, { kind: 'refresh' })
    }, t('files.operationDone'))
  }

  const pasteRemoteClipboard = async () => {
    if (
      !fileActionsEnabled
      || !remoteClipboard
      || !activeFileSession
      || remoteClipboard.hostId !== activeFileSession.host_id
      || !isCurrentFileListingAvailable(
        remoteClipboard.fileSessionId,
        remoteClipboard.connectionGeneration,
      )
    ) {
      return false
    }
    const clipboardSnapshot = remoteClipboard
    const targetSessionId = activeFileSession.id
    const targetGeneration = activeFileSession.connection_generation ?? 0
    await runFileAction(async () => {
      requireCurrentFileListing(targetSessionId, targetGeneration)
      if (clipboardSnapshot.mode === 'cut') {
        await api.moveFileSessionFiles(targetSessionId, clipboardSnapshot.paths, currentPath, 'rename')
        setRemoteClipboard((current) => (
          matchesRemoteClipboard(current, clipboardSnapshot) ? null : current
        ))
      } else {
        await api.copyFileSessionFiles(targetSessionId, clipboardSnapshot.paths, currentPath, 'rename')
      }
      await loadDirectory(currentPath, { kind: 'refresh' })
    }, t('files.operationDone'))
    return true
  }

  const pasteFromClipboard = async () => {
    if (await pasteRemoteClipboard()) {
      return
    }
    const filesBridge = getTermousBridge()?.files
    const paths = await filesBridge?.readClipboardFilePaths()
    if (paths?.length) {
      await uploadLocalPaths('clipboard', paths)
    }
  }

  const openCreateDirectory = () => {
    if (!fileActionsEnabled || !activeFileSessionId) {
      return
    }
    const fileSessionId = activeFileSessionId
    const connectionGeneration = activeFileSessionConnectionGeneration
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
        requireCurrentFileListing(fileSessionId, connectionGeneration)
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        const target = joinPath(currentPath, cleanName)
        await api.mkdirFileSessionFile(fileSessionId, target)
        await loadDirectory(currentPath, { kind: 'refresh' })
      },
    })
  }

  const openRename = (entry = selectedEntries[0]) => {
    if (!entry || !fileActionsEnabled || !activeFileSessionId) {
      return
    }
    const fileSessionId = activeFileSessionId
    const connectionGeneration = activeFileSessionConnectionGeneration
    let name = entry.name
    modal.confirm({
      title: t('files.rename'),
      icon: null,
      content: <Input autoFocus defaultValue={entry.name} onChange={(event) => { name = event.target.value }} />,
      okText: t('app.update'),
      cancelText: t('app.cancel'),
      className: `${confirmDialogStyles.modal} confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-root']} termous-modal-root`,
      onOk: async () => {
        requireCurrentFileListing(fileSessionId, connectionGeneration)
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        await api.renameFileSessionFile(fileSessionId, entry.path, joinPath(parentPath(entry.path), cleanName))
        await loadDirectory(currentPath, { kind: 'refresh' })
      },
    })
  }

  const openPermissions = (entry = selectedEntries[0]) => {
    if (!entry || !fileActionsEnabled || !activeFileSessionId) {
      return
    }
    setPermissionTarget({ fileSessionId: activeFileSessionId, entry })
    setActiveEntry(entry)
    setSelectedPaths([entry.path])
  }

  const openFileEntry = (entry = selectedEntries[0]) => {
    if (!entry || !fileActionsEnabled) {
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
    const requestSession = fileSessionsRef.current.find(
      (session) => session.id === fileSessionId,
    )
    try {
      requireCurrentFileListing(
        fileSessionId,
        requestSession?.connection_generation ?? 0,
      )
    } catch {
      setPermissionTarget(null)
      return
    }
    if (!requestSession) {
      setPermissionTarget(null)
      return
    }
    const requestGeneration = requestSession.connection_generation ?? 0
    setPermissionSaving(true)
    try {
      const updated = await api.chmodFileSessionFile(fileSessionId, entry.path, mode)
      const currentSession = fileSessionsRef.current.find(
        (session) => session.id === fileSessionId,
      )
      if (
        currentSession?.status !== 'connected'
        || (currentSession.connection_generation ?? 0) !== requestGeneration
        || closingFileSessionIdsRef.current.has(fileSessionId)
      ) {
        return
      }
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
    if (!activeFileSessionId || !fileActionsEnabled || paths.length === 0) {
      return
    }
    const fileSessionId = activeFileSessionId
    const connectionGeneration = activeFileSessionConnectionGeneration
    modal.confirm({
      title: t('files.deleteTitle'),
      content: t('files.deleteDescription', { count: paths.length }),
      okText: t('app.delete'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: `${confirmDialogStyles.modal} confirm-modal`,
      rootClassName: `${confirmDialogStyles['modal-root']} termous-modal-root`,
      onOk: async () => {
        requireCurrentFileListing(fileSessionId, connectionGeneration)
        await api.deleteFileSessionFiles(fileSessionId, paths, true)
        await loadDirectory(currentPath, { kind: 'refresh' })
      },
    })
  }

  const pickFiles = async () => {
    const filesBridge = getTermousBridge()?.files
    const paths = await filesBridge?.pickFiles()
    await uploadLocalPaths('picker', paths ?? [])
  }

  const pickFolder = async () => {
    const filesBridge = getTermousBridge()?.files
    const paths = await filesBridge?.pickDirectory()
    await uploadLocalPaths('picker', paths ?? [])
  }

  const copySelected = (mode: 'copy' | 'cut') => {
    if (selectedPaths.length === 0 || !activeFileSession || !fileActionsEnabled) {
      return
    }
    setRemoteClipboard({
      mode,
      fileSessionId: activeFileSession.id,
      hostId: activeFileSession.host_id,
      connectionGeneration: activeFileSession.connection_generation ?? 0,
      paths: selectedPaths,
    })
    notification.success({ title: mode === 'cut' ? t('files.cutReady') : t('files.copyReady'), duration: 2 })
  }

  const enterEntry = (entry: RemoteFileEntry) => {
    if (!fileActionsEnabled) {
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

  const hasRemoteDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes(REMOTE_FILE_DRAG_MIME)

  const notifyRemoteMoveUnavailable = () => {
    notification.warning({
      title: t('files.remoteMoveUnavailable'),
      duration: 3,
      role: 'status',
      className: 'termous-notification',
    })
  }

  const resolveRemoteMoveDropTransaction = (
    dataTransfer: DataTransfer,
  ): RemoteFileDragTransaction | null => {
    const transaction = resolveRemoteFileDrag(dataTransfer)
    if (!transaction) {
      return null
    }
    const currentSession = fileSessionsRef.current.find(
      (session) => session.id === activeFileSessionIdRef.current,
    )
    if (!currentSession) {
      return null
    }
    const validation = validateRemoteFileDrag(transaction, {
      connected:
        currentSession.status === 'connected'
        && !closingFileSessionIdsRef.current.has(currentSession.id),
      fileSessionId: currentSession.id,
      hostId: currentSession.host_id,
      connectionGeneration: currentSession.connection_generation ?? 0,
    })
    return validation.ok ? validation.transaction : null
  }

  const findDirectoryDropTargetPath = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return null
    }
    const row = target.closest<HTMLElement>(
      '[data-files-table-row][data-files-entry-kind="directory"][data-row-key]',
    )
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

  const canDropRemoteMoveToPath = (targetPath: string, sourcePaths: readonly string[]) => (
    sourcePaths.length > 0 && sourcePaths.every((sourcePath) => canMovePathToDirectory(sourcePath, targetPath))
  )

  const findRemoteMoveTargetPath = (target: EventTarget | null, sourcePaths: readonly string[]) => {
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
    localDownloadDropSourcesRef.current.clear()
    setLocalDownloadDropActive(false)
    releaseRemoteFileDrag(remoteMoveDragRef.current?.transactionId)
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
    event.dataTransfer.dropEffect = fileActionsEnabled ? 'copy' : 'none'
    setDragActive(fileActionsEnabled)
    setDropTargetDirectoryPath(fileActionsEnabled ? normalizedTargetPath : null)
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
      const transaction = resolveRemoteMoveDropTransaction(event.dataTransfer)
      const allowed = transaction
        ? canDropRemoteMoveToPath(normalizedTargetPath, transaction.paths)
        : false
      releaseRemoteFileDrag(transaction)
      resetDragState()
      if (allowed && transaction) {
        await moveRemotePathsToDirectory(transaction, normalizedTargetPath)
      } else {
        notifyRemoteMoveUnavailable()
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
    const filesBridge = getTermousBridge()?.files
    const cachedPaths = await filesBridge?.consumeDroppedFilePaths?.(event.dataTransfer.files.length)
    const paths = cachedPaths?.length
      ? cachedPaths
      : await filesBridge?.pathsFromFileList(event.dataTransfer.files)
    if (fileActionsEnabled && (!paths || paths.length === 0)) {
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
    if (!fileActionsEnabled) {
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
    event.dataTransfer.dropEffect = fileActionsEnabled ? 'copy' : 'none'
    setDragActive(fileActionsEnabled)
    setDropTargetDirectoryPath(fileActionsEnabled ? findDirectoryDropTargetPath(event.target) : null)
    if (fileActionsEnabled) {
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
      event.preventDefault()
      event.stopPropagation()
      const transaction = resolveRemoteMoveDropTransaction(event.dataTransfer)
      const targetPath = transaction
        ? findRemoteMoveTargetPath(event.target, transaction.paths)
        : null
      releaseRemoteFileDrag(transaction)
      resetDragState()
      if (targetPath && transaction) {
        await moveRemotePathsToDirectory(transaction, targetPath)
      } else {
        notifyRemoteMoveUnavailable()
      }
      return
    }
    const shouldUpload = hasDraggedFiles(event)
    const targetPath = fileActionsEnabled
      ? findDirectoryDropTargetPath(event.target) ?? currentPath
      : currentPath
    event.preventDefault()
    event.stopPropagation()
    resetDragState()
    if (!shouldUpload || !fileActionsEnabled) {
      return
    }
    const filesBridge = getTermousBridge()?.files
    const cachedPaths = await filesBridge?.consumeDroppedFilePaths?.(event.dataTransfer.files.length)
    const paths = cachedPaths?.length
      ? cachedPaths
      : await filesBridge?.pathsFromFileList(event.dataTransfer.files)
    if (fileActionsEnabled && (!paths || paths.length === 0)) {
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
    if (!(target instanceof Element)) {
      return false
    }
    return Boolean(target.closest('.ant-checkbox, [data-files-drag-block]'))
  }

  const remoteDragPathsForEntry = (entry: RemoteFileEntry) => {
    if (selectedPaths.includes(entry.path)) {
      return selectedPaths
    }
    return [entry.path]
  }

  const startRemoteMoveDrag = (entry: RemoteFileEntry, event: DragEvent<HTMLElement>) => {
    if (!activeFileSession || !fileActionsEnabled || loading || shouldIgnoreRemoteDragStart(event.target)) {
      event.preventDefault()
      return
    }
    const paths = remoteDragPathsForEntry(entry)
    setSelectedPaths(paths)
    setActiveEntry(entry)
    const transaction = beginRemoteFileDrag(event.dataTransfer, {
      fileSessionId: activeFileSession.id,
      hostId: activeFileSession.host_id,
      connectionGeneration: activeFileSession.connection_generation ?? 0,
      paths,
    })
    const dragState = { paths, transactionId: transaction.id }
    remoteMoveDragRef.current = dragState
    setRemoteMoveDrag(dragState)
    setRemoteMoveTargetPath(null)
    remoteDragPreviewRef.current?.remove()
    const preview = document.createElement('div')
    preview.className = styles['files-remote-drag-preview']
    const icon = event.currentTarget.querySelector<HTMLElement>('[data-file-kind-icon]')?.cloneNode(true)
    if (icon instanceof HTMLElement) {
      preview.append(icon)
    }
    const label = document.createElement('span')
    label.className = styles['files-remote-drag-preview-label']
    label.textContent = entry.name
    preview.append(label)
    if (paths.length > 1) {
      const count = document.createElement('span')
      count.className = styles['files-remote-drag-preview-count']
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
    event.preventDefault()
    event.stopPropagation()
    const transaction = resolveRemoteMoveDropTransaction(event.dataTransfer)
    const targetPath = transaction
      ? findRemoteMoveTargetPath(event.currentTarget, transaction.paths)
      : null
    releaseRemoteFileDrag(transaction)
    resetDragState()
    if (targetPath && transaction) {
      await moveRemotePathsToDirectory(transaction, targetPath)
    } else {
      notifyRemoteMoveUnavailable()
    }
  }

  const actionDisabled = !fileActionsEnabled || loading
  const navigationDisabled = !fileSessionConnected || (
    workspaceViewState.directoryStatus === 'initial_loading'
    && !workspaceViewState.listing
  )
  useEffect(() => {
    if (!fileActionsEnabled) {
      setFileContextMenu(null)
      setPermissionTarget(null)
      setDownloadDestinationRequest(null)
      updateActiveWorkspaceView((current) => (
        current.focusedPath === null
        && current.selectedPaths.length === 0
        && current.anchorPath === null
          ? current
          : {
              ...current,
              focusedPath: null,
              selectedPaths: [],
              anchorPath: null,
            }
      ))
    }
  }, [fileActionsEnabled, updateActiveWorkspaceView])

  useEffect(() => {
    setRemoteClipboard((current) => {
      if (!current) {
        return null
      }
      const sourceSession = data.fileSessions.find(
        (session) => session.id === current.fileSessionId,
      )
      if (
        sourceSession?.status !== 'connected'
        || sourceSession.host_id !== current.hostId
        || (sourceSession.connection_generation ?? 0)
          !== current.connectionGeneration
        || closingFileSessionIdsRef.current.has(current.fileSessionId)
      ) {
        return null
      }
      return current
    })
  }, [data.fileSessions])

  useEffect(() => {
    if (
      downloadDestinationRequest
      && (
        !activeFileSession
        || !fileActionsEnabled
        || downloadDestinationRequest.fileSessionId !== activeFileSession.id
        || downloadDestinationRequest.hostId !== activeFileSession.host_id
        || downloadDestinationRequest.connectionGeneration !== (activeFileSession.connection_generation ?? 0)
      )
    ) {
      setDownloadDestinationRequest(null)
    }
  }, [activeFileSession, downloadDestinationRequest, fileActionsEnabled])

  useEffect(() => {
    if (auxiliarySurface !== 'local') {
      setDownloadDestinationRequest(null)
    }
  }, [auxiliarySurface])

  useEffect(() => {
    resetDragStateRef.current()
  }, [
    activeFileSession?.connection_generation,
    activeFileSession?.id,
    activeFileSession?.status,
  ])

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
    if (!fileActionsEnabled) {
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
          connectionGeneration: activeFileSession.connection_generation ?? 0,
          paths: [...actionPaths],
        })
        openLocalConsole()
      }
      return
    }
    const handlers: RemoteFileActionHandlers = {
      openFile: openFileEntry,
      download: () => void downloadPaths(actionPaths),
      copy: () => {
        if (activeFileSession) {
          setRemoteClipboard({
            mode: 'copy',
            fileSessionId: activeFileSession.id,
            hostId: activeFileSession.host_id,
            connectionGeneration: activeFileSession.connection_generation ?? 0,
            paths: actionPaths,
          })
        }
      },
      cut: () => {
        if (activeFileSession) {
          setRemoteClipboard({
            mode: 'cut',
            fileSessionId: activeFileSession.id,
            hostId: activeFileSession.host_id,
            connectionGeneration: activeFileSession.connection_generation ?? 0,
            paths: actionPaths,
          })
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
      delete document.body.dataset.filesColumnResizing
      delete document.body.dataset.filesResizeKey
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', cleanup)
      window.removeEventListener('blur', cleanup)
      fileResizeCleanupRef.current = null
    }

    document.body.dataset.filesColumnResizing = 'true'
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
          className: 'files-table-name-cell',
        onCell: () => ({
          'data-files-name-cell': 'true',
        } as HTMLAttributes<HTMLTableCellElement> & { 'data-files-name-cell': string }),
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
            <span className={styles['file-name-cell']}>
              <span
                className={`${styles['file-kind-icon']} ${entry.kind === 'directory' ? styles['is-directory'] : ''}`}
                data-file-kind-icon
                data-files-entry-open
              >
                {entry.kind === 'directory' ? <Folder size={16} /> : <File size={16} />}
              </span>
              <Tooltip
                title={fullName}
                placement="topLeft"
                mouseEnterDelay={0.35}
                classNames={{ root: styles['file-name-tooltip'] }}
              >
                <span className={styles['file-name-copy']} data-files-entry-open>{nameCopy}</span>
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
          className: styles['files-table-spacer-cell'],
        render: () => null,
      },
      {
        title: '',
        width: 40,
          className: styles['files-table-actions-cell'],
        render: (_: unknown, entry: RemoteFileEntry) => (
          <Dropdown
            disabled={!fileActionsEnabled}
            menu={fileRowMenuPropsRef.current(entry)}
            trigger={['click']}
            popupRender={renderFilesRowMenu}
            classNames={{ root: styles['files-row-menu'] }}
          >
            <Button
              type="text"
              className={styles['files-icon-button']}
              data-files-drag-block
              aria-label={t('files.actions')}
              icon={<MoreHorizontal size={16} />}
            />
          </Dropdown>
        ),
      },
    ]
  }, [
    fileColumnWidths,
    fileActionsEnabled,
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

  const filesShortcutStateRef = useRef({
    fileActionsEnabled,
    entries,
    focusedPath: workspaceViewState.focusedPath,
    selectedPaths,
    orderedEntryPaths,
    updateActiveWorkspaceView,
    enterEntry,
    openRename,
    confirmDelete,
  })
  filesShortcutStateRef.current = {
    fileActionsEnabled,
    entries,
    focusedPath: workspaceViewState.focusedPath,
    selectedPaths,
    orderedEntryPaths,
    updateActiveWorkspaceView,
    enterEntry,
    openRename,
    confirmDelete,
  }

  useEffect(() => {
    const disposeContext = shortcutRuntime.pushContext({
      id: filesShortcutContextId,
      layer: 'focus',
      priority: 10,
      scopes: ['files.standalone', 'files.list'],
      isActive: () => {
        const shell = filesTableShellRef.current
        const activeElement = document.activeElement
        return Boolean(
          filesShortcutStateRef.current.fileActionsEnabled
          && shell
          && activeElement
          && shell.contains(activeElement),
        )
      },
    })
    const focusedEntry = () => {
      const current = filesShortcutStateRef.current
      return current.entries.find((entry) => entry.path === current.focusedPath)
        ?? current.entries[0]
        ?? null
    }
    const disposeHandlers = [
      shortcutRuntime.registerHandler(filesShortcutContextId, 'files.select_all', () => {
        const current = filesShortcutStateRef.current
        const entry = focusedEntry()
        if (!current.fileActionsEnabled || !entry || current.orderedEntryPaths.length === 0) {
          return 'fallthrough'
        }
        current.updateActiveWorkspaceView((view) => ({
          ...view,
          focusedPath: entry.path,
          selectedPaths: current.orderedEntryPaths,
          anchorPath: current.orderedEntryPaths[0] ?? null,
        }))
        return 'handled'
      }),
      shortcutRuntime.registerHandler(filesShortcutContextId, 'files.open_focused', () => {
        const current = filesShortcutStateRef.current
        const entry = focusedEntry()
        if (!current.fileActionsEnabled || !entry) return 'fallthrough'
        current.enterEntry(entry)
        return 'handled'
      }),
      shortcutRuntime.registerHandler(filesShortcutContextId, 'files.rename_focused', () => {
        const current = filesShortcutStateRef.current
        const entry = focusedEntry()
        if (!current.fileActionsEnabled || !entry) return 'fallthrough'
        current.openRename(entry)
        return 'handled'
      }),
      shortcutRuntime.registerHandler(filesShortcutContextId, 'files.delete_selection', () => {
        const current = filesShortcutStateRef.current
        const entry = focusedEntry()
        if (!current.fileActionsEnabled || !entry) return 'fallthrough'
        current.confirmDelete(
          current.selectedPaths.includes(entry.path)
            ? current.selectedPaths
            : [entry.path],
        )
        return 'handled'
      }),
    ]
    return () => {
      disposeHandlers.reverse().forEach((dispose) => dispose())
      disposeContext()
    }
  }, [filesShortcutContextId, shortcutRuntime])

  const handleFileTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!fileActionsEnabled || entries.length === 0) {
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
    const dispatchFileShortcut = () => {
      const result = shortcutRuntime.dispatch(event.nativeEvent, {
        adapterId: 'files-page',
        contextIds: [filesShortcutContextId],
        editable: false,
      })
      if (result.result === 'handled' || result.result === 'blocked') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const navigationKey = [
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ].includes(event.key)
    if (
      (navigationKey && (event.ctrlKey || event.metaKey || event.altKey))
      || (event.key === ' ' && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey))
    ) {
      dispatchFileShortcut()
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
    if (event.key === ' ') {
      event.preventDefault()
      selectEntry(entry, { ctrlKey: true })
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
    } else {
      dispatchFileShortcut()
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
  }, [activeFileSessionId, auxiliarySurface, sidePanelMode])

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
        disabled: !fileActionsEnabled || selectedPaths.length !== 1,
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
        styles.root,
        styles['files-page'],
        styles['files-workspace-page'],
        inspectorOpen ? 'has-inspector' : '',
        transfersOpen ? 'has-transfer-dock' : '',
        bookmarksExpanded ? styles['has-bookmarks-sidebar'] : '',
        localConsoleOpen ? 'has-local-download-console' : '',
        dragActive ? styles['is-dragging'] : '',
        remoteMoveDrag ? styles['is-moving'] : '',
      ].filter(Boolean).join(' ')}
      onMouseDown={handleFilePageMouseDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={resetDragState}
      onDrop={(event) => void onDrop(event)}
    >
      <main className={styles['files-main-panel']}>
        <div className={`files-session-toolbar ${styles['terminal-toolbar']} terminal-toolbar`}>
          <SessionTabStrip
            ariaLabel={t('files.sessions')}
            activeId={activeFileSessionId}
            contentKey={displayedFileSessionKey}
            scrollLeftLabel={t('workbench.scrollTabsLeft')}
            scrollRightLabel={t('workbench.scrollTabsRight')}
            tabsClassName={`${styles['terminal-tabs']} terminal-tabs`}
            trailing={(
              <SessionQuickConnect
                hosts={data.hosts}
                triggerLabel={t('files.openFileSession')}
                open={quickConnectOpen}
                query={quickConnectQuery}
                onOpenChange={setQuickConnectOpen}
                onQueryChange={setQuickConnectQuery}
                onConnect={connectQuickFileHost}
                getHostIconUrl={getHostIconUrl}
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

        <div className={styles['files-location-bar']} role="toolbar" aria-label={t('files.pathNavigation')}>
          <div className={styles['files-navigation-cluster']}>
            <div className={styles['files-history-actions']}>
              <Tooltip title={t('files.back')}>
                <Button
                  type="text"
                  className={styles['files-navigation-button']}
                  aria-label={t('files.back')}
                  disabled={navigationDisabled || !backTarget}
                  icon={<ArrowLeft size={15} aria-hidden="true" />}
                  onClick={() => navigateHistory('back')}
                />
              </Tooltip>
              <Tooltip title={t('files.forward')}>
                <Button
                  type="text"
                  className={styles['files-navigation-button']}
                  aria-label={t('files.forward')}
                  disabled={navigationDisabled || !forwardTarget}
                  icon={<ArrowRight size={15} aria-hidden="true" />}
                  onClick={() => navigateHistory('forward')}
                />
              </Tooltip>
            </div>
              <span className={styles['files-navigation-divider']} aria-hidden="true" />
            <Tooltip title={t('files.parent')}>
              <Button
                type="text"
                className={styles['files-navigation-button']}
                aria-label={t('files.parent')}
                disabled={navigationDisabled || displayedPath === '/'}
                icon={<ArrowUp size={15} aria-hidden="true" />}
                onClick={() => void loadDirectory(parentPath(displayedPath))}
              />
            </Tooltip>
          </div>

          <div
            className={[
              styles['files-path-control'],
              editingPath ? 'is-editing' : '',
              directoryNavigationBusy ? styles['is-busy'] : '',
              directoryHasInlineError ? styles['is-error'] : '',
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
                styles['files-breadcrumb-shell'],
                breadcrumbScrollState.canScrollLeft ? 'has-left-overflow' : '',
                breadcrumbScrollState.canScrollRight ? 'has-right-overflow' : '',
              ].filter(Boolean).join(' ')}>
                <span className={`${styles['files-breadcrumb-scroll-slot']} is-left`}>
                  {breadcrumbScrollState.canScrollLeft ? (
                    <Tooltip title={t('files.scrollPathLeft')}>
                      <Button
                        type="text"
                        className={styles['files-breadcrumb-scroll']}
                        aria-label={t('files.scrollPathLeft')}
                        icon={<ArrowLeft size={13} aria-hidden="true" />}
                        onClick={() => scrollBreadcrumb('left')}
                      />
                    </Tooltip>
                  ) : null}
                </span>
                <div
                  ref={breadcrumbViewportRef}
                  className={styles['files-breadcrumb-viewport']}
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
                <span className={`${styles['files-breadcrumb-scroll-slot']} is-right`}>
                  {breadcrumbScrollState.canScrollRight ? (
                    <Tooltip title={t('files.scrollPathRight')}>
                      <Button
                        type="text"
                        className={styles['files-breadcrumb-scroll']}
                        aria-label={t('files.scrollPathRight')}
                        icon={<ArrowRight size={13} aria-hidden="true" />}
                        onClick={() => scrollBreadcrumb('right')}
                      />
                    </Tooltip>
                  ) : null}
                </span>
              </div>
            )}
            <div className={styles['files-path-actions']}>
              {editingPath ? (
                <>
                  <Tooltip title={t('app.confirm')}>
                    <Button
                      type="text"
                      className={`${styles['files-path-action']} ${styles['is-confirm']}`}
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
                      className={styles['files-path-action']}
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
                      className={`${styles['files-path-action']} ${directoryHasInlineError ? styles['is-error'] : ''}`}
                      aria-label={directoryHasInlineError ? t('app.retry') : t('app.reload')}
                      disabled={navigationDisabled}
                      icon={directoryHasInlineError
                        ? <XCircle size={14} aria-hidden="true" />
                        : (
                            <RefreshCw
                              className={directoryNavigationBusy ? `${uiStyles['is-spinning']} is-spinning` : ''}
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
                      className={styles['files-path-action']}
                      aria-label={t('files.editPath')}
                      disabled={navigationDisabled}
                      icon={<Pencil size={14} aria-hidden="true" />}
                      onClick={beginPathEdit}
                    />
                  </Tooltip>
                </>
              )}
              <span className={styles['files-path-action-divider']} aria-hidden="true" />
              <Tooltip title={t(
                bookmarkRailExpanded
                  ? 'files.collapseBookmarkRail'
                  : 'files.expandBookmarkRail',
              )}>
                <Button
                  type="text"
                  className={[
                    styles['files-path-action'],
                    styles['is-bookmark-rail-toggle'],
                    bookmarkRailExpanded ? styles['is-active'] : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={t(
                    bookmarkRailExpanded
                      ? 'files.collapseBookmarkRail'
                      : 'files.expandBookmarkRail',
                  )}
                  aria-controls="files-bookmark-rail"
                  aria-expanded={bookmarkRailExpanded}
                  icon={<Bookmark size={14} aria-hidden="true" />}
                  onClick={toggleBookmarkRail}
                />
              </Tooltip>
            </div>
            {directoryNavigationBusy ? <span className={styles['files-path-progress']} aria-hidden="true" /> : null}
            {directoryStatusMessage ? (
              <span
                className={styles['files-directory-live-status']}
                role={directoryHasInlineError ? 'alert' : 'status'}
                aria-live={directoryHasInlineError ? 'assertive' : 'polite'}
              >
                {directoryStatusMessage}
              </span>
            ) : null}
          </div>
        </div>

        <div
          id="files-bookmark-rail"
          className={`${styles['files-bookmark-rail-region']} ${bookmarkRailExpanded ? 'is-expanded' : styles['is-collapsed']}`}
          aria-hidden={!bookmarkRailExpanded}
          inert={!bookmarkRailExpanded}
        >
          <div className={styles['files-bookmark-rail-region-content']}>
            <FileBookmarksRail
              ref={bookmarkRailToggleRef}
              bookmarks={data.fileBookmarks}
              groups={data.fileBookmarkGroups}
              currentPath={currentPath}
              connected={fileSessionConnected}
              expanded={bookmarksExpanded}
              mutationPending={bookmarkMutationPending}
              navigationKey={`${activeFileSessionId}:${activeFileSession?.connection_generation ?? 0}`}
              panelId="files-bookmarks-workbench"
              onNavigate={loadBookmarkDirectory}
              onCreateBookmark={createFileBookmark}
              onExpandedChange={(expanded) => {
                if (expanded) {
                  openBookmarksWorkbench()
                } else {
                  closeBookmarksWorkbench()
                }
              }}
            />
          </div>
        </div>

        <div className={`${styles['files-command-bar']} ${selectedPaths.length > 0 ? 'has-selection' : ''}`}>
          <div className={styles['files-command-primary']}>
            {selectedPaths.length > 0 ? (
              <>
                <span className={styles['files-selection-summary']}>
                  {t('files.selectedCount', { count: selectedPaths.length })}
                </span>
                <Button
                  type="text"
                  className={styles['files-command-button']}
                  disabled={!fileActionsEnabled}
                  icon={<Copy size={15} aria-hidden="true" />}
                  onClick={() => copySelected('copy')}
                >
                  {t('files.copy')}
                </Button>
                <Button
                  type="text"
                  className={styles['files-command-button']}
                  disabled={!fileActionsEnabled}
                  icon={<Scissors size={15} aria-hidden="true" />}
                  onClick={() => copySelected('cut')}
                >
                  {t('files.cut')}
                </Button>
                <Button
                  type="text"
                  className={styles['files-command-button']}
                  disabled={!fileActionsEnabled || selectedPaths.length !== 1}
                  icon={<Pencil size={15} aria-hidden="true" />}
                  onClick={() => openRename()}
                >
                  {t('files.rename')}
                </Button>
                <Button
                  type="text"
                  className={`${styles['files-command-button']} ${styles['is-low-priority']}`}
                  disabled={!fileActionsEnabled || selectedPaths.length !== 1}
                  icon={<ShieldCheck size={15} aria-hidden="true" />}
                  onClick={() => openPermissions()}
                >
                  {t('files.editPermissions')}
                </Button>
                <Dropdown
                  menu={selectionMoreActions}
                  trigger={['click']}
                  popupRender={renderFilesRowMenu}
                  classNames={{ root: styles['files-row-menu'] }}
                >
                  <Button
                    type="text"
                    className={`${styles['files-chrome-button']} ${styles['files-selection-more']}`}
                    disabled={!fileActionsEnabled}
                    aria-label={t('files.actions')}
                    icon={<MoreHorizontal size={16} aria-hidden="true" />}
                  />
                </Dropdown>
              </>
            ) : (
              <>
                <Button
                  type="primary"
                  className={styles['files-upload-button']}
                  disabled={actionDisabled}
                  icon={<Upload size={16} aria-hidden="true" />}
                  onClick={() => void pickFiles()}
                >
                  {t('files.uploadFiles')}
                </Button>
                <Button
                  type="text"
                  className={styles['files-command-button']}
                  disabled={actionDisabled}
                  icon={<FolderPlus size={15} aria-hidden="true" />}
                  onClick={openCreateDirectory}
                >
                  {t('files.newFolder')}
                </Button>
                <Button
                  type="text"
                  className={`${styles['files-command-button']} ${styles['is-low-priority']}`}
                  disabled={actionDisabled}
                  icon={<Clipboard size={15} aria-hidden="true" />}
                  onClick={() => void pasteFromClipboard()}
                >
                  {t('files.paste')}
                </Button>
                <Dropdown
                  menu={moreActions}
                  trigger={['click']}
                  popupRender={renderFilesRowMenu}
                  classNames={{ root: styles['files-row-menu'] }}
                >
                  <Button
                    type="text"
                    className={styles['files-chrome-button']}
                    disabled={actionDisabled}
                    aria-label={t('files.actions')}
                    icon={<MoreHorizontal size={16} aria-hidden="true" />}
                  />
                </Dropdown>
              </>
            )}
          </div>
          <div className={styles['files-command-secondary']}>
            {selectedPaths.length > 0 ? (
              <>
                <Button
                  type="text"
                  danger
                  className={`${styles['files-command-button']} ${styles['files-delete-command']}`}
                  disabled={!fileActionsEnabled}
                  icon={<Trash2 size={15} aria-hidden="true" />}
                  onClick={() => confirmDelete()}
                >
                  {t('app.delete')}
                </Button>
                <span className={styles['files-command-divider']} aria-hidden="true" />
              </>
            ) : null}
            <div className={styles['files-view-actions']} role="group" aria-label={t('files.workspacePanels')}>
              <Tooltip title={t('files.details')}>
                <Button
                  ref={inspectorToggleRef}
                  type="text"
                  className={`${styles['files-workspace-toggle']} ${inspectorOpen ? styles['is-active'] : ''}`}
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
                  <span className={styles['files-workspace-toggle-label']}>{t('files.details')}</span>
                </Button>
              </Tooltip>
              <Tooltip title={t('files.transfers')}>
                <Button
                  ref={transferToggleRef}
                  type="text"
                  className={`${styles['files-workspace-toggle']} ${styles['files-transfer-toggle']} ${transfersOpen ? styles['is-active'] : ''}`}
                  disabled={localDownloadOperationActive}
                  aria-label={t('files.transfers')}
                  aria-pressed={transfersOpen}
                  aria-controls="files-bottom-drawer"
                  aria-expanded={transfersOpen}
                  icon={<Activity size={15} aria-hidden="true" />}
                  onClick={() => {
                    if (localDownloadOperationSourcesRef.current.size > 0) {
                      return
                    }
                    lastTransferTriggerRef.current = transferToggleRef.current
                    if (transfersOpen && transferScope === 'session') {
                      closeTransfers()
                    } else {
                       setTransferScope('session')
                       setAuxiliarySurface('transfers')
                       if (
                         sidePanelModeRef.current === 'bookmarks'
                         || window.innerWidth < 1280
                       ) {
                         updateSidePanelMode('none')
                       }
                    }
                  }}
                >
                  <span className={styles['files-workspace-toggle-label']}>{t('files.transfers')}</span>
                  {currentSessionActiveTransferCount > 0 ? (
                    <span className={styles['files-workspace-toggle-count']}>{currentSessionActiveTransferCount}</span>
                  ) : null}
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className={styles['files-canvas-row']}>
          <div
            ref={filesTableShellRef}
            className={styles['files-table-shell']}
            data-shortcut-adapter="files-page"
            tabIndex={activeFileSession ? 0 : -1}
            onPointerDown={() => {
              if (bookmarksExpanded && window.innerWidth < 1280) {
                closeBookmarksWorkbench('pointer')
              }
            }}
            onKeyDown={handleFileTableKeyDown}
          >
            {!activeFileSession ? (
              <div className={styles['files-workspace-empty']}>
                <span className={styles['files-workspace-empty-icon']}>
                  <Folder size={28} aria-hidden="true" />
                </span>
                <strong>{t('files.noFileSession')}</strong>
                <p>{t('files.noFileSessionHint')}</p>
                <Button
                  type="primary"
                  className={styles['files-upload-button']}
                  icon={<Plus size={16} aria-hidden="true" />}
                  onClick={onOpenFileSessionLauncher}
                >
                  {t('files.openFileSession')}
                </Button>
              </div>
            ) : activeFileSession.status !== 'connected' && !activeFileSessionHasCachedDirectory ? (
              <FileSessionProgress
                fileSession={activeFileSession}
                proxyRoute={activeFileSessionHost?.proxy_id
                  ? activeFileSessionHost.jump_host_id
                    ? 'jump'
                    : 'target'
                  : null}
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
              <div className={`${styles['files-workspace-empty']} ${styles['is-error']}`} role="alert">
                <span className={styles['files-workspace-empty-icon']}>
                  <XCircle size={28} aria-hidden="true" />
                </span>
                <strong>{t('files.directoryReadFailed')}</strong>
                <p>{workspaceViewState.error || t('app.error')}</p>
                <Button
                  className={`${uiStyles['secondary-button']} secondary-button`}
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
                  className={styles['files-table']}
                  onChange={handleTableChange}
                  rowSelection={{
                    columnWidth: 38,
                    selectedRowKeys: selectedPaths,
                    getCheckboxProps: () => ({ disabled: !fileActionsEnabled }),
                    onChange: (keys) => {
                      if (!fileActionsEnabled) {
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
                    styles['files-table-row'],
                    entry.kind === 'directory' ? styles['is-directory'] : '',
                    workspaceViewState.focusedPath === entry.path ? 'is-focused' : '',
                    dropTargetDirectoryPath === entry.path || remoteMoveTargetPath === entry.path ? styles['is-drop-target'] : '',
                    remoteMoveTargetPath === entry.path ? styles['is-move-target'] : '',
                    remoteMoveDrag?.paths.includes(entry.path) ? styles['is-being-dragged'] : '',
                  ].filter(Boolean).join(' ')}
                  onRow={(entry) => ({
                    'data-files-table-row': '',
                    'data-files-entry-kind': entry.kind,
                    tabIndex: workspaceViewState.focusedPath === entry.path ? 0 : -1,
                    draggable: fileActionsEnabled && !loading,
                    onFocus: () => focusEntry(entry),
                    onClick: (event) => {
                      const target = event.target instanceof Element ? event.target : null
                      if (
                        target?.closest(
                          '.ant-checkbox, .ant-checkbox-wrapper, button, a, input, '
                          + '[role="button"], [role="menuitem"], [contenteditable="true"]',
                        )
                      ) {
                        return
                      }
                      if (
                        entry.kind === 'directory'
                        && target?.closest('[data-files-entry-open]')
                      ) {
                        enterEntry(entry)
                        return
                      }
                      if (fileActionsEnabled) {
                        selectEntry(entry, {
                          ctrlKey: event.ctrlKey,
                          metaKey: event.metaKey,
                          shiftKey: event.shiftKey,
                        })
                        const opensInspector = (
                          target?.closest('[data-files-name-cell]')
                          && !target.closest('[data-files-entry-open]')
                        )
                        if (
                          opensInspector
                          && !event.ctrlKey
                          && !event.metaKey
                          && !event.shiftKey
                        ) {
                          openInspector()
                        }
                      }
                    },
                    onDoubleClick: () => enterEntry(entry),
                    onContextMenu: (event) => {
                      event.preventDefault()
                      if (!fileActionsEnabled || loading) {
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
            {fileContextMenu?.fileSessionId === activeFileSessionId && fileActionsEnabled ? (
              <Dropdown
                open
                trigger={[]}
                placement="bottomLeft"
                menu={fileRowMenuProps(fileContextMenu.entry)}
                popupRender={renderFilesRowMenu}
                classNames={{ root: styles['files-row-menu'] }}
                onOpenChange={(open) => {
                  if (!open) {
                    setFileContextMenu(null)
                  }
                }}
              >
                <span
                  className={styles['files-context-menu-anchor']}
                  style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
                />
              </Dropdown>
            ) : null}
          </div>

          {sidePanelMode !== 'none' ? (
            <FilesSidePanel
              ref={sidePanelRef}
              id={sidePanelMode === 'bookmarks'
                ? 'files-bookmarks-workbench'
                : 'files-details-panel'}
              mode={sidePanelMode}
              width={layoutPreferences.sidePanelWidth}
              ariaLabel={sidePanelMode === 'bookmarks'
                ? t('files.bookmarkPanelLabel')
                : t('files.details')}
              resizeLabel={t('files.resizeSidePanel')}
              closeOnEscape={sidePanelMode === 'details'}
              onWidthChange={(width) => {
                setLayoutPreferences((current) => ({
                  ...current,
                  sidePanelWidth: width,
                }))
              }}
              onRequestClose={sidePanelMode === 'bookmarks'
                ? () => closeBookmarksWorkbench('dismiss')
                : closeInspector}
            >
              {sidePanelMode === 'bookmarks' ? (
                <FileBookmarksSidebar
                  bookmarks={data.fileBookmarks}
                  groups={data.fileBookmarkGroups}
                  currentPath={currentPath}
                  connected={fileSessionConnected}
                  open
                  mutationPending={bookmarkMutationPending}
                  navigationKey={`${activeFileSessionId}:${activeFileSession?.connection_generation ?? 0}`}
                  panelId="files-bookmarks-workbench"
                  onNavigate={loadBookmarkDirectory}
                  onCreateBookmark={createFileBookmark}
                  onUpdateBookmark={updateFileBookmark}
                  onDeleteBookmark={deleteFileBookmark}
                  onReorderBookmarks={reorderFileBookmarks}
                  onCreateGroup={createFileBookmarkGroup}
                  onUpdateGroup={updateFileBookmarkGroup}
                  onDeleteGroup={deleteFileBookmarkGroup}
                  onReorderGroups={reorderFileBookmarkGroups}
                  onRequestClose={closeBookmarksWorkbench}
                />
              ) : (
                <>
                  <header className={styles['files-panel-heading']}>
                    <span>
                      <Info size={15} aria-hidden="true" />
                      {t('files.details')}
                    </span>
                    <Button
                      type="text"
                      className={styles['files-chrome-button']}
                      aria-label={t('app.close')}
                      icon={<X size={15} aria-hidden="true" />}
                      onClick={closeInspector}
                    />
                  </header>
                  <FileDetailPanel
                    host={activeFileSessionHost}
                    entry={activeEntry}
                    connected={fileActionsEnabled}
                    onEditPermissions={openPermissions}
                  />
                </>
              )}
            </FilesSidePanel>
          ) : null}
        </div>

        <FilesBottomDrawer
          id="files-bottom-drawer"
          open={transfersOpen || localConsoleOpen}
          height={layoutPreferences.bottomDrawerHeight}
          minimumContentHeight={200}
          ariaLabel={transfersOpen ? t('files.transfers') : t('files.localMappings')}
          resizeLabel={t('files.resizeBottomDrawer')}
          className={transfersOpen ? 'is-transfer-content' : localConsoleOpen ? 'is-local-content' : undefined}
          autoFocusOnOpen={transfersOpen}
          onHeightChange={(height) => {
            setLayoutPreferences((current) => ({ ...current, bottomDrawerHeight: height }))
          }}
          onEscape={transfersOpen
            ? closeTransfers
            : localConsoleOpen
              ? () => {
                  setDownloadDestinationRequest(null)
                  closeLocalConsole()
                }
              : undefined}
        >
          {transfersOpen ? (
            <TransferQueueDock className={styles['files-transfer-dock']}>
              <header className={`${styles['files-panel-heading']} ${styles['files-transfer-heading']}`}>
                <span>
                  <Activity size={15} aria-hidden="true" />
                  {t('files.transfers')}
                </span>
                <div className={styles['files-transfer-scope']} role="group" aria-label={t('files.transferScope')}>
                  <button
                    type="button"
                    aria-pressed={transferScope === 'session'}
                    className={transferScope === 'session' ? styles['is-active'] : ''}
                    onClick={() => setTransferScope('session')}
                  >
                    {t('files.currentSession')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={transferScope === 'all'}
                    className={transferScope === 'all' ? styles['is-active'] : ''}
                    onClick={() => setTransferScope('all')}
                  >
                    {t('files.allSessions')}
                  </button>
                </div>
                <Button
                  type="text"
                  className={styles['files-chrome-button']}
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
            </TransferQueueDock>
          ) : null}

          <LocalDownloadConsole
            api={api}
            open={localConsoleOpen}
            mappings={data.localPathMappings}
            session={localDownloadSession}
            selection={localDownloadSelection}
            preferredTarget={effectiveLocalDownloadTarget ? {
              mappingId: effectiveLocalDownloadTarget.mappingId,
              path: effectiveLocalDownloadTarget.path,
            } : null}
            refreshRequests={localRefreshRequests}
            operationBlocked={
              localDownloadOperationActive
              && !(
                localDownloadOperationSourcesRef.current.size === 1
                && localDownloadOperationSourcesRef.current.has('console')
              )
            }
            onClose={() => {
              setDownloadDestinationRequest(null)
              closeLocalConsole()
            }}
            onDownload={downloadToLocalTarget}
            onDropActiveChange={handleLocalConsoleDropActiveChange}
            onOperationActiveChange={handleLocalConsoleOperationActiveChange}
            onTargetChange={setLocalDownloadTarget}
            onCreateMapping={onCreateLocalPathMapping}
            onUpdateMapping={onUpdateLocalPathMapping}
            onDeleteMapping={onDeleteLocalPathMapping}
            onReorderMappings={onReorderLocalPathMappings}
          />
        </FilesBottomDrawer>

        <footer className={styles['files-status-bar']}>
          <div className={styles['files-status-overview']}>
            <span className={styles['files-status-count']}>
              {t('files.itemCount', { count: entries.length })}
              {selectedPaths.length > 0 ? ` · ${t('files.selectedCount', { count: selectedPaths.length })}` : ''}
            </span>
            <span className={`${styles['files-status-connection']} ${styles[`is-${connectionStatusKey}`]}`}>
              <i aria-hidden="true" />
              {activeFileSession
                ? `${activeFileSessionHost?.name ?? shortId(activeFileSession.id)} · ${t(`files.sessionStatus.${connectionStatusKey}`)}`
                : t('files.noFileSession')}
            </span>
          </div>
          <div className={styles['files-status-actions']}>
            <LocalDownloadQuickTarget
              ref={localConsoleToggleRef}
              api={api}
              target={effectiveLocalDownloadTarget}
              session={localDownloadSession}
              expanded={localConsoleOpen}
              disabled={
                localDownloadOperationActive
                && !(
                  localDownloadOperationSourcesRef.current.size === 1
                  && localDownloadOperationSourcesRef.current.has('quick-target')
                )
              }
              onOpen={() => {
                if (localDownloadOperationSourcesRef.current.size > 0) {
                  return
                }
                if (localConsoleOpen) {
                  closeLocalConsole()
                  return
                }
                setDownloadDestinationRequest(null)
                openLocalConsole()
              }}
              onDownload={downloadToLocalTarget}
              onDropActiveChange={handleLocalQuickTargetDropActiveChange}
              onOperationActiveChange={handleLocalQuickTargetOperationActiveChange}
            />
            <button
              type="button"
              className={`${styles['files-transfer-summary']} ${activeTransferCount > 0 ? styles['is-active'] : ''}`}
              disabled={localDownloadOperationActive}
              aria-label={activeTransferCount > 0
                ? t('files.activeTransferCount', { count: activeTransferCount })
                : t('files.transfers')}
              aria-controls="files-bottom-drawer"
              aria-expanded={transfersOpen}
              onClick={(event) => {
                if (localDownloadOperationSourcesRef.current.size > 0) {
                  return
                }
                lastTransferTriggerRef.current = event.currentTarget
                if (transfersOpen && transferScope === 'all') {
                  closeTransfers()
                } else {
                   setTransferScope('all')
                   setAuxiliarySurface('transfers')
                   if (
                     sidePanelModeRef.current === 'bookmarks'
                     || window.innerWidth < 1280
                   ) {
                     updateSidePanelMode('none')
                   }
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
          </div>
        </footer>
      </main>

      {(dragActive || remoteMoveDrag) && !localDownloadDropActive ? (
        <div
          className={`${styles['files-drop-mask']} ${remoteMoveDrag ? styles['is-move'] : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className={styles['files-drop-mask-icon']} aria-hidden="true">
            {remoteMoveDrag ? <FolderDown size={17} /> : <Upload size={17} />}
          </span>
          <span className={styles['files-drop-mask-copy']}>
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
            closing={activeFileSessionClosing}
            fileSessionId={textEditorTarget.fileSessionId}
            connectionGeneration={activeFileSession?.connection_generation ?? 0}
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
            className={`${styles['files-workspace-breadcrumb-link']} ${current ? styles['is-current'] : ''} ${
              index === 0 ? styles['is-root'] : ''
            } ${
              dropTarget ? styles['is-drop-target'] : ''
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
      className={styles['files-workspace-breadcrumb']}
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
          className={styles['files-table-column-resizer']}
          data-files-drag-block
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
    <div className={styles['files-directory-skeleton']} role="status" aria-label={label}>
      <div className={styles['files-directory-skeleton-head']} />
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className={styles['files-directory-skeleton-row']}>
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
    <section className={styles['files-detail-panel']}>
      {entry ? (
        <>
          <div className={styles['files-detail-hero']}>
            <span className={`${styles['files-detail-kind-icon']} ${entry.kind === 'directory' ? styles['is-directory'] : ''}`}>
              {entry.kind === 'directory' ? <Folder size={19} aria-hidden="true" /> : <File size={19} aria-hidden="true" />}
            </span>
            <div className={styles['files-detail-hero-copy']}>
              <strong>{entry.name}</strong>
              <span>{host ? host.name : t('files.noHost')}</span>
            </div>
          </div>
          <dl className={styles['files-detail-list']}>
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
              <dd className={styles['files-permission-detail']}>
                {renderFileDetailValue(formatPermission(entry))}
                <Tooltip title={connected ? null : t('files.connectionRequired')}>
                  <Button
                    type="text"
                    size="small"
                    className={styles['files-inline-action']}
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
        <div className={styles['files-quiet-empty']}>
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
      classNames={{ root: styles['file-detail-tooltip'] }}
    >
      <span className={styles['files-detail-value']}>{display}</span>
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
      className={`${styles['files-session-cache-overlay']} ${recovering || closing ? styles['is-recovering'] : ''}`}
      role={terminal && !recovering && !closing ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className={styles['files-session-cache-overlay-icon']} aria-hidden="true">
        {recovering || closing ? <CircleDashed size={16} /> : <XCircle size={16} />}
      </span>
      <span className={styles['files-session-cache-overlay-copy']}>
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </span>
      {showRecoveryAction ? (
        <Button
          className={`${uiStyles['secondary-button']} secondary-button`}
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
  proxyRoute,
  closing,
  recovering,
  onRecover,
}: {
  fileSession: FileSession
  proxyRoute: 'target' | 'jump' | null
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
  const phaseLabel = proxyRoute && phase === 'dialing'
    ? t(proxyRoute === 'jump'
      ? 'connection.proxyDialingJumpHost'
      : 'connection.proxyDialingTarget')
    : t(`files.sessionPhase.${phase}`)

  if (closing || terminal) {
    const copy = fileSessionRecoveryStatusCopy(fileSession, recovering, closing, t)

    return (
      <div className={`${styles['files-session-progress']} ${styles['is-terminal']}`} role="status" aria-live="polite">
        <div className={`${styles['files-session-terminal-icon']} ${recovering || closing ? styles['is-recovering'] : ''}`}>
          {recovering || closing ? <CircleDashed size={22} aria-hidden="true" /> : <XCircle size={22} aria-hidden="true" />}
        </div>
        <div className={styles['files-session-terminal-copy']}>
          <strong>{copy.title}</strong>
          <span>{copy.detail}</span>
        </div>
        {!closing && canRecoverFileSession(fileSession) ? (
          <Button
            className={`${uiStyles['secondary-button']} secondary-button`}
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
    <div className={styles['files-session-progress']} role="status" aria-live="polite">
      <div className={`${styles['connection-progress-head']} connection-progress-head`}>
        <span>{phaseLabel}</span>
        <strong>{progress}%</strong>
      </div>
      <div
        className={`${styles['connection-progress-bar']} connection-progress-bar`}
        role="progressbar"
        aria-label={phaseLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className={`${styles['connection-phase-row']} ${styles['files-session-phase-row']} connection-phase-row`}>
        {phaseOrder.map((item, index) => {
          const state = fileSessionPhaseState(fileSession, index, currentIndex)
          const Icon = state === 'done' ? CheckCircle2 : state === 'failed' ? XCircle : state === 'active' ? CircleDashed : Circle
          return (
            <span
              key={item}
              className={`${styles['connection-phase']} ${
                state === 'active'
                  ? styles['connection-phase-active']
                  : state === 'done'
                    ? styles['connection-phase-done']
                    : state === 'failed'
                      ? styles['connection-phase-failed']
                      : ''
              } connection-phase is-${state}`}
              title={t(`files.sessionPhase.${item}`)}
            >
              <Icon size={13} aria-hidden="true" />
              <span>{t(`files.sessionPhaseShort.${item}`)}</span>
            </span>
          )
        })}
      </div>
      <div className={styles['files-session-progress-footer']}>
        <span>{t(`files.sessionStatus.${fileSession.status}`)}</span>
        {recovering ? (
          <Button
            className={`${uiStyles['secondary-button']} secondary-button`}
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
