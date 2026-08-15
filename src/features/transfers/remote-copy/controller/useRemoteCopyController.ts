import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RemoteDirectoryListing } from '#entities/file'
import { joinPath, normalizeRemotePosixPath } from '#shared/path'
import {
  filterRemoteCopyTargetSessions,
  normalizeRemoteCopyDirectory,
  normalizeRemoteCopyFolderName,
  remoteCopyParentPath,
  validateRemoteCopySource,
} from '../model/remoteCopyModel.ts'
import type {
  RemoteCopyConflictPolicy,
  RemoteCopyModalProps,
  RemoteCopyTargetSession,
} from '../model/types.ts'

type DirectoryStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface RemoteCopyDirectoryState {
  status: DirectoryStatus
  fileSessionId: string
  connectionGeneration: number
  requestedPath: string
  listing: RemoteDirectoryListing | null
  error: string
}

const emptyDirectoryState: RemoteCopyDirectoryState = {
  status: 'idle',
  fileSessionId: '',
  connectionGeneration: 0,
  requestedPath: '',
  listing: null,
  error: '',
}

export function useRemoteCopyController(props: RemoteCopyModalProps) {
  const {
    open,
    source,
    hosts,
    fileSessions,
    listDirectories,
    createDirectory,
    createRemoteCopy,
    confirmOverwrite,
    onCreated,
    onClose,
  } = props
  const sourceValidation = useMemo(
    () => validateRemoteCopySource(source.entries),
    [source.entries],
  )
  const allTargets = useMemo(
    () => filterRemoteCopyTargetSessions(hosts, fileSessions, source.hostId),
    [fileSessions, hosts, source.hostId],
  )
  const [search, setSearch] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [pathInput, setPathInput] = useState('/')
  const [conflictPolicy, setConflictPolicy] = useState<RemoteCopyConflictPolicy>('rename')
  const [directory, setDirectory] = useState<RemoteCopyDirectoryState>(emptyDirectoryState)
  const [creatingDirectory, setCreatingDirectory] = useState(false)
  const [createDirectoryError, setCreateDirectoryError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const browseAbortRef = useRef<AbortController | null>(null)
  const browseSequenceRef = useRef(0)
  const creatingDirectoryRef = useRef(false)
  const submittingRef = useRef(false)
  const mountedRef = useRef(false)
  const openRef = useRef(open)
  const allTargetsRef = useRef(allTargets)
  const selectedTargetRef = useRef<RemoteCopyTargetSession | null>(null)
  const sourceIdentity = JSON.stringify({
    hostId: source.hostId,
    fileSessionId: source.fileSessionId,
    connectionGeneration: source.connectionGeneration,
    entries: source.entries.map((entry) => ({ path: entry.path, kind: entry.kind })),
  })
  const sourceIdentityRef = useRef(sourceIdentity)
  openRef.current = open

  const selectedTarget = useMemo(
    () => allTargets.find((candidate) => candidate.session.id === selectedSessionId) ?? null,
    [allTargets, selectedSessionId],
  )
  const visibleTargets = useMemo(() => {
    const filteredTargets = filterRemoteCopyTargetSessions(
      hosts,
      fileSessions,
      source.hostId,
      search,
    )
    if (
      !selectedTarget
      || filteredTargets.some((target) => target.session.id === selectedTarget.session.id)
    ) {
      return filteredTargets
    }
    return [selectedTarget, ...filteredTargets]
  }, [fileSessions, hosts, search, selectedTarget, source.hostId])
  const currentPath = directory.listing?.path ?? ''
  const normalizedPathInput = normalizeRemotePosixPath(pathInput)
  const pathInputValid = normalizedPathInput !== null

  const cancelBrowse = useCallback(() => {
    browseSequenceRef.current += 1
    browseAbortRef.current?.abort()
    browseAbortRef.current = null
  }, [])

  useEffect(() => {
    allTargetsRef.current = allTargets
    sourceIdentityRef.current = sourceIdentity
    selectedTargetRef.current = selectedTarget
  }, [allTargets, selectedTarget, sourceIdentity])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadDirectory = useCallback(async (
    target: RemoteCopyTargetSession,
    path: string,
  ) => {
    const normalizedPath = normalizeRemotePosixPath(path)
    if (!normalizedPath) {
      return false
    }
    cancelBrowse()
    const sequence = browseSequenceRef.current
    const abortController = new AbortController()
    browseAbortRef.current = abortController
    setCreateDirectoryError('')
    setDirectory((current) => ({
      status: 'loading',
      fileSessionId: target.session.id,
      connectionGeneration: target.session.connection_generation,
      requestedPath: normalizedPath,
      listing: current.fileSessionId === target.session.id
        && current.connectionGeneration === target.session.connection_generation
        ? current.listing
        : null,
      error: '',
    }))
    try {
      const listing = await listDirectories({
        fileSessionId: target.session.id,
        path: normalizedPath,
        rememberPath: false,
        signal: abortController.signal,
      })
      if (sequence !== browseSequenceRef.current || abortController.signal.aborted) {
        return false
      }
      const listingPath = normalizeRemoteCopyDirectory(listing.path, normalizedPath)
      setDirectory({
        status: 'ready',
        fileSessionId: target.session.id,
        connectionGeneration: target.session.connection_generation,
        requestedPath: listingPath,
        listing: {
          ...listing,
          path: listingPath,
          parent_path: normalizeRemoteCopyDirectory(
            listing.parent_path,
            remoteCopyParentPath(listingPath),
          ),
          entries: listing.entries
            .filter((entry) => entry.kind === 'directory')
            .sort((left, right) => left.name.localeCompare(right.name)),
        },
        error: '',
      })
      setPathInput(listingPath)
      return true
    } catch (error) {
      if (
        sequence !== browseSequenceRef.current
        || abortController.signal.aborted
        || isAbortError(error)
      ) {
        return false
      }
      setDirectory((current) => ({
        status: 'failed',
        fileSessionId: target.session.id,
        connectionGeneration: target.session.connection_generation,
        requestedPath: normalizedPath,
        listing: current.fileSessionId === target.session.id
          && current.connectionGeneration === target.session.connection_generation
          ? current.listing
          : null,
        error: error instanceof Error ? error.message : String(error),
      }))
      return false
    } finally {
      if (browseAbortRef.current === abortController) {
        browseAbortRef.current = null
      }
    }
  }, [cancelBrowse, listDirectories])

  useEffect(() => {
    if (!open) {
      return
    }
    setSearch('')
    setConflictPolicy('rename')
    setCreateDirectoryError('')
    setSubmitError('')
    setSelectedSessionId(allTargetsRef.current[0]?.session.id ?? '')
  }, [open, sourceIdentity])

  useEffect(() => {
    if (!open) {
      cancelBrowse()
      setDirectory(emptyDirectoryState)
      setCreateDirectoryError('')
      setSubmitError('')
      return
    }
    setSelectedSessionId((current) => (
      allTargets.some((candidate) => candidate.session.id === current)
        ? current
        : allTargets[0]?.session.id ?? ''
    ))
  }, [allTargets, cancelBrowse, open])

  const selectedTargetSessionId = selectedTarget?.session.id ?? ''
  const selectedTargetGeneration = selectedTarget?.session.connection_generation ?? 0
  useEffect(() => {
    const target = selectedTargetRef.current
    if (!open || !target) {
      cancelBrowse()
      setDirectory(emptyDirectoryState)
      return
    }
    const initialPath = normalizeRemoteCopyDirectory(target.session.current_path)
    setPathInput(initialPath)
    setSubmitError('')
    void loadDirectory(target, initialPath)
  }, [
    cancelBrowse,
    loadDirectory,
    open,
    selectedTargetGeneration,
    selectedTargetSessionId,
  ])

  useEffect(() => cancelBrowse, [cancelBrowse])

  const selectTarget = useCallback((sessionId: string) => {
    if (submittingRef.current || creatingDirectoryRef.current) {
      return
    }
    setSelectedSessionId(sessionId)
  }, [])

  const navigate = useCallback((path: string) => {
    if (!selectedTarget || submittingRef.current || creatingDirectoryRef.current) {
      return Promise.resolve(false)
    }
    return loadDirectory(selectedTarget, path)
  }, [loadDirectory, selectedTarget])

  const clearCreateDirectoryError = useCallback(() => {
    setCreateDirectoryError('')
  }, [])

  const createTargetDirectory = useCallback(async (value: string) => {
    const name = normalizeRemoteCopyFolderName(value)
    if (!name) {
      setCreateDirectoryError('files.remoteCopy.folderNameInvalid')
      return false
    }
    if (
      creatingDirectoryRef.current
      || submittingRef.current
      || !selectedTarget
      || directory.status !== 'ready'
      || directory.fileSessionId !== selectedTarget.session.id
      || directory.connectionGeneration !== selectedTarget.session.connection_generation
      || !currentPath
      || normalizedPathInput !== currentPath
    ) {
      setCreateDirectoryError('files.remoteCopy.sessionChanged')
      return false
    }
    const frozenTarget = selectedTarget
    const frozenPath = currentPath
    const targetPath = joinPath(frozenPath, name)
    const currentTarget = allTargetsRef.current.find(
      (candidate) => candidate.session.id === frozenTarget.session.id,
    )
    if (
      !currentTarget
      || currentTarget.session.connection_generation !== frozenTarget.session.connection_generation
    ) {
      setCreateDirectoryError('files.remoteCopy.sessionChanged')
      return false
    }

    creatingDirectoryRef.current = true
    setCreatingDirectory(true)
    setCreateDirectoryError('')
    try {
      await createDirectory({
        fileSessionId: frozenTarget.session.id,
        connectionGeneration: frozenTarget.session.connection_generation,
        path: targetPath,
      })
      if (!mountedRef.current || !openRef.current) {
        return true
      }
      const latestTarget = allTargetsRef.current.find(
        (candidate) => candidate.session.id === frozenTarget.session.id,
      )
      if (
        latestTarget
        && selectedTargetRef.current?.session.id === frozenTarget.session.id
        && latestTarget.session.connection_generation === frozenTarget.session.connection_generation
        && selectedTargetRef.current.session.connection_generation === frozenTarget.session.connection_generation
      ) {
        await loadDirectory(latestTarget, frozenPath)
      }
      return true
    } catch (error) {
      if (mountedRef.current && openRef.current) {
        setCreateDirectoryError(error instanceof Error ? error.message : String(error))
      }
      return false
    } finally {
      creatingDirectoryRef.current = false
      if (mountedRef.current) {
        setCreatingDirectory(false)
      }
    }
  }, [
    createDirectory,
    currentPath,
    directory.connectionGeneration,
    directory.fileSessionId,
    directory.status,
    loadDirectory,
    normalizedPathInput,
    selectedTarget,
  ])

  const submit = useCallback(async () => {
    if (
      submittingRef.current
      || creatingDirectoryRef.current
      || !selectedTarget
      || !sourceValidation.valid
      || directory.status !== 'ready'
      || directory.fileSessionId !== selectedTarget.session.id
      || directory.connectionGeneration !== selectedTarget.session.connection_generation
      || !currentPath
      || normalizedPathInput !== currentPath
    ) {
      return false
    }
    submittingRef.current = true
    setSubmitting(true)
    setSubmitError('')
    const frozenPolicy = conflictPolicy
    const frozenTargetSessionId = selectedTarget.session.id
    const frozenTargetGeneration = selectedTarget.session.connection_generation
    const frozenSourceIdentity = sourceIdentity
    try {
      if (frozenPolicy === 'overwrite') {
        const confirmed = await confirmOverwrite({
          sourceCount: source.entries.length,
          targetHostName: selectedTarget.host.name,
          targetPath: currentPath,
        })
        if (!confirmed) {
          return false
        }
      }
      if (!mountedRef.current || !openRef.current) {
        return false
      }
      const currentTarget = allTargetsRef.current.find(
        (candidate) => candidate.session.id === frozenTargetSessionId,
      )
      if (
        !currentTarget
        || currentTarget.session.connection_generation !== frozenTargetGeneration
        || sourceIdentityRef.current !== frozenSourceIdentity
      ) {
        setSubmitError('files.remoteCopy.sessionChanged')
        return false
      }
      const task = await createRemoteCopy({
        sourceFileSessionId: source.fileSessionId,
        sourceConnectionGeneration: source.connectionGeneration,
        targetFileSessionId: frozenTargetSessionId,
        targetConnectionGeneration: frozenTargetGeneration,
        sourcePaths: source.entries.map((entry) => entry.path),
        targetDir: currentPath,
        overwritePolicy: frozenPolicy,
      })
      onCreated(task)
      onClose()
      return true
    } catch (error) {
      if (mountedRef.current && openRef.current) {
        setSubmitError(error instanceof Error ? error.message : String(error))
      }
      return false
    } finally {
      submittingRef.current = false
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }, [
    conflictPolicy,
    confirmOverwrite,
    createRemoteCopy,
    currentPath,
    directory.connectionGeneration,
    directory.fileSessionId,
    directory.status,
    normalizedPathInput,
    onClose,
    onCreated,
    selectedTarget,
    source,
    sourceIdentity,
    sourceValidation.valid,
  ])

  return {
    allTargets,
    visibleTargets,
    selectedTarget,
    selectedSessionId,
    selectTarget,
    search,
    setSearch,
    pathInput,
    setPathInput,
    pathInputValid,
    directory,
    currentPath,
    navigate,
    navigateParent: () => navigate(directory.listing?.parent_path ?? remoteCopyParentPath(currentPath || '/')),
    refresh: () => navigate(
      directory.status === 'failed'
        ? directory.requestedPath
        : currentPath || pathInput,
    ),
    creatingDirectory,
    createDirectoryError,
    clearCreateDirectoryError,
    createTargetDirectory,
    canCreateDirectory: Boolean(
      selectedTarget
      && directory.status === 'ready'
      && directory.fileSessionId === selectedTarget.session.id
      && directory.connectionGeneration === selectedTarget.session.connection_generation
      && currentPath
      && normalizedPathInput === currentPath
      && !submitting
      && !creatingDirectory
    ),
    conflictPolicy,
    setConflictPolicy,
    sourceValidation,
    submitting,
    submitError,
    canSubmit: Boolean(
      selectedTarget
      && sourceValidation.valid
      && directory.status === 'ready'
      && directory.fileSessionId === selectedTarget.session.id
      && directory.connectionGeneration === selectedTarget.session.connection_generation
      && currentPath
      && normalizedPathInput === currentPath
      && !creatingDirectory
    ),
    submit,
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
