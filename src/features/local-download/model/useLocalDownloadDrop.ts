import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { LocalDownloadGateway } from './localDownloadGateway'
import { isSafeLocalDownloadTarget } from './localDownloadWorkspaceState'
import {
  hasNativeFiles,
  hasRemoteFileDragType,
  releaseRemoteFileDrag,
  resolveRemoteFileDrag,
  validateRemoteFileDrag,
} from './remoteFileDragRegistry'
import type {
  LocalDownloadRequest,
  LocalDownloadSessionContext,
  LocalDownloadTarget,
} from './types'

interface LocalDownloadDropMessages {
  invalidSelection: string
  nativeFilesRejected: string
  requestNotStarted: string
  targetUnavailable: string
}

interface UseLocalDownloadDropOptions {
  api: LocalDownloadGateway
  session: LocalDownloadSessionContext | null
  enabled?: boolean
  operationEnabled?: boolean
  messages: LocalDownloadDropMessages
  resolveTarget: (target: LocalDownloadTarget) => LocalDownloadTarget | null
  onDownload: (request: LocalDownloadRequest, signal?: AbortSignal) => Promise<boolean>
  onSuccess?: () => void
  onError?: (message: string) => void
  onSurfaceActiveChange?: (active: boolean) => void
  onOperationActiveChange?: (active: boolean) => boolean | void
  reportNativeRejection?: boolean
}

export function useLocalDownloadDrop({
  api,
  session,
  enabled = true,
  operationEnabled = enabled,
  messages,
  resolveTarget,
  onDownload,
  onSuccess,
  onError,
  onSurfaceActiveChange,
  onOperationActiveChange,
  reportNativeRejection = true,
}: UseLocalDownloadDropOptions) {
  const [activeDropTarget, setActiveDropTarget] = useState('')
  const [busyDropTarget, setBusyDropTarget] = useState('')
  const [nativeFilesRejected, setNativeFilesRejected] = useState(false)
  const surfaceActiveRef = useRef(false)
  const operationActiveRef = useRef(false)
  const enabledRef = useRef(enabled)
  const operationEnabledRef = useRef(operationEnabled)
  const sessionRef = useRef(session)
  const dropOperationSequenceRef = useRef(0)
  const dropOperationRef = useRef<{
    id: number
    targetKey: string
    controller: AbortController
  } | null>(null)
  enabledRef.current = enabled
  operationEnabledRef.current = operationEnabled
  sessionRef.current = session

  const reportSurfaceActive = useCallback((active: boolean) => {
    if (surfaceActiveRef.current === active) {
      return
    }
    surfaceActiveRef.current = active
    onSurfaceActiveChange?.(active)
  }, [onSurfaceActiveChange])

  const reportOperationActive = useCallback((active: boolean) => {
    if (operationActiveRef.current === active) {
      return true
    }
    if (active && onOperationActiveChange?.(true) === false) {
      return false
    }
    operationActiveRef.current = active
    if (!active) {
      onOperationActiveChange?.(false)
    }
    return true
  }, [onOperationActiveChange])

  const cancelDropOperation = useCallback(() => {
    const operation = dropOperationRef.current
    dropOperationRef.current = null
    operation?.controller.abort()
    setBusyDropTarget('')
    setActiveDropTarget('')
    setNativeFilesRejected(false)
    reportSurfaceActive(false)
    reportOperationActive(false)
  }, [reportOperationActive, reportSurfaceActive])

  useEffect(() => {
    if (!enabled || !operationEnabled) {
      cancelDropOperation()
    }
  }, [cancelDropOperation, enabled, operationEnabled])

  useEffect(() => {
    cancelDropOperation()
  }, [
    cancelDropOperation,
    session?.connected,
    session?.connectionGeneration,
    session?.fileSessionId,
    session?.hostId,
  ])

  useEffect(() => () => {
    dropOperationRef.current?.controller.abort()
    dropOperationRef.current = null
    if (surfaceActiveRef.current) {
      surfaceActiveRef.current = false
      onSurfaceActiveChange?.(false)
    }
    if (operationActiveRef.current) {
      operationActiveRef.current = false
      onOperationActiveChange?.(false)
    }
  }, [onOperationActiveChange, onSurfaceActiveChange])

  useEffect(() => {
    const resetSurface = () => reportSurfaceActive(false)
    document.addEventListener('dragend', resetSurface)
    window.addEventListener('blur', resetSurface)
    return () => {
      document.removeEventListener('dragend', resetSurface)
      window.removeEventListener('blur', resetSurface)
    }
  }, [reportSurfaceActive])

  const rejectNativeDrag = useCallback((event: DragEvent<HTMLElement>) => {
    if (!enabledRef.current) {
      return false
    }
    if (!hasNativeFiles(event.dataTransfer)) {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'none'
    setNativeFilesRejected(true)
    setActiveDropTarget('')
    reportSurfaceActive(true)
    return true
  }, [reportSurfaceActive])

  const onRootDragEnterCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!enabledRef.current) {
      return
    }
    if (rejectNativeDrag(event)) {
      return
    }
    if (hasRemoteFileDragType(event.dataTransfer)) {
      reportSurfaceActive(true)
    }
  }, [rejectNativeDrag, reportSurfaceActive])

  const onRootDragOverCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!enabledRef.current) {
      return
    }
    if (!rejectNativeDrag(event) && hasRemoteFileDragType(event.dataTransfer)) {
      reportSurfaceActive(true)
    }
  }, [rejectNativeDrag, reportSurfaceActive])

  const onRootDropCapture = useCallback((event: DragEvent<HTMLElement>) => {
    if (!enabledRef.current) {
      return
    }
    if (rejectNativeDrag(event) && reportNativeRejection) {
      onError?.(messages.nativeFilesRejected)
    }
    if (hasNativeFiles(event.dataTransfer)) {
      setNativeFilesRejected(false)
      reportSurfaceActive(false)
    }
  }, [
    messages.nativeFilesRejected,
    onError,
    rejectNativeDrag,
    reportNativeRejection,
    reportSurfaceActive,
  ])

  const onRootDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!enabledRef.current) {
      return
    }
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setActiveDropTarget('')
    setNativeFilesRejected(false)
    reportSurfaceActive(false)
  }, [reportSurfaceActive])

  const onRootDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!enabledRef.current || !hasRemoteFileDragType(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'none'
    setNativeFilesRejected(false)
    setActiveDropTarget('__local-download-console__')
    reportSurfaceActive(true)
  }, [reportSurfaceActive])

  const onRootDrop = useCallback((event: DragEvent<HTMLElement>) => {
    if (!enabledRef.current || !hasRemoteFileDragType(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const transaction = resolveRemoteFileDrag(event.dataTransfer)
    releaseRemoteFileDrag(transaction)
    setActiveDropTarget('')
    reportSurfaceActive(false)
    onError?.(messages.targetUnavailable)
  }, [messages.targetUnavailable, onError, reportSurfaceActive])

  const onTargetDragOver = useCallback((
    targetKey: string,
    target: LocalDownloadTarget,
    event: DragEvent<HTMLElement>,
  ) => {
    const latestTarget = resolveTarget(target)
    if (
      !enabledRef.current
      || !operationEnabledRef.current
      || dropOperationRef.current
      || rejectNativeDrag(event)
      || !latestTarget?.available
      || !session?.connected
      || !hasRemoteFileDragType(event.dataTransfer)
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setNativeFilesRejected(false)
    setActiveDropTarget(targetKey)
    reportSurfaceActive(true)
  }, [rejectNativeDrag, reportSurfaceActive, resolveTarget, session])

  const onTargetDragLeave = useCallback((
    targetKey: string,
    event: DragEvent<HTMLElement>,
  ) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setActiveDropTarget((current) => current === targetKey ? '' : current)
  }, [])

  const onTargetDrop = useCallback(async (
    targetKey: string,
    target: LocalDownloadTarget,
    event: DragEvent<HTMLElement>,
  ) => {
    if (!enabledRef.current) {
      return
    }
    if (rejectNativeDrag(event)) {
      setNativeFilesRejected(false)
      reportSurfaceActive(false)
      onError?.(messages.nativeFilesRejected)
      return
    }
    if (!hasRemoteFileDragType(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (!operationEnabledRef.current) {
      const transaction = resolveRemoteFileDrag(event.dataTransfer)
      releaseRemoteFileDrag(transaction)
      setActiveDropTarget('')
      reportSurfaceActive(false)
      onError?.(messages.targetUnavailable)
      return
    }
    setActiveDropTarget('')
    reportSurfaceActive(false)
    const transaction = resolveRemoteFileDrag(event.dataTransfer)
    releaseRemoteFileDrag(transaction)
    const currentSession = sessionRef.current
    if (!transaction || !currentSession) {
      onError?.(messages.invalidSelection)
      return
    }
    const validation = validateRemoteFileDrag(transaction, currentSession)
    if (!validation.ok) {
      onError?.(messages.invalidSelection)
      return
    }
    if (dropOperationRef.current) {
      onError?.(messages.targetUnavailable)
      return
    }
    const operation = {
      id: dropOperationSequenceRef.current + 1,
      targetKey,
      controller: new AbortController(),
    }
    if (!reportOperationActive(true)) {
      operation.controller.abort()
      onError?.(messages.requestNotStarted)
      return
    }
    dropOperationSequenceRef.current = operation.id
    dropOperationRef.current = operation
    setBusyDropTarget(targetKey)
    try {
      const latestTarget = resolveTarget(target)
      if (!latestTarget || !enabledRef.current || dropOperationRef.current?.id !== operation.id) {
        onError?.(messages.targetUnavailable)
        return
      }
      const stat = await api.localPathMappingStat(
        latestTarget.mappingId,
        latestTarget.path,
        operation.controller.signal,
      )
      if (
        operation.controller.signal.aborted
        || !enabledRef.current
        || dropOperationRef.current?.id !== operation.id
      ) {
        return
      }
      const confirmedLatestTarget = resolveTarget(latestTarget)
      if (
        !confirmedLatestTarget
        || !isSafeLocalDownloadTarget(
          {
            available: confirmedLatestTarget.available,
            path: confirmedLatestTarget.mappingPath,
          },
          confirmedLatestTarget.path,
          stat,
        )
      ) {
        onError?.(messages.targetUnavailable)
        return
      }
      const latestSession = sessionRef.current
      if (!latestSession || !validateRemoteFileDrag(transaction, latestSession).ok) {
        onError?.(messages.invalidSelection)
        return
      }
      const confirmedTarget = { ...confirmedLatestTarget, path: stat.path }
      const succeeded = await onDownload(
        {
          selection: validation.transaction,
          target: confirmedTarget,
          source: 'drop',
        },
        operation.controller.signal,
      )
      if (
        succeeded
        && enabledRef.current
        && dropOperationRef.current?.id === operation.id
      ) {
        onSuccess?.()
      } else if (
        !succeeded
        && !operation.controller.signal.aborted
        && enabledRef.current
        && dropOperationRef.current?.id === operation.id
      ) {
        onError?.(messages.requestNotStarted)
      }
    } catch (error) {
      if (
        !operation.controller.signal.aborted
        && enabledRef.current
        && dropOperationRef.current?.id === operation.id
      ) {
        onError?.(error instanceof Error ? error.message : messages.targetUnavailable)
      }
    } finally {
      if (dropOperationRef.current?.id === operation.id) {
        dropOperationRef.current = null
        setBusyDropTarget('')
        reportOperationActive(false)
      }
    }
  }, [
    api,
    messages,
    onDownload,
    onError,
    onSuccess,
    reportSurfaceActive,
    reportOperationActive,
    rejectNativeDrag,
    resolveTarget,
  ])

  return {
    activeDropTarget,
    busyDropTarget,
    nativeFilesRejected,
    onRootDragEnterCapture,
    onRootDragOverCapture,
    onRootDropCapture,
    onRootDragLeave,
    onRootDragOver,
    onRootDrop,
    onTargetDragOver,
    onTargetDragLeave,
    onTargetDrop,
  }
}
