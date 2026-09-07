import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TransferTask } from '#entities/file'
import { TermousApiError } from '#shared/api'
import {
  filterRemoteCopyTargetSessions,
  normalizeRemoteCopyBatchDirectory,
  rebindRemoteCopyBatchFailures,
  reconcileRemoteCopyBatchSelection,
  toggleRemoteCopyBatchTarget,
  validateRemoteCopySource,
} from '../model/remoteCopyModel.ts'
import {
  remoteCopyBatchTargetLimit,
  type RemoteCopyBatchFailure,
  type RemoteCopyBatchOutcome,
  type RemoteCopyConflictPolicy,
  type RemoteCopyModalProps,
  type RemoteCopyTargetSession,
} from '../model/types.ts'

interface UseRemoteCopyBatchControllerOptions extends RemoteCopyModalProps {
  active: boolean
}

export function useRemoteCopyBatchController({
  active,
  open,
  source,
  hosts,
  fileSessions,
  createRemoteCopy,
  confirmOverwrite,
  onCreated,
  onClose,
}: UseRemoteCopyBatchControllerOptions) {
  const sourceValidation = useMemo(
    () => validateRemoteCopySource(source.entries),
    [source.entries],
  )
  const allTargets = useMemo(
    () => filterRemoteCopyTargetSessions(hosts, fileSessions, source.hostId),
    [fileSessions, hosts, source.hostId],
  )
  const [search, setSearch] = useState('')
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [targetDirInput, setTargetDirInput] = useState('')
  const [conflictPolicy, setConflictPolicy] = useState<RemoteCopyConflictPolicy>('rename')
  const [submitting, setSubmitting] = useState(false)
  const [selectionError, setSelectionError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [failures, setFailures] = useState<RemoteCopyBatchFailure[]>([])
  const [outcome, setOutcome] = useState<RemoteCopyBatchOutcome | null>(null)
  const [completedSessionIds, setCompletedSessionIds] = useState<Set<string>>(() => new Set())
  const [completedHostIds, setCompletedHostIds] = useState<Set<string>>(() => new Set())
  const submittingRef = useRef(false)
  const mountedRef = useRef(false)
  const openRef = useRef(open)
  const activeRef = useRef(active)
  const allTargetsRef = useRef(allTargets)
  const viewEpochRef = useRef(0)
  const viewIdentityRef = useRef('')
  const sourceIdentity = JSON.stringify({
    hostId: source.hostId,
    fileSessionId: source.fileSessionId,
    connectionGeneration: source.connectionGeneration,
    entries: source.entries.map((entry) => ({ path: entry.path, kind: entry.kind })),
  })
  const sourceIdentityRef = useRef(sourceIdentity)
  const viewIdentity = `${open ? 'open' : 'closed'}:${active ? 'active' : 'inactive'}:${sourceIdentity}`
  if (viewIdentityRef.current !== viewIdentity) {
    viewIdentityRef.current = viewIdentity
    viewEpochRef.current += 1
  }
  openRef.current = open
  activeRef.current = active
  allTargetsRef.current = allTargets
  sourceIdentityRef.current = sourceIdentity

  const visibleTargets = useMemo(
    () => filterRemoteCopyTargetSessions(hosts, fileSessions, source.hostId, search),
    [fileSessions, hosts, search, source.hostId],
  )
  const selectedSessionIdSet = useMemo(
    () => new Set(selectedSessionIds),
    [selectedSessionIds],
  )
  const selectedTargets = useMemo(
    () => allTargets.filter((target) => selectedSessionIdSet.has(target.session.id)),
    [allTargets, selectedSessionIdSet],
  )
  const resolvedFailures = useMemo(
    () => rebindRemoteCopyBatchFailures(failures, allTargets),
    [allTargets, failures],
  )
  const normalizedTargetDir = normalizeRemoteCopyBatchDirectory(targetDirInput)
  const targetDirValid = targetDirInput.length > 0 && normalizedTargetDir !== null
  const parametersLocked = completedHostIds.size > 0 || failures.some((failure) => !failure.retryable)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }
    setSearch('')
    setSelectedSessionIds([])
    setTargetDirInput('')
    setConflictPolicy('rename')
    setSelectionError('')
    setSubmitError('')
    setFailures([])
    setOutcome(null)
    setCompletedSessionIds(new Set())
    setCompletedHostIds(new Set())
  }, [open, sourceIdentity])

  useEffect(() => {
    if (!open || !active || submittingRef.current) {
      return
    }
    setSelectedSessionIds((current) => reconcileRemoteCopyBatchSelection([
      ...current,
      ...resolvedFailures
        .filter((failure) => failure.retryable && !completedHostIds.has(failure.hostId))
        .map((failure) => failure.sessionId),
    ], allTargets))
  }, [active, allTargets, completedHostIds, open, resolvedFailures])

  const toggleTarget = useCallback((sessionId: string) => {
    if (submittingRef.current || parametersLocked) {
      return
    }
    const target = allTargetsRef.current.find((candidate) => candidate.session.id === sessionId)
    if (!target || completedHostIds.has(target.host.id)) {
      return
    }
    const result = toggleRemoteCopyBatchTarget(
      selectedSessionIds,
      sessionId,
      allTargetsRef.current,
    )
    setSelectionError(result.limitReached ? 'files.remoteCopy.batchTargetLimit' : '')
    setFailures((currentFailures) => currentFailures.filter(
      (failure) => result.sessionIds.includes(failure.sessionId),
    ))
    setOutcome(null)
    setSelectedSessionIds(result.sessionIds)
  }, [completedHostIds, parametersLocked, selectedSessionIds])

  const changeTargetDir = useCallback((value: string) => {
    if (submittingRef.current || parametersLocked) {
      return
    }
    setTargetDirInput(value)
    setSubmitError('')
    setFailures([])
    setOutcome(null)
  }, [parametersLocked])

  const changeConflictPolicy = useCallback((value: RemoteCopyConflictPolicy) => {
    if (submittingRef.current || parametersLocked) {
      return
    }
    setConflictPolicy(value)
    setSubmitError('')
    setFailures([])
    setOutcome(null)
  }, [parametersLocked])

  const submit = useCallback(async () => {
    if (
      submittingRef.current
      || !active
      || !sourceValidation.valid
      || selectedTargets.length === 0
      || !normalizedTargetDir
    ) {
      return false
    }

    const frozenTargets = [...selectedTargets]
    const frozenPolicy = conflictPolicy
    const frozenTargetDir = normalizedTargetDir
    const frozenSourceIdentity = sourceIdentity
    const frozenViewEpoch = viewEpochRef.current
    const preservedFailures = resolvedFailures.filter((failure) => !failure.retryable)
    submittingRef.current = true
    setSubmitting(true)
    setSelectionError('')
    setSubmitError('')

    try {
      if (frozenPolicy === 'overwrite') {
        const confirmed = await confirmOverwrite({
          mode: 'batch',
          sourceCount: source.entries.length,
          targetCount: frozenTargets.length,
          targetPath: frozenTargetDir,
        })
        if (!confirmed) {
          return false
        }
      }
      if (
        !mountedRef.current
        || !openRef.current
        || !activeRef.current
        || sourceIdentityRef.current !== frozenSourceIdentity
        || viewEpochRef.current !== frozenViewEpoch
      ) {
        return false
      }

      const latestTargetById = new Map(
        allTargetsRef.current.map((target) => [target.session.id, target]),
      )
      const immediateFailures: RemoteCopyBatchFailure[] = []
      const validTargets: RemoteCopyTargetSession[] = []
      for (const target of frozenTargets) {
        const latest = latestTargetById.get(target.session.id)
        if (
          !latest
          || latest.session.connection_generation !== target.session.connection_generation
        ) {
          immediateFailures.push(toBatchFailure(target, 'files.remoteCopy.sessionChanged'))
          continue
        }
        validTargets.push(target)
      }

      const results = await Promise.allSettled(validTargets.map((target) => (
        createRemoteCopy({
          sourceFileSessionId: source.fileSessionId,
          sourceConnectionGeneration: source.connectionGeneration,
          targetFileSessionId: target.session.id,
          targetConnectionGeneration: target.session.connection_generation,
          sourcePaths: source.entries.map((entry) => entry.path),
          targetDir: frozenTargetDir,
          targetDirMode: 'create_if_missing',
          overwritePolicy: frozenPolicy,
        })
      )))

      const tasks: TransferTask[] = []
      const requestFailures = [...preservedFailures, ...immediateFailures]
      results.forEach((result, index) => {
        const target = validTargets[index]
        if (!target) {
          return
        }
        if (result.status === 'fulfilled') {
          tasks.push(result.value)
          return
        }
        requestFailures.push(isUncertainCreateFailure(result.reason)
          ? toBatchFailure(target, 'files.remoteCopy.batchUncertain', false)
          : toBatchFailure(target, errorMessage(result.reason)))
      })

      if (tasks.length > 0) {
        onCreated(tasks)
      }
      if (
        !mountedRef.current
        || !openRef.current
        || !activeRef.current
        || sourceIdentityRef.current !== frozenSourceIdentity
        || viewEpochRef.current !== frozenViewEpoch
      ) {
        return requestFailures.length === 0
      }

      const succeededSessionIds = new Set(
        validTargets
          .filter((_, index) => results[index]?.status === 'fulfilled')
          .map((target) => target.session.id),
      )
      const succeededHostIds = new Set(
        validTargets
          .filter((_, index) => results[index]?.status === 'fulfilled')
          .map((target) => target.host.id),
      )
      const cumulativeCompletedHostIds = new Set([...completedHostIds, ...succeededHostIds])
      setCompletedSessionIds((current) => new Set([...current, ...succeededSessionIds]))
      setCompletedHostIds(cumulativeCompletedHostIds)
      setSelectedSessionIds(requestFailures
        .filter((failure) => failure.retryable)
        .map((failure) => failure.sessionId))
      setFailures(requestFailures)
      setOutcome({
        createdCount: cumulativeCompletedHostIds.size,
        failures: requestFailures,
      })

      if (requestFailures.length === 0) {
        onClose()
        return true
      }
      return false
    } catch (error) {
      if (
        mountedRef.current
        && openRef.current
        && activeRef.current
        && sourceIdentityRef.current === frozenSourceIdentity
        && viewEpochRef.current === frozenViewEpoch
      ) {
        setSubmitError(errorMessage(error))
      }
      return false
    } finally {
      submittingRef.current = false
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }, [
    active,
    conflictPolicy,
    completedHostIds,
    confirmOverwrite,
    createRemoteCopy,
    normalizedTargetDir,
    onClose,
    onCreated,
    resolvedFailures,
    selectedTargets,
    source,
    sourceIdentity,
    sourceValidation.valid,
  ])

  return {
    allTargets,
    visibleTargets,
    selectedSessionIds,
    selectedTargets,
    completedSessionIds,
    completedHostIds,
    failures: resolvedFailures,
    outcome: outcome ? { ...outcome, failures: resolvedFailures } : null,
    search,
    setSearch,
    toggleTarget,
    targetDirInput,
    normalizedTargetDir,
    targetDirValid,
    parametersLocked,
    changeTargetDir,
    conflictPolicy,
    setConflictPolicy: changeConflictPolicy,
    selectionError,
    submitError,
    sourceValidation,
    submitting,
    canSubmit: Boolean(
      active
      && sourceValidation.valid
      && selectedTargets.length > 0
      && targetDirValid
      && !submitting
    ),
    targetLimit: remoteCopyBatchTargetLimit,
    submit,
  }
}

function toBatchFailure(
  target: RemoteCopyTargetSession,
  message: string,
  retryable = true,
): RemoteCopyBatchFailure {
  return {
    sessionId: target.session.id,
    hostId: target.host.id,
    hostName: target.host.name,
    message,
    retryable,
  }
}

function isUncertainCreateFailure(error: unknown) {
  return error instanceof TermousApiError && error.status === 0
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
