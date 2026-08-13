import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LocalPathMapping } from '#entities/file'
import type { LocalDownloadGateway } from './localDownloadGateway'
import type {
  LocalDownloadRefreshRequest,
  LocalDownloadTargetPreference,
} from './types'
import {
  beginLocalDirectoryRequest,
  cancelLocalDirectoryRequest,
  completeLocalDirectoryRequest,
  createLocalDirectoryViewState,
  failLocalDirectoryRequest,
  isLocalDirectoryBusy,
  isLocalPathWithin,
  localPathEquals,
  localPathParent,
  resolveLocalDownloadRefreshMapping,
  resolveLocalDownloadSelectedMapping,
  syncLocalDirectoryViewRoot,
  type LocalDirectoryRequestKind,
  type LocalDirectoryViewState,
} from './localDownloadWorkspaceState'

interface UseLocalDownloadWorkspaceOptions {
  api: LocalDownloadGateway
  mappings: readonly LocalPathMapping[]
  open: boolean
  preferredTarget?: LocalDownloadTargetPreference | null
  refreshRequests?: readonly LocalDownloadRefreshRequest[]
  loadErrorMessage: string
}

type LocalDirectoryStates = Record<string, LocalDirectoryViewState>

export function useLocalDownloadWorkspace({
  api,
  mappings,
  open,
  preferredTarget,
  refreshRequests = [],
  loadErrorMessage,
}: UseLocalDownloadWorkspaceOptions) {
  const preferredMappingId = preferredTarget?.mappingId
  const preferredPath = preferredTarget?.path
  const [selectedMappingId, setSelectedMappingId] = useState(
    () => resolveLocalDownloadSelectedMapping(
      mappings,
      '',
      preferredMappingId,
    )?.id ?? '',
  )
  const [states, setStates] = useState<LocalDirectoryStates>({})
  const statesRef = useRef(states)
  const selectedMappingIdRef = useRef(selectedMappingId)
  const controllersRef = useRef(new Map<string, AbortController>())
  const processedRefreshIdsRef = useRef(new Set<string>())
  const wasOpenRef = useRef(false)

  statesRef.current = states
  selectedMappingIdRef.current = selectedMappingId

  const commitStates = useCallback((updater: (current: LocalDirectoryStates) => LocalDirectoryStates) => {
    setStates((current) => {
      const next = updater(current)
      statesRef.current = next
      return next
    })
  }, [])

  const cancelMappingRequest = useCallback((mappingId: string) => {
    controllersRef.current.get(mappingId)?.abort()
    controllersRef.current.delete(mappingId)
    commitStates((current) => {
      const state = current[mappingId]
      if (!state) {
        return current
      }
      const nextState = cancelLocalDirectoryRequest(state)
      return nextState === state ? current : { ...current, [mappingId]: nextState }
    })
  }, [commitStates])

  const loadDirectory = useCallback((
    mapping: LocalPathMapping,
    path: string,
    kind: LocalDirectoryRequestKind,
  ) => {
    if (!mapping.available || !isLocalPathWithin(path, mapping.path)) {
      return
    }
    controllersRef.current.get(mapping.id)?.abort()
    const controller = new AbortController()
    controllersRef.current.set(mapping.id, controller)
    const currentState = syncLocalDirectoryViewRoot(
      statesRef.current[mapping.id] ?? createLocalDirectoryViewState(mapping),
      mapping,
    )
    const request = beginLocalDirectoryRequest(currentState, path, kind)
    commitStates((current) => ({
      ...current,
      [mapping.id]: request.state,
    }))

    void api.localPathMappingChildren(mapping.id, request.path, controller.signal)
      .then((entries) => {
        if (controller.signal.aborted) {
          return
        }
        commitStates((current) => {
          const state = current[mapping.id]
          if (!state) {
            return current
          }
          const nextState = completeLocalDirectoryRequest(
            state,
            request.requestSequence,
            request.path,
            entries,
          )
          return nextState === state ? current : { ...current, [mapping.id]: nextState }
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        const message = error instanceof Error ? error.message : loadErrorMessage
        commitStates((current) => {
          const state = current[mapping.id]
          if (!state) {
            return current
          }
          const nextState = failLocalDirectoryRequest(
            state,
            request.requestSequence,
            request.path,
            request.kind,
            message,
          )
          return nextState === state ? current : { ...current, [mapping.id]: nextState }
        })
      })
      .finally(() => {
        if (controllersRef.current.get(mapping.id) === controller) {
          controllersRef.current.delete(mapping.id)
        }
      })
  }, [api, commitStates, loadErrorMessage])

  const selectMapping = useCallback((mappingId: string) => {
    const previousMappingId = selectedMappingIdRef.current
    if (previousMappingId && previousMappingId !== mappingId) {
      cancelMappingRequest(previousMappingId)
    }
    selectedMappingIdRef.current = mappingId
    setSelectedMappingId(mappingId)
    const mapping = mappings.find((item) => item.id === mappingId)
    if (!open || !mapping?.available) {
      return
    }
    const state = statesRef.current[mapping.id]
    if (!state?.hasLoaded && !isLocalDirectoryBusy(state?.status ?? 'idle')) {
      loadDirectory(mapping, mapping.path, 'load')
    }
  }, [cancelMappingRequest, loadDirectory, mappings, open])

  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === selectedMappingId)
      ?? resolveLocalDownloadSelectedMapping(
        mappings,
        '',
        preferredMappingId,
      ),
    [mappings, preferredMappingId, selectedMappingId],
  )
  const selectedState = selectedMapping
    ? states[selectedMapping.id] ?? createLocalDirectoryViewState(selectedMapping)
    : null

  const navigate = useCallback((path: string) => {
    if (!selectedMapping || !isLocalPathWithin(path, selectedMapping.path)) {
      return
    }
    loadDirectory(selectedMapping, path, 'navigate')
  }, [loadDirectory, selectedMapping])

  const navigateParent = useCallback(() => {
    if (!selectedMapping || !selectedState) {
      return
    }
    const parent = localPathParent(selectedState.committedPath, selectedMapping.path)
    if (parent !== selectedState.committedPath) {
      loadDirectory(selectedMapping, parent, 'navigate')
    }
  }, [loadDirectory, selectedMapping, selectedState])

  const refresh = useCallback(() => {
    if (!selectedMapping || !selectedState) {
      return
    }
    loadDirectory(selectedMapping, selectedState.committedPath, 'refresh')
  }, [loadDirectory, selectedMapping, selectedState])

  const retry = useCallback(() => {
    if (!selectedMapping || !selectedState?.retry) {
      return
    }
    loadDirectory(selectedMapping, selectedState.retry.path, selectedState.retry.kind)
  }, [loadDirectory, selectedMapping, selectedState])

  useEffect(() => {
    const mappingsById = new Map(mappings.map((mapping) => [mapping.id, mapping]))
    controllersRef.current.forEach((_controller, mappingId) => {
      const mapping = mappingsById.get(mappingId)
      const state = statesRef.current[mappingId]
      if (
        !mapping?.available
        || !state
        || !localPathEquals(state.rootPath, mapping.path)
      ) {
        cancelMappingRequest(mappingId)
      }
    })
    commitStates((current) => {
      const next: LocalDirectoryStates = {}
      mappings.forEach((mapping) => {
        next[mapping.id] = syncLocalDirectoryViewRoot(
          current[mapping.id] ?? createLocalDirectoryViewState(mapping),
          mapping,
        )
      })
      return next
    })
  }, [cancelMappingRequest, commitStates, mappings])

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        controllersRef.current.forEach((controller) => controller.abort())
        controllersRef.current.clear()
        commitStates((current) => Object.fromEntries(
          Object.entries(current).map(([mappingId, state]) => [
            mappingId,
            cancelLocalDirectoryRequest(state),
          ]),
        ))
      }
      wasOpenRef.current = false
      return
    }

    const selected = resolveLocalDownloadSelectedMapping(
      mappings,
      selectedMappingId,
      preferredMappingId,
    )
    if (wasOpenRef.current && selected) {
      const selectedState = statesRef.current[selected.id]
      const targetPath = preferredMappingId === selected.id
        && preferredPath
        && isLocalPathWithin(preferredPath, selected.path)
        ? preferredPath
        : selectedState?.committedPath || selected.path
      if (
        selected.available
        && !isLocalDirectoryBusy(selectedState?.status ?? 'idle')
        && (
          !selectedState?.hasLoaded
          || !localPathEquals(selectedState.committedPath, targetPath)
        )
      ) {
        loadDirectory(selected, targetPath, selectedState?.hasLoaded ? 'navigate' : 'load')
      }
      return
    }
    wasOpenRef.current = true
    const nextMapping = resolveLocalDownloadSelectedMapping(
      mappings,
      selectedMappingId,
      preferredMappingId,
    )
    if (!nextMapping) {
      selectedMappingIdRef.current = ''
      setSelectedMappingId('')
      return
    }
    const targetPath = preferredMappingId === nextMapping.id
      && preferredPath
      && isLocalPathWithin(preferredPath, nextMapping.path)
      ? preferredPath
      : nextMapping.path
    selectedMappingIdRef.current = nextMapping.id
    setSelectedMappingId(nextMapping.id)
    const nextState = statesRef.current[nextMapping.id]
    if (
      nextMapping.available
      && !isLocalDirectoryBusy(nextState?.status ?? 'idle')
      && (
        !nextState?.hasLoaded
        || !localPathEquals(nextState.committedPath, targetPath)
      )
    ) {
      loadDirectory(nextMapping, targetPath, nextState?.hasLoaded ? 'navigate' : 'load')
    }
  }, [
    commitStates,
    loadDirectory,
    mappings,
    open,
    preferredMappingId,
    preferredPath,
    selectedMappingId,
  ])

  useEffect(() => () => {
    controllersRef.current.forEach((controller) => controller.abort())
    controllersRef.current.clear()
  }, [])

  useEffect(() => {
    const activeIds = new Set(refreshRequests.map((request) => request.id))
    processedRefreshIdsRef.current.forEach((requestId) => {
      if (!activeIds.has(requestId)) {
        processedRefreshIdsRef.current.delete(requestId)
      }
    })
    refreshRequests.forEach((request) => {
      if (processedRefreshIdsRef.current.has(request.id)) {
        return
      }
      const mapping = resolveLocalDownloadRefreshMapping(mappings, request)
      const state = mapping ? statesRef.current[mapping.id] : null
      if (
        mapping
        && mapping.available
        && state?.hasLoaded
        && localPathEquals(state.committedPath, request.targetPath)
        && !isLocalDirectoryBusy(state.status)
      ) {
        processedRefreshIdsRef.current.add(request.id)
        loadDirectory(mapping, state.committedPath, 'refresh')
      }
    })
  }, [loadDirectory, mappings, refreshRequests, states])

  return {
    selectedMapping,
    selectedMappingId: selectedMapping?.id ?? '',
    selectedState,
    states,
    selectMapping,
    navigate,
    navigateParent,
    refresh,
    retry,
    cancelMappingRequest,
  }
}
