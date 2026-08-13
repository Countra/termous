import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { getTermousBridge } from '#shared/bridge'
import type {
  FileSession,
  RemoteFileEntry,
} from '#entities/file'
import {
  beginRemoteFileDrag,
  releaseRemoteFileDrag,
  REMOTE_FILE_DRAG_MIME,
  resolveRemoteFileDrag,
  validateRemoteFileDrag,
  type RemoteFileDragTransaction,
} from '#features/local-download'
import {
  normalizeRemotePath,
  parentPath,
} from '#shared/path'

interface CurrentRef<T> {
  current: T
}

interface RemoteMoveDragState {
  paths: string[]
  transactionId: string
}

type LocalDownloadDropSource = 'console' | 'quick-target'

interface RemoteDragPreviewClassNames {
  root: string
  label: string
  count: string
}

interface UseFilesWorkspaceDragControllerOptions {
  filesTableShellRef: CurrentRef<HTMLDivElement | null>
  activeFileSession: FileSession | null
  activeFileSessionClosing: boolean
  fileActionsEnabled: boolean
  loading: boolean
  currentPath: string
  entries: readonly RemoteFileEntry[]
  selectedPaths: string[]
  fileSessionsRef: CurrentRef<readonly FileSession[]>
  activeFileSessionIdRef: CurrentRef<string>
  closingFileSessionIdsRef: CurrentRef<ReadonlySet<string>>
  previewClassNames: RemoteDragPreviewClassNames
  onSelectPaths: (paths: string[]) => void
  onSetActiveEntry: (entry: RemoteFileEntry) => void
  onUploadLocalPaths: (paths: string[], targetPath: string) => Promise<void>
  onMoveRemotePathsToDirectory: (
    transaction: RemoteFileDragTransaction,
    targetPath: string,
  ) => Promise<void>
  onRemoteMoveUnavailable: () => void
  onDroppedPathsUnavailable: () => void
}

const fileDragAutoScrollEdge = 72
const fileDragAutoScrollMaxSpeed = 18

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function hasRemoteDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes(REMOTE_FILE_DRAG_MIME)
}

export function useFilesWorkspaceDragController({
  filesTableShellRef,
  activeFileSession,
  activeFileSessionClosing,
  fileActionsEnabled,
  loading,
  currentPath,
  entries,
  selectedPaths,
  fileSessionsRef,
  activeFileSessionIdRef,
  closingFileSessionIdsRef,
  previewClassNames,
  onSelectPaths,
  onSetActiveEntry,
  onUploadLocalPaths,
  onMoveRemotePathsToDirectory,
  onRemoteMoveUnavailable,
  onDroppedPathsUnavailable,
}: UseFilesWorkspaceDragControllerOptions) {
  const dragDepthRef = useRef(0)
  const autoScrollFrameRef = useRef<number | null>(null)
  const autoScrollSpeedRef = useRef(0)
  const remoteMoveDragRef = useRef<RemoteMoveDragState | null>(null)
  const remoteDragPreviewRef = useRef<HTMLElement | null>(null)
  const localDownloadDropSourcesRef = useRef(new Set<LocalDownloadDropSource>())
  const [dragActive, setDragActive] = useState(false)
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null)
  const [remoteMoveDrag, setRemoteMoveDrag] = useState<RemoteMoveDragState | null>(null)
  const [remoteMoveTargetPath, setRemoteMoveTargetPath] = useState<string | null>(null)
  const [localDownloadDropActive, setLocalDownloadDropActive] = useState(false)

  const stopFileDragAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current)
      autoScrollFrameRef.current = null
    }
    autoScrollSpeedRef.current = 0
  }, [])

  const clearDropTargets = useCallback(() => {
    setDropTargetDirectoryPath(null)
    setRemoteMoveTargetPath(null)
  }, [])

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0
    setDragActive(false)
    clearDropTargets()
    localDownloadDropSourcesRef.current.clear()
    setLocalDownloadDropActive(false)
    releaseRemoteFileDrag(remoteMoveDragRef.current?.transactionId)
    remoteMoveDragRef.current = null
    setRemoteMoveDrag(null)
    remoteDragPreviewRef.current?.remove()
    remoteDragPreviewRef.current = null
    stopFileDragAutoScroll()
  }, [clearDropTargets, stopFileDragAutoScroll])

  const updateLocalDownloadDropSource = useCallback((
    source: LocalDownloadDropSource,
    active: boolean,
  ) => {
    const sources = localDownloadDropSourcesRef.current
    if (active) {
      sources.add(source)
      dragDepthRef.current = 0
      setDragActive(false)
      clearDropTargets()
      stopFileDragAutoScroll()
    } else {
      sources.delete(source)
    }
    setLocalDownloadDropActive(sources.size > 0)
  }, [clearDropTargets, stopFileDragAutoScroll])

  const handleLocalConsoleDropActiveChange = useCallback(
    (active: boolean) => updateLocalDownloadDropSource('console', active),
    [updateLocalDownloadDropSource],
  )

  const handleLocalQuickTargetDropActiveChange = useCallback(
    (active: boolean) => updateLocalDownloadDropSource('quick-target', active),
    [updateLocalDownloadDropSource],
  )

  useEffect(() => () => {
    releaseRemoteFileDrag(remoteMoveDragRef.current?.transactionId)
    remoteMoveDragRef.current = null
    remoteDragPreviewRef.current?.remove()
    remoteDragPreviewRef.current = null
    stopFileDragAutoScroll()
  }, [stopFileDragAutoScroll])

  useEffect(() => {
    window.addEventListener('blur', resetDragState)
    document.addEventListener('dragend', resetDragState)
    return () => {
      window.removeEventListener('blur', resetDragState)
      document.removeEventListener('dragend', resetDragState)
    }
  }, [resetDragState])

  useEffect(() => {
    resetDragState()
  }, [
    activeFileSession?.connection_generation,
    activeFileSession?.id,
    activeFileSession?.status,
    resetDragState,
  ])

  useEffect(() => {
    if (activeFileSessionClosing) {
      resetDragState()
    }
  }, [activeFileSessionClosing, resetDragState])

  const resolveRemoteMoveDropTransaction = useCallback((
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
  }, [activeFileSessionIdRef, closingFileSessionIdsRef, fileSessionsRef])

  const findDirectoryDropTargetPath = useCallback((target: EventTarget | null) => {
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
    return entries.some((entry) => entry.kind === 'directory' && entry.path === rowKey)
      ? rowKey
      : null
  }, [entries])

  const canMovePathToDirectory = useCallback((sourcePath: string, targetPath: string) => {
    const source = normalizeRemotePath(sourcePath)
    const target = normalizeRemotePath(targetPath)
    const sourceEntry = entries.find((entry) => entry.path === source)
    if (!sourceEntry || parentPath(source) === target) {
      return false
    }
    return sourceEntry.kind !== 'directory' || (target !== source && !target.startsWith(`${source}/`))
  }, [entries])

  const canDropRemoteMoveToPath = useCallback((
    targetPath: string,
    sourcePaths: readonly string[],
  ) => sourcePaths.length > 0 && sourcePaths.every(
    (sourcePath) => canMovePathToDirectory(sourcePath, targetPath),
  ), [canMovePathToDirectory])

  const findRemoteMoveTargetPath = useCallback((
    target: EventTarget | null,
    sourcePaths: readonly string[],
  ) => {
    const targetPath = findDirectoryDropTargetPath(target)
    if (!targetPath || sourcePaths.length === 0) {
      return null
    }
    return sourcePaths.every((sourcePath) => canMovePathToDirectory(sourcePath, targetPath))
      ? targetPath
      : null
  }, [canMovePathToDirectory, findDirectoryDropTargetPath])

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
    clearDropTargets()
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

  const onBreadcrumbDragOver = (targetPath: string, event: DragEvent<HTMLButtonElement>) => {
    const normalizedTargetPath = normalizeRemotePath(targetPath)
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (remoteDrag || hasRemoteDraggedFiles(event)) {
      event.preventDefault()
      event.stopPropagation()
      const allowed = remoteDrag
        ? canDropRemoteMoveToPath(normalizedTargetPath, remoteDrag.paths)
        : false
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
    if (
      remoteMoveDragRef.current
      || remoteMoveDrag
      || hasRemoteDraggedFiles(event)
      || hasDraggedFiles(event)
    ) {
      event.preventDefault()
      event.stopPropagation()
    }
    if (
      event.currentTarget instanceof HTMLElement
      && event.relatedTarget instanceof Node
      && event.currentTarget.contains(event.relatedTarget)
    ) {
      return
    }
    const normalizedTargetPath = normalizeRemotePath(targetPath)
    setDropTargetDirectoryPath((current) => current === normalizedTargetPath ? null : current)
    setRemoteMoveTargetPath((current) => current === normalizedTargetPath ? null : current)
  }

  const resolveDroppedLocalPaths = async (dataTransfer: DataTransfer) => {
    const filesBridge = getTermousBridge()?.files
    const cachedPaths = await filesBridge?.consumeDroppedFilePaths?.(dataTransfer.files.length)
    return cachedPaths?.length
      ? cachedPaths
      : await filesBridge?.pathsFromFileList(dataTransfer.files)
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
        await onMoveRemotePathsToDirectory(transaction, normalizedTargetPath)
      } else {
        onRemoteMoveUnavailable()
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
    const paths = await resolveDroppedLocalPaths(event.dataTransfer)
    if (fileActionsEnabled && (!paths || paths.length === 0)) {
      onDroppedPathsUnavailable()
      return
    }
    await onUploadLocalPaths(paths ?? [], normalizedTargetPath)
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
    setDropTargetDirectoryPath(
      fileActionsEnabled ? findDirectoryDropTargetPath(event.target) : null,
    )
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
      if (
        event.currentTarget instanceof HTMLElement
        && event.relatedTarget instanceof Node
        && event.currentTarget.contains(event.relatedTarget)
      ) {
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
        await onMoveRemotePathsToDirectory(transaction, targetPath)
      } else {
        onRemoteMoveUnavailable()
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
    const paths = await resolveDroppedLocalPaths(event.dataTransfer)
    if (fileActionsEnabled && (!paths || paths.length === 0)) {
      onDroppedPathsUnavailable()
      return
    }
    await onUploadLocalPaths(paths ?? [], targetPath)
  }

  const startRemoteMoveDrag = (entry: RemoteFileEntry, event: DragEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (
      !activeFileSession
      || !fileActionsEnabled
      || loading
      || target?.closest('.ant-checkbox, [data-files-drag-block]')
    ) {
      event.preventDefault()
      return
    }
    const paths = selectedPaths.includes(entry.path) ? selectedPaths : [entry.path]
    onSelectPaths(paths)
    onSetActiveEntry(entry)
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
    preview.className = previewClassNames.root
    const icon = event.currentTarget
      .querySelector<HTMLElement>('[data-file-kind-icon]')
      ?.cloneNode(true)
    if (icon instanceof HTMLElement) {
      preview.append(icon)
    }
    const label = document.createElement('span')
    label.className = previewClassNames.label
    label.textContent = entry.name
    preview.append(label)
    if (paths.length > 1) {
      const count = document.createElement('span')
      count.className = previewClassNames.count
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

  const leaveRemoteMoveTarget = (entry: RemoteFileEntry, event: DragEvent<HTMLElement>) => {
    const remoteDrag = remoteMoveDragRef.current ?? remoteMoveDrag
    if (!remoteDrag || entry.kind !== 'directory') {
      return
    }
    if (
      event.currentTarget instanceof HTMLElement
      && event.relatedTarget instanceof Node
      && event.currentTarget.contains(event.relatedTarget)
    ) {
      return
    }
    setRemoteMoveTargetPath((current) => current === entry.path ? null : current)
  }

  const dropRemoteMoveTarget = async (
    entry: RemoteFileEntry,
    event: DragEvent<HTMLElement>,
  ) => {
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
      await onMoveRemotePathsToDirectory(transaction, targetPath)
    } else {
      onRemoteMoveUnavailable()
    }
  }

  return {
    dragActive,
    dropTargetDirectoryPath,
    remoteMoveDrag,
    remoteMoveTargetPath,
    localDownloadDropActive,
    clearDropTargets,
    resetDragState,
    handleLocalConsoleDropActiveChange,
    handleLocalQuickTargetDropActiveChange,
    onBreadcrumbDragOver,
    onBreadcrumbDragLeave,
    onBreadcrumbDrop,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    startRemoteMoveDrag,
    updateRemoteMoveTarget,
    leaveRemoteMoveTarget,
    dropRemoteMoveTarget,
  }
}
