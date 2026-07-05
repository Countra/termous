import { App as AntdApp, Breadcrumb, Button, Checkbox, Dropdown, Empty, Input, Modal, Segmented, Table, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeft,
  ChevronLeft,
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
  Pencil,
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
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { HostContextPanel } from '../../components/hosts/HostContextPanel'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import { EmptyState } from '../../components/ui/EmptyState'
import { FeatureSidePanel } from '../../components/ui/FeatureSidePanel'
import { SessionTabButton } from '../../components/ui/SessionTabButton'
import { usePersistentBooleanState } from '../../hooks/usePersistentBooleanState'
import { usePersistentJsonState } from '../../hooks/usePersistentJsonState'
import { useRafResizablePanelWidth } from '../../hooks/useRafResizablePanelWidth'
import type {
  AppData,
  FileSession,
  FileSessionHostKey,
  FileSessionPhase,
  Host,
  LocalGrantSource,
  RemoteDirectoryListing,
  RemoteFileEntry,
  TransferTask,
} from '../../types/domain'
import { fileSortValue, formatBytes, formatDate, joinPath, normalizeRemotePath, parentPath } from './fileUtils'
import { TransferQueuePanel } from './TransferQueuePanel'
import { useTransferQueue } from './useTransferQueue'

interface FilesPageProps {
  api: TermousApi
  data: AppData
  selectedHostId: string
  activeFileSession: FileSession | null
  onSelectHost: (hostId: string) => void
  onConnectFileSession: (hostId: string) => Promise<FileSession>
  onSelectFileSession: (fileSessionId: string) => void
  onCloseFileSession: (fileSessionId: string) => Promise<void>
  onReconnectFileSession: (fileSessionId: string) => Promise<FileSession>
  onTrustFileSessionHost: (fileSessionId: string, decision: 'trust' | 'replace' | 'reject', fingerprintSHA256: string) => Promise<FileSession>
  onUpdateFileSession: (fileSession: FileSession) => void
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

type FileSideTabKey = 'details' | 'transfers'

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

export function FilesPage({
  api,
  data,
  selectedHostId,
  activeFileSession,
  onSelectHost,
  onConnectFileSession,
  onSelectFileSession,
  onCloseFileSession,
  onReconnectFileSession,
  onTrustFileSessionHost,
  onUpdateFileSession,
}: FilesPageProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const filesPageRef = useRef<HTMLElement>(null)
  const fileTabViewportRef = useRef<HTMLDivElement>(null)
  const dragDepthRef = useRef(0)
  const uploadRefreshTasksRef = useRef(new Map<string, UploadRefreshTarget>())
  const lastSessionLoadKeyRef = useRef('')
  const lastActiveFileSessionIdRef = useRef('')
  const fileSessionSocketsRef = useRef(new Map<string, WebSocket>())
  const onUpdateFileSessionRef = useRef(onUpdateFileSession)
  const [currentPath, setCurrentPath] = useState('/')
  const [pathInput, setPathInput] = useState('/')
  const [entries, setEntries] = useState<RemoteFileEntry[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [activeEntry, setActiveEntry] = useState<RemoteFileEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null)
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [permissionEntry, setPermissionEntry] = useState<RemoteFileEntry | null>(null)
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [connectingHostIds, setConnectingHostIds] = useState<Set<string>>(() => new Set())
  const [activeHostKeyPromptKey, setActiveHostKeyPromptKey] = useState('')
  const [tabScrollState, setTabScrollState] = useState({ canScrollLeft: false, canScrollRight: false })
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
  const { transfers, connected, upsertTransfer } = useTransferQueue(api)
  const showTransferQueuePanel = () => {
    setDetailsCollapsed(false)
    setDetailsActiveTab('transfers')
  }
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const selectedHostIdStable = selectedHost?.id ?? ''
  const activeFileSessionHost = activeFileSession?.host_id ? data.hosts.find((host) => host.id === activeFileSession.host_id) : undefined
  const activeFileSessionId = activeFileSession?.id ?? ''
  const fileSessionConnected = activeFileSession?.status === 'connected'
  const fileSessionIds = useMemo(() => data.fileSessions.map((session) => session.id).join('|'), [data.fileSessions])
  const syncingFileSessionIds = useMemo(
    () =>
      data.fileSessions
        .filter((session) => session.status === 'connecting' || session.status === 'waiting_trust')
        .map((session) => session.id)
        .join('|'),
    [data.fileSessions],
  )
  const selectedHostConnecting = selectedHostIdStable ? connectingHostIds.has(selectedHostIdStable) : false

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.includes(entry.path)),
    [entries, selectedPaths],
  )
  const dropTargetDirectory = useMemo(
    () => entries.find((entry) => entry.kind === 'directory' && entry.path === dropTargetDirectoryPath) ?? null,
    [dropTargetDirectoryPath, entries],
  )

  const applyListing = useCallback((listing: RemoteDirectoryListing) => {
    setCurrentPath(listing.path)
    setPathInput(listing.path)
    setEntries([...listing.entries].sort((left, right) => fileSortValue(left).localeCompare(fileSortValue(right))))
    setSelectedPaths([])
    setActiveEntry(null)
    setDropTargetDirectoryPath(null)
    setError(null)
  }, [])

  useEffect(() => {
    onUpdateFileSessionRef.current = onUpdateFileSession
  }, [onUpdateFileSession])

  const loadDirectory = useCallback(
    async (nextPath: string) => {
      if (!activeFileSessionId || !fileSessionConnected) {
        setEntries([])
        return
      }
      const normalized = normalizeRemotePath(nextPath)
      setLoading(true)
      setError(null)
      try {
        const listing = await api.listFileSessionFiles(activeFileSessionId, normalized)
        applyListing(listing)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t('app.error'))
      } finally {
        setLoading(false)
      }
    },
    [activeFileSessionId, api, applyListing, fileSessionConnected, t],
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

  useEffect(() => {
    if (!activeFileSession) {
      lastSessionLoadKeyRef.current = ''
      lastActiveFileSessionIdRef.current = ''
      setCurrentPath('/')
      setPathInput('/')
      setEntries([])
      setSelectedPaths([])
      setActiveEntry(null)
      return
    }
    const nextPath = normalizeRemotePath(activeFileSession.current_path || '/')
    const sessionChanged = lastActiveFileSessionIdRef.current !== activeFileSession.id
    lastActiveFileSessionIdRef.current = activeFileSession.id
    setCurrentPath(nextPath)
    setPathInput(nextPath)
    if (sessionChanged) {
      setEntries([])
      setSelectedPaths([])
      setActiveEntry(null)
    }
    if (activeFileSession.status !== 'connected') {
      lastSessionLoadKeyRef.current = ''
      return
    }
    const loadKey = `${activeFileSession.id}:${activeFileSession.connected_at ?? ''}`
    if (lastSessionLoadKeyRef.current !== loadKey) {
      lastSessionLoadKeyRef.current = loadKey
      void loadDirectory(nextPath)
    }
  }, [activeFileSession, loadDirectory])

  useEffect(() => {
    transfers.forEach((task) => {
      if (isUploadTransfer(task) && isTransferActive(task) && task.file_session_id) {
        uploadRefreshTasksRef.current.set(task.id, {
          fileSessionId: task.file_session_id,
          targetPath: normalizeRemotePath(task.target_path || '/'),
        })
      }
    })

    const currentTargetPath = normalizeRemotePath(currentPath)
    const terminalTaskIds: string[] = []
    let hasCurrentCompletedUpload = false
    let hasCurrentActiveUpload = false

    uploadRefreshTasksRef.current.forEach((target, taskId) => {
      const task = transfers.find((item) => item.id === taskId)
      if (!task) {
        return
      }

      const isCurrentTarget = target.fileSessionId === activeFileSessionId && target.targetPath === currentTargetPath
      if (isCurrentTarget && isTransferActive(task)) {
        hasCurrentActiveUpload = true
      }
      if (isCurrentTarget && isTransferTerminal(task)) {
        hasCurrentCompletedUpload = true
      }
      if (isTransferTerminal(task)) {
        terminalTaskIds.push(taskId)
      }
    })

    terminalTaskIds.forEach((taskId) => {
      uploadRefreshTasksRef.current.delete(taskId)
    })

    if (fileSessionConnected && hasCurrentCompletedUpload && !hasCurrentActiveUpload) {
      void loadDirectory(currentTargetPath)
    }
  }, [activeFileSessionId, currentPath, fileSessionConnected, loadDirectory, transfers])

  useEffect(() => {
    const ids = new Set(fileSessionIds ? fileSessionIds.split('|') : [])
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
  }, [api, fileSessionIds])

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

  const hostKeyPromptQueue = useMemo(
    () =>
      data.fileSessions
        .filter((session) => session.status === 'waiting_trust' && session.host_key)
        .map((session) => ({
          session,
          hostKey: session.host_key as FileSessionHostKey,
          key: `${session.id}:${session.host_key?.reason ?? ''}:${session.host_key?.fingerprint_sha256 ?? ''}`,
        })),
    [data.fileSessions],
  )

  useEffect(() => {
    if (activeHostKeyPromptKey) {
      const stillPending = hostKeyPromptQueue.some((item) => item.key === activeHostKeyPromptKey)
      if (!stillPending) {
        setActiveHostKeyPromptKey('')
      }
      return
    }
    const pendingItem = hostKeyPromptQueue[0]
    const pendingSession = pendingItem?.session
    const hostKey = pendingItem?.hostKey
    if (!pendingSession || !hostKey) {
      return
    }
    const promptKey = pendingItem.key
    setActiveHostKeyPromptKey(promptKey)
    const clearPrompt = () => {
      setActiveHostKeyPromptKey((current) => (current === promptKey ? '' : current))
    }
    const changed = hostKey.reason === 'changed'
    modal.confirm({
      title: changed ? t('files.hostKeyChangedTitle') : t('files.trustHostTitle'),
      okText: changed ? t('files.replaceHostKey') : t('files.trustAndRetry'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: changed },
      centered: true,
      className: 'termous-modal',
      content: <HostKeyDialog hostKey={hostKey} changed={changed} />,
      onOk: async () => {
        const next = await onTrustFileSessionHost(
          pendingSession.id,
          changed ? 'replace' : 'trust',
          hostKey.fingerprint_sha256,
        )
        onUpdateFileSession(next)
        clearPrompt()
      },
      onCancel: () => {
        void onTrustFileSessionHost(pendingSession.id, 'reject', hostKey.fingerprint_sha256)
          .then(onUpdateFileSession)
          .catch(() => undefined)
          .finally(clearPrompt)
      },
    })
  }, [activeHostKeyPromptKey, hostKeyPromptQueue, modal, onTrustFileSessionHost, onUpdateFileSession, t])

  const updateTabScrollState = useCallback(() => {
    const viewport = fileTabViewportRef.current
    if (!viewport) {
      setTabScrollState({ canScrollLeft: false, canScrollRight: false })
      return
    }
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth
    setTabScrollState({
      canScrollLeft: viewport.scrollLeft > 1,
      canScrollRight: viewport.scrollLeft < maxScrollLeft - 1,
    })
  }, [])

  const scrollFileTabs = useCallback((direction: 'left' | 'right') => {
    const viewport = fileTabViewportRef.current
    if (!viewport) {
      return
    }
    viewport.scrollBy({ left: direction === 'left' ? -220 : 220, behavior: 'smooth' })
    window.setTimeout(updateTabScrollState, 180)
  }, [updateTabScrollState])

  const handleFileTabWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const viewport = fileTabViewportRef.current
    if (!viewport || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return
    }
    event.preventDefault()
    viewport.scrollLeft += event.deltaY
    updateTabScrollState()
  }, [updateTabScrollState])

  const closeFileSessionTab = useCallback(
    (fileSessionId: string) => {
      void onCloseFileSession(fileSessionId)
    },
    [onCloseFileSession],
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

  useEffect(() => {
    const viewport = fileTabViewportRef.current
    if (!viewport) {
      return undefined
    }
    const observer = new ResizeObserver(updateTabScrollState)
    observer.observe(viewport)
    viewport.addEventListener('scroll', updateTabScrollState, { passive: true })
    updateTabScrollState()
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', updateTabScrollState)
    }
  }, [fileSessionIds, updateTabScrollState])

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
    await runFileAction(async () => {
      const grant = await api.createLocalFileGrant(source, paths)
      const task = await api.createFileSessionUploadTransfer(activeFileSessionId, grant.id, targetPath, 'rename')
      trackUploadRefreshTask(task)
      showTransferQueuePanel()
      upsertTransfer(task)
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
    await runFileAction(async () => {
      const task = await api.createFileSessionDownloadTransfer(activeFileSessionId, paths, localDir, 'rename')
      showTransferQueuePanel()
      upsertTransfer(task)
    }, t('files.transferCreated'))
  }

  const downloadSelected = () => downloadPaths(selectedPaths)

  const pasteRemoteClipboard = async () => {
    if (!remoteClipboard || !activeFileSession || remoteClipboard.hostId !== activeFileSession.host_id) {
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
    if (!entry) {
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

  const applyPermissions = async (entry: RemoteFileEntry, mode: string) => {
    if (!activeFileSessionId) {
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
    if (!activeFileSessionId || paths.length === 0) {
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
    if (selectedPaths.length === 0 || !activeFileSession) {
      return
    }
    setRemoteClipboard({ mode, hostId: activeFileSession.host_id, paths: selectedPaths })
    notification.success({ title: mode === 'cut' ? t('files.cutReady') : t('files.copyReady'), duration: 2 })
  }

  const enterEntry = (entry: RemoteFileEntry) => {
    setActiveEntry(entry)
    if (entry.kind === 'directory') {
      void loadDirectory(entry.path)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return
    }
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      copySelected('copy')
    } else if (mod && event.key.toLowerCase() === 'x') {
      event.preventDefault()
      copySelected('cut')
    } else if (mod && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      void pasteFromClipboard()
    } else if (event.key === 'Delete') {
      event.preventDefault()
      confirmDelete()
    } else if (event.key === 'F2') {
      event.preventDefault()
      openRename()
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      void loadDirectory(parentPath(currentPath))
    }
  }

  const hasDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files')

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

  const resetDragState = () => {
    dragDepthRef.current = 0
    setDragActive(false)
    setDropTargetDirectoryPath(null)
  }

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = fileSessionConnected ? 'copy' : 'none'
    setDragActive(true)
    setDropTargetDirectoryPath(fileSessionConnected ? findDirectoryDropTargetPath(event.target) : null)
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setDragActive(false)
    }
  }

  const onDrop = async (event: DragEvent<HTMLElement>) => {
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

  const actionDisabled = !fileSessionConnected || loading
  const rowMenu = (): MenuProps['items'] => [
    { key: 'download', icon: <Download size={14} />, label: t('files.download') },
    { key: 'copy', icon: <Copy size={14} />, label: t('files.copy') },
    { key: 'cut', icon: <Scissors size={14} />, label: t('files.cut') },
    { key: 'permissions', icon: <ShieldCheck size={14} />, label: t('files.editPermissions') },
    { key: 'rename', icon: <Pencil size={14} />, label: t('files.rename') },
    { type: 'divider' },
    { key: 'delete', danger: true, icon: <Trash2 size={14} />, label: t('app.delete') },
  ]

  const columns = [
    {
      title: t('files.name'),
      dataIndex: 'name',
      width: 220,
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
              <Tooltip title={fullName} placement="topLeft" mouseEnterDelay={0.35} overlayClassName="file-name-tooltip">
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
              <Tooltip title={fullName} placement="topLeft" mouseEnterDelay={0.35} overlayClassName="file-name-tooltip">
                <span className="file-name-copy">{nameCopy}</span>
              </Tooltip>
            )}
          </span>
        )
      },
    },
    { title: t('files.size'), dataIndex: 'size', width: 96, render: (value: number, entry: RemoteFileEntry) => entry.kind === 'directory' ? '-' : formatBytes(value) },
    { title: t('files.modified'), dataIndex: 'modified_at', width: 154, render: (value: string) => formatDate(value) },
    {
      title: t('files.permissions'),
      dataIndex: 'permissions',
      width: 104,
      render: (value: string, entry: RemoteFileEntry) => entry.permission_octal || value || '-',
    },
    {
      title: '',
      width: 44,
      render: (_: unknown, entry: RemoteFileEntry) => (
        <Dropdown
          menu={{
            items: rowMenu(),
            onClick: ({ key }) => {
              setSelectedPaths([entry.path])
              if (key === 'download') void downloadPaths([entry.path])
              if (key === 'copy' && activeFileSession) setRemoteClipboard({ mode: 'copy', hostId: activeFileSession.host_id, paths: [entry.path] })
              if (key === 'cut' && activeFileSession) setRemoteClipboard({ mode: 'cut', hostId: activeFileSession.host_id, paths: [entry.path] })
              if (key === 'permissions') openPermissions(entry)
              if (key === 'rename') openRename(entry)
              if (key === 'delete') confirmDelete([entry.path])
            },
          }}
          trigger={['click', 'contextMenu']}
          overlayClassName="files-row-menu"
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
      } ${dragActive ? 'is-dragging' : ''}`}
      style={filesPageStyle}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={resetDragState}
      onDrop={(event) => void onDrop(event)}
    >
      <HostContextPanel
        hosts={data.hosts}
        groups={data.groups}
        selectedHostId={selectedHostIdStable}
        collapsed={hostPanelCollapsed}
        collapsedTitle={t('nav.files')}
        emptyDescription={t('files.noHostHint')}
        searchPlaceholder={t('files.hostSearch')}
        className="files-host-context-panel"
        resizing={hostPanelResize.resizing}
        onToggleCollapsed={() => setHostPanelCollapsed((current) => !current)}
        onResizePointerDown={hostPanelResize.beginResize}
        getHostIconUrl={(iconId) => api.hostIconFileUrl(iconId)}
        onSelectHost={onSelectHost}
      />

      <main className="files-main-panel">
        <div className="files-session-toolbar">
          <div className="session-tabs-shell files-session-tabs-shell">
            <Tooltip title={t('workbench.scrollTabsLeft')}>
              <Button
                type="text"
                className="session-scroll-button"
                aria-label={t('workbench.scrollTabsLeft')}
                disabled={!tabScrollState.canScrollLeft}
                icon={<ChevronLeft size={15} />}
                onClick={() => scrollFileTabs('left')}
              />
            </Tooltip>
            <div
              ref={fileTabViewportRef}
              className={`session-tabs files-session-tabs ${tabScrollState.canScrollLeft ? 'has-left-overflow' : ''} ${
                tabScrollState.canScrollRight ? 'has-right-overflow' : ''
              }`}
              role="tablist"
              aria-label={t('files.sessions')}
              onWheel={handleFileTabWheel}
            >
              {data.fileSessions.length === 0 ? (
                <SessionTabButton empty role="tab" icon={<Folder size={15} />} label={t('files.noFileSession')} />
              ) : (
                  data.fileSessions.map((fileSession) => {
                    const host = data.hosts.find((item) => item.id === fileSession.host_id)
                    return (
                      <SessionTabButton
                        key={fileSession.id}
                        active={fileSession.id === activeFileSessionId}
                        role="tab"
                        aria-selected={fileSession.id === activeFileSessionId}
                        onClick={() => onSelectFileSession(fileSession.id)}
                        onMouseDown={(event) => {
                          if (event.button === 1) {
                            event.preventDefault()
                          }
                        }}
                        onAuxClick={(event) => closeFileSessionFromTab(event, fileSession.id)}
                        icon={<Folder size={15} />}
                        label={host?.name ?? shortId(fileSession.id)}
                        status={fileSession.status}
                        closeLabel={`${t('app.close')} ${host?.name ?? shortId(fileSession.id)}`}
                        onClose={() => closeFileSessionTab(fileSession.id)}
                      />
                    )
                  })
              )}
            </div>
            <Tooltip title={t('workbench.scrollTabsRight')}>
              <Button
                type="text"
                className="session-scroll-button"
                aria-label={t('workbench.scrollTabsRight')}
                disabled={!tabScrollState.canScrollRight}
                icon={<ChevronRight size={15} />}
                onClick={() => scrollFileTabs('right')}
              />
            </Tooltip>
          </div>
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
            <PathTrail path={currentPath} onNavigate={(path) => void loadDirectory(path)} />
            <Input.Search
              id="files-path-input"
              name="files-path-input"
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
              disabled={selectedPaths.length === 0}
              icon={<Download size={15} />}
              onClick={() => void downloadSelected()}
            >
              {t('files.download')}
            </Button>
            <Button className="secondary-button" disabled={selectedPaths.length === 0} icon={<Copy size={15} />} onClick={() => copySelected('copy')}>
              {t('files.copy')}
            </Button>
            <Button className="secondary-button" disabled={selectedPaths.length === 0} icon={<Scissors size={15} />} onClick={() => copySelected('cut')}>
              {t('files.cut')}
            </Button>
            <Button className="secondary-button" disabled={actionDisabled} icon={<Clipboard size={15} />} onClick={() => void pasteFromClipboard()}>
              {t('files.paste')}
            </Button>
            <Button
              className="secondary-button"
              disabled={actionDisabled || selectedPaths.length !== 1}
              icon={<ShieldCheck size={15} />}
              onClick={() => openPermissions()}
            >
              {t('files.editPermissions')}
            </Button>
            <Button className="secondary-button" disabled={selectedPaths.length !== 1} icon={<Pencil size={15} />} onClick={() => openRename()}>
              {t('files.rename')}
            </Button>
            <Button className="danger-button" disabled={selectedPaths.length === 0} icon={<Trash2 size={15} />} onClick={() => confirmDelete()}>
              {t('app.delete')}
            </Button>
          </div>
        </div>

        {error ? <div className="files-error">{error}</div> : null}
        <div className="files-table-shell">
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
              size="middle"
              className="files-table"
              rowSelection={{
                selectedRowKeys: selectedPaths,
                onChange: (keys) => setSelectedPaths(keys.map(String)),
              }}
              rowClassName={(entry) => `files-table-row is-${entry.kind}${dropTargetDirectoryPath === entry.path ? ' is-drop-target' : ''}`}
              onRow={(entry) => ({
                onClick: () => setActiveEntry(entry),
                onDoubleClick: () => enterEntry(entry),
              })}
              locale={{ emptyText: <EmptyState title={t('files.emptyDirectory')} description={t('files.emptyDirectoryHint')} /> }}
            />
          )}
        </div>
        {dragActive ? (
          <div className="files-drop-mask">
            {dropTargetDirectory
              ? t('files.dropUploadToDirectory', { name: dropTargetDirectory.name })
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
                connected={connected}
                onCancel={(id) => api.deleteTransfer(id)}
                onRetry={async (id) => {
                  const task = await api.retryTransfer(id)
                  upsertTransfer(task)
                }}
              />
            ),
          },
        ]}
      />
      <PermissionEditorModal
        entry={permissionEntry}
        open={Boolean(permissionEntry)}
        saving={permissionSaving}
        onCancel={() => setPermissionEntry(null)}
        onSubmit={(entry, mode) => void applyPermissions(entry, mode)}
      />
    </section>
  )
}

function PathTrail({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const parts = normalizeRemotePath(path).split('/').filter(Boolean)
  const crumbs = [{ label: '/', path: '/' }]
  parts.forEach((part, index) => {
    crumbs.push({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` })
  })
  const items = crumbs.map((crumb, index) => {
    const current = index === crumbs.length - 1
    return {
      key: crumb.path,
      title: (
        <button
          type="button"
          className={`files-breadcrumb-link ${current ? 'is-current' : ''} ${index === 0 ? 'is-root' : ''}`}
          aria-current={current ? 'page' : undefined}
          onClick={() => onNavigate(crumb.path)}
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
  return value === 'transfers' ? 'transfers' : 'details'
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
              <dd>{entry.path}</dd>
            </div>
            <div>
              <dt>{t('files.kind')}</dt>
              <dd>{t(`files.kindName.${entry.kind}`)}</dd>
            </div>
            <div>
              <dt>{t('files.size')}</dt>
              <dd>{entry.kind === 'directory' ? '-' : formatBytes(entry.size)}</dd>
            </div>
            <div>
              <dt>{t('files.modified')}</dt>
              <dd>{formatDate(entry.modified_at)}</dd>
            </div>
            <div>
              <dt>{t('files.permissions')}</dt>
              <dd className="files-permission-detail">
                <span>{formatPermission(entry)}</span>
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

type PermissionEditorMode = 'visual' | 'numeric'
type PermissionRole = 'owner' | 'group' | 'others'
type PermissionAction = 'read' | 'write' | 'execute'
type PermissionBits = Record<PermissionRole, Record<PermissionAction, boolean>>

const permissionRoles: PermissionRole[] = ['owner', 'group', 'others']
const permissionActions: PermissionAction[] = ['read', 'write', 'execute']
const permissionActionValues: Record<PermissionAction, number> = {
  read: 4,
  write: 2,
  execute: 1,
}

function PermissionEditorModal({
  entry,
  open,
  saving,
  onCancel,
  onSubmit,
}: {
  entry: RemoteFileEntry | null
  open: boolean
  saving: boolean
  onCancel: () => void
  onSubmit: (entry: RemoteFileEntry, mode: string) => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PermissionEditorMode>('visual')
  const [octal, setOctal] = useState('644')
  const valid = isPermissionOctal(octal)
  const bits = useMemo(() => octalToPermissionBits(valid ? octal : '000'), [octal, valid])

  useEffect(() => {
    if (!entry) {
      return
    }
    setMode('visual')
    setOctal(entryPermissionOctal(entry))
  }, [entry])

  const setPermissionBit = (role: PermissionRole, action: PermissionAction, checked: boolean) => {
    const next = octalToPermissionBits(valid ? octal : '000')
    next[role][action] = checked
    setOctal(permissionBitsToOctal(next))
  }

  return (
    <Modal
      title={t('files.permissionsTitle')}
      open={open}
      centered
      destroyOnHidden
      okText={t('app.update')}
      cancelText={t('app.cancel')}
      confirmLoading={saving}
      okButtonProps={{ disabled: !entry || !valid }}
      className="termous-modal permission-editor-modal"
      rootClassName="termous-modal-root"
      onCancel={onCancel}
      onOk={() => {
        if (entry && valid) {
          onSubmit(entry, octal)
        }
      }}
    >
      {entry ? (
        <div className="permission-editor">
          <div className="permission-target">
            <strong>{entry.name}</strong>
            <span>{entry.path}</span>
          </div>
          <Segmented
            block
            className="permission-mode-segmented"
            value={mode}
            options={[
              { label: t('files.permissionsVisualMode'), value: 'visual' },
              { label: t('files.permissionsNumericMode'), value: 'numeric' },
            ]}
            onChange={(value) => setMode(value as PermissionEditorMode)}
          />
          {mode === 'visual' ? (
            <div className="permission-grid" role="group" aria-label={t('files.permissionsVisualMode')}>
              <span />
              {permissionRoles.map((role) => (
                <strong key={role}>{t(`files.permissionRole.${role}`)}</strong>
              ))}
              {permissionActions.map((action) => (
                <div className="permission-row" key={action}>
                  <span>{t(`files.permissionAction.${action}`)}</span>
                  {permissionRoles.map((role) => (
                    <Checkbox
                      key={`${role}-${action}`}
                      checked={bits[role][action]}
                      onChange={(event) => setPermissionBit(role, action, event.target.checked)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="permission-numeric">
              <label htmlFor="permission-octal-input">{t('files.permissionsNumericLabel')}</label>
              <Input
                id="permission-octal-input"
                value={octal}
                maxLength={3}
                autoFocus
                status={valid ? undefined : 'error'}
                onChange={(event) => setOctal(event.target.value.replace(/[^0-7]/g, '').slice(0, 3))}
              />
              <span className={valid ? '' : 'is-error'}>{t('files.permissionsNumericHint')}</span>
            </div>
          )}
          <div className="permission-preview">
            <span>{t('files.permissionsPreview')}</span>
            <strong>{valid ? octal : '---'}</strong>
          </div>
        </div>
      ) : null}
    </Modal>
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

function entryPermissionOctal(entry: RemoteFileEntry) {
  if (entry.permission_octal && isPermissionOctal(entry.permission_octal)) {
    return entry.permission_octal
  }
  return permissionTextToOctal(entry.permissions) ?? '644'
}

function isPermissionOctal(value: string) {
  return /^[0-7]{3}$/.test(value)
}

function permissionTextToOctal(value?: string) {
  if (!value) {
    return null
  }
  const permissions = value.trim().slice(-9)
  if (permissions.length !== 9) {
    return null
  }
  const digits = [permissions.slice(0, 3), permissions.slice(3, 6), permissions.slice(6, 9)].map((part) => {
    let next = 0
    if (part[0] === 'r') next += 4
    if (part[1] === 'w') next += 2
    if (part[2] === 'x' || part[2] === 's' || part[2] === 't') next += 1
    return String(next)
  })
  return digits.join('')
}

function octalToPermissionBits(value: string): PermissionBits {
  const safe = isPermissionOctal(value) ? value : '000'
  const [owner, group, others] = safe.split('').map((digit) => Number.parseInt(digit, 10))
  return {
    owner: digitToPermissionBits(owner),
    group: digitToPermissionBits(group),
    others: digitToPermissionBits(others),
  }
}

function digitToPermissionBits(value: number): Record<PermissionAction, boolean> {
  return {
    read: (value & permissionActionValues.read) !== 0,
    write: (value & permissionActionValues.write) !== 0,
    execute: (value & permissionActionValues.execute) !== 0,
  }
}

function permissionBitsToOctal(bits: PermissionBits) {
  return permissionRoles
    .map((role) => permissionActions.reduce((total, action) => total + (bits[role][action] ? permissionActionValues[action] : 0), 0))
    .join('')
}

function isUploadTransfer(task: TransferTask) {
  return task.type.startsWith('upload')
}

function isTransferActive(task: TransferTask) {
  return task.status === 'queued' || task.status === 'running'
}

function isTransferTerminal(task: TransferTask) {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
}

function HostKeyDialog({ hostKey, changed }: { hostKey: FileSessionHostKey; changed: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="files-hostkey-dialog">
      <p>{changed ? t('files.hostKeyChangedDescription') : t('files.trustHostDescription')}</p>
      <dl>
        <div>
          <dt>{t('files.hostKeyAddress')}</dt>
          <dd>{hostKey.address}:{hostKey.port}</dd>
        </div>
        <div>
          <dt>{t('files.hostKeyType')}</dt>
          <dd>{hostKey.host_key_type || 'unknown'}</dd>
        </div>
        {changed ? (
          <div>
            <dt>{t('files.hostKeyExpected')}</dt>
            <dd>{hostKey.expected || '-'}</dd>
          </div>
        ) : null}
        <div>
          <dt>{changed ? t('files.hostKeyActual') : t('files.hostKeyFingerprint')}</dt>
          <dd>{hostKey.fingerprint_sha256}</dd>
        </div>
      </dl>
    </div>
  )
}

function shortId(id: string) {
  return id.length > 6 ? id.slice(-6) : id
}
