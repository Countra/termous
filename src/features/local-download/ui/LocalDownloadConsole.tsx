import { Button } from 'antd'
import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './LocalDownloadConsole.module.scss'
import { LocalDownloadBrowserPane } from './LocalDownloadBrowserPane'
import { LocalDownloadConfirmPane } from './LocalDownloadConfirmPane'
import { LocalDownloadMappingPane } from './LocalDownloadMappingPane'
import {
  isSafeLocalDownloadTarget,
  isLocalPathWithin,
  localPathRelativeLabel,
} from '../model/localDownloadWorkspaceState'
import { remoteFileSelectionValidationFailure } from '../model/remoteFileDragRegistry'
import type { RemoteFileDragSelection } from '../model/remoteFileDragRegistry'
import type {
  LocalDownloadConsoleProps,
  LocalDownloadTarget,
} from '../model/types'
import { useLocalDownloadDrop } from '../model/useLocalDownloadDrop'
import { useLocalDownloadWorkspace } from '../model/useLocalDownloadWorkspace'

export function LocalDownloadConsole({
  api,
  open,
  mappings,
  session,
  selection = null,
  preferredTarget,
  refreshRequests,
  operationBlocked = false,
  className,
  onClose,
  onDownload,
  onDropActiveChange,
  onOperationActiveChange,
  onTargetChange,
  onCreateMapping,
  onUpdateMapping,
  onDeleteMapping,
  onReorderMappings,
}: LocalDownloadConsoleProps) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [actionError, setActionError] = useState('')
  const lastTargetKeyRef = useRef('')
  const confirmSequenceRef = useRef(0)
  const confirmControllerRef = useRef<AbortController | null>(null)
  const confirmingRef = useRef(false)
  const dropOperationActiveRef = useRef(false)
  const reportedOperationActiveRef = useRef(false)
  const openRef = useRef(open)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const sessionRef = useRef(session)
  const mappingsRef = useRef(mappings)
  openRef.current = open
  sessionRef.current = session
  mappingsRef.current = mappings
  const reportOperationActive = useCallback(() => {
    const active = confirmingRef.current || dropOperationActiveRef.current
    if (reportedOperationActiveRef.current === active) {
      return true
    }
    if (active && onOperationActiveChange?.(true) === false) {
      return false
    }
    reportedOperationActiveRef.current = active
    if (!active) {
      onOperationActiveChange?.(false)
    }
    return true
  }, [onOperationActiveChange])
  const handleDropOperationActiveChange = useCallback((active: boolean) => {
    dropOperationActiveRef.current = active
    const accepted = reportOperationActive()
    if (!accepted) {
      dropOperationActiveRef.current = false
    }
    return accepted
  }, [reportOperationActive])
  const resolveLatestTarget = useCallback((target: LocalDownloadTarget) => {
    const mapping = mappingsRef.current.find((item) => item.id === target.mappingId)
    if (
      !mapping?.available
      || mapping.path !== target.mappingPath
      || !isLocalPathWithin(target.path, mapping.path)
    ) {
      return null
    }
    return {
      ...target,
      mappingName: mapping.name,
      mappingPath: mapping.path,
      available: mapping.available,
    }
  }, [])
  const workspace = useLocalDownloadWorkspace({
    api,
    mappings,
    open,
    preferredTarget,
    refreshRequests,
    loadErrorMessage: t('files.downloadDestinationLoadFailed'),
  })
  const dropMessages = useMemo(() => ({
    invalidSelection: t('files.localDownloadInvalidSelection'),
    nativeFilesRejected: t('files.localDownloadNativeFilesRejected'),
    requestNotStarted: t('files.localDownloadNotStarted'),
    targetUnavailable: t('files.downloadDestinationUnavailable'),
  }), [t])
  const drop = useLocalDownloadDrop({
    api,
    session,
    enabled: open,
    operationEnabled: open && !confirming && !operationBlocked,
    messages: dropMessages,
    resolveTarget: resolveLatestTarget,
    onDownload,
    onSuccess: onClose,
    onError: setActionError,
    onSurfaceActiveChange: onDropActiveChange,
    onOperationActiveChange: handleDropOperationActiveChange,
    reportNativeRejection: true,
  })

  const currentTarget = useMemo<LocalDownloadTarget | null>(() => {
    if (!workspace.selectedMapping) {
      return null
    }
    const targetPath = workspace.selectedState?.committedPath || workspace.selectedMapping.path
    return {
      mappingId: workspace.selectedMapping.id,
      mappingName: workspace.selectedMapping.name,
      mappingPath: workspace.selectedMapping.path,
      path: targetPath,
      available: workspace.selectedMapping.available,
    }
  }, [workspace.selectedMapping, workspace.selectedState])
  const selectionPathsKey = selection
    ? [...selection.paths].sort().join('\u0000')
    : ''
  const selectionFileSessionId = selection?.fileSessionId ?? ''
  const selectionHostId = selection?.hostId ?? ''
  const selectionConnectionGeneration = selection?.connectionGeneration
  const stableSelection = useMemo<RemoteFileDragSelection | null>(() => {
    if (
      !selectionFileSessionId
      || !selectionHostId
      || selectionConnectionGeneration === undefined
      || !selectionPathsKey
    ) {
      return null
    }
    return {
      fileSessionId: selectionFileSessionId,
      hostId: selectionHostId,
      connectionGeneration: selectionConnectionGeneration,
      paths: selectionPathsKey.split('\u0000'),
    }
  }, [
    selectionConnectionGeneration,
    selectionFileSessionId,
    selectionHostId,
    selectionPathsKey,
  ])

  const confirmDownload = useCallback(async () => {
    const currentSession = sessionRef.current
    if (
      !stableSelection
      || !currentSession
      || !currentTarget
      || confirmingRef.current
      || drop.busyDropTarget
      || operationBlocked
    ) {
      setActionError(dropMessages.invalidSelection)
      return
    }
    const invalidSelection = remoteFileSelectionValidationFailure(stableSelection, currentSession)
    if (invalidSelection) {
      setActionError(dropMessages.invalidSelection)
      return
    }
    confirmingRef.current = true
    if (!reportOperationActive()) {
      confirmingRef.current = false
      setActionError(dropMessages.requestNotStarted)
      return
    }
    const confirmSequence = confirmSequenceRef.current + 1
    const controller = new AbortController()
    confirmSequenceRef.current = confirmSequence
    confirmControllerRef.current?.abort()
    confirmControllerRef.current = controller
    setConfirming(true)
    setActionError('')
    try {
      const latestTarget = resolveLatestTarget(currentTarget)
      if (!latestTarget) {
        setActionError(dropMessages.targetUnavailable)
        return
      }
      const stat = await api.localPathMappingStat(
        latestTarget.mappingId,
        latestTarget.path,
        controller.signal,
      )
      if (
        controller.signal.aborted
        || !openRef.current
        || confirmControllerRef.current !== controller
        || confirmSequenceRef.current !== confirmSequence
      ) {
        return
      }
      const confirmedLatestTarget = resolveLatestTarget(latestTarget)
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
        setActionError(dropMessages.targetUnavailable)
        return
      }
      const latestSession = sessionRef.current
      if (!latestSession || remoteFileSelectionValidationFailure(stableSelection, latestSession)) {
        setActionError(dropMessages.invalidSelection)
        return
      }
      const succeeded = await onDownload(
        {
          selection: stableSelection,
          target: { ...confirmedLatestTarget, path: stat.path },
          source: 'confirm',
        },
        controller.signal,
      )
      if (
        succeeded
        && !controller.signal.aborted
        && openRef.current
        && confirmControllerRef.current === controller
        && confirmSequenceRef.current === confirmSequence
      ) {
        onClose()
      } else if (
        !succeeded
        && !controller.signal.aborted
        && openRef.current
        && confirmControllerRef.current === controller
      ) {
        setActionError(dropMessages.requestNotStarted)
      }
    } catch (error) {
      if (!controller.signal.aborted && confirmControllerRef.current === controller) {
        setActionError(error instanceof Error ? error.message : dropMessages.targetUnavailable)
      }
    } finally {
      if (
        confirmControllerRef.current === controller
        && confirmSequenceRef.current === confirmSequence
      ) {
        confirmControllerRef.current = null
        confirmingRef.current = false
        setConfirming(false)
        reportOperationActive()
      }
    }
  }, [
    api,
    currentTarget,
    dropMessages,
    onClose,
    onDownload,
    operationBlocked,
    reportOperationActive,
    resolveLatestTarget,
    stableSelection,
    drop.busyDropTarget,
  ])

  useEffect(() => {
    confirmSequenceRef.current += 1
    confirmControllerRef.current?.abort()
    confirmControllerRef.current = null
    confirmingRef.current = false
    setConfirming(false)
    setActionError('')
    reportOperationActive()
  }, [
    open,
    operationBlocked,
    reportOperationActive,
    selection?.connectionGeneration,
    selection?.fileSessionId,
    selection?.hostId,
    selectionPathsKey,
    session?.connected,
    session?.connectionGeneration,
    session?.fileSessionId,
    session?.hostId,
    workspace.selectedMappingId,
    workspace.selectedState?.committedPath,
  ])

  useEffect(() => () => {
    confirmControllerRef.current?.abort()
    confirmControllerRef.current = null
    confirmingRef.current = false
    dropOperationActiveRef.current = false
    if (reportedOperationActiveRef.current) {
      reportedOperationActiveRef.current = false
      onOperationActiveChange?.(false)
    }
  }, [onOperationActiveChange])

  useEffect(() => {
    if (!currentTarget) {
      if (lastTargetKeyRef.current !== '') {
        lastTargetKeyRef.current = ''
        onTargetChange?.(null)
      }
      return
    }
    const targetKey = [
      currentTarget.mappingId,
      currentTarget.mappingName,
      currentTarget.mappingPath,
      currentTarget.path,
      currentTarget.available ? 'available' : 'unavailable',
    ].join('\u0000')
    if (lastTargetKeyRef.current === targetKey) {
      return
    }
    lastTargetKeyRef.current = targetKey
    onTargetChange?.(currentTarget)
  }, [currentTarget, onTargetChange, open])

  useEffect(() => {
    if (!open) {
      setConfirming(false)
      setActionError('')
      return undefined
    }
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const selectedRelativePath = currentTarget
    ? localPathRelativeLabel(currentTarget.path, currentTarget.mappingPath)
    : ''

  return (
    <div className={styles.root}>
      <div
        id="files-local-download-console"
        className={[
          'local-download-console',
          open ? 'is-open' : '',
          drop.nativeFilesRejected ? 'is-native-drag' : '',
          className ?? '',
        ].filter(Boolean).join(' ')}
        hidden={!open}
        aria-hidden={!open}
        aria-label={t('files.localMappings')}
        data-drop-active={drop.activeDropTarget || drop.busyDropTarget || undefined}
        onDragEnterCapture={drop.onRootDragEnterCapture}
        onDragOverCapture={drop.onRootDragOverCapture}
        onDropCapture={drop.onRootDropCapture}
        onDragLeave={drop.onRootDragLeave}
        onDragOver={drop.onRootDragOver}
        onDrop={drop.onRootDrop}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          if (!confirming && !drop.busyDropTarget && !operationBlocked) {
            onClose()
          }
        }}
      >
      <Button
        ref={closeButtonRef}
        type="text"
        size="small"
        className="local-download-console-close"
        aria-label={t('app.close')}
        icon={<X size={15} aria-hidden="true" />}
        disabled={confirming || Boolean(drop.busyDropTarget) || operationBlocked}
        onClick={onClose}
      />
      <LocalDownloadMappingPane
        open={open}
        mappings={mappings}
        selectedMappingId={workspace.selectedMappingId}
        disabled={confirming || Boolean(drop.busyDropTarget) || operationBlocked}
        drop={drop}
        onSelectMapping={workspace.selectMapping}
        onCreateMapping={onCreateMapping}
        onUpdateMapping={onUpdateMapping}
        onDeleteMapping={onDeleteMapping}
        onReorderMappings={onReorderMappings}
        onActionError={setActionError}
      />
      <LocalDownloadBrowserPane
        mapping={workspace.selectedMapping}
        state={workspace.selectedState}
        disabled={operationBlocked}
        drop={drop}
        onNavigate={workspace.navigate}
        onNavigateParent={workspace.navigateParent}
        onRefresh={workspace.refresh}
        onRetry={workspace.retry}
        onActionError={setActionError}
      />
      <LocalDownloadConfirmPane
        mapping={workspace.selectedMapping}
        state={workspace.selectedState}
        selection={selection}
        confirming={confirming}
        disabled={operationBlocked}
        error={actionError}
        drop={drop}
        onConfirm={() => void confirmDownload()}
      />
      <span className="local-download-console-live-target" aria-live="polite">
        {currentTarget
          ? `${currentTarget.mappingName}${selectedRelativePath ? ` / ${selectedRelativePath}` : ''}`
          : ''}
      </span>
      </div>
    </div>
  )
}
