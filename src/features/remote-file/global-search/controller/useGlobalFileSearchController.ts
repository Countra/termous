import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FileNameSearchCapability,
  FileNameSearchEntryType,
  FileNameSearchResult,
} from '#entities/file'
import { TermousApiError } from '#shared/api'
import type {
  FileNameSearchCapabilityPhase,
  FileNameSearchPhase,
  GlobalFileSearchAdvancedFilters,
  GlobalFileSearchModalProps,
  GlobalFileSearchScope,
} from '../model/types'
import {
  areGlobalFileSearchAdvancedFiltersValid,
  buildGlobalFileSearchRequest,
  canRunGlobalFileSearch,
  countGlobalFileSearchAdvancedFilters,
  createDefaultGlobalFileSearchAdvancedFilters,
  isCurrentGlobalFileSearchResult,
  normalizeGlobalFileSearchQuery,
} from '../model/globalFileSearchModel'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isFileNameSearchUnavailable(error: unknown) {
  return error instanceof TermousApiError
    && error.code === 'SFTP_FILE_SEARCH_UNAVAILABLE'
}

export function useGlobalFileSearchController({ api, open, source }: GlobalFileSearchModalProps) {
  const [capability, setCapability] = useState<FileNameSearchCapability | null>(null)
  const [capabilityPhase, setCapabilityPhase] = useState<FileNameSearchCapabilityPhase>('idle')
  const [capabilityError, setCapabilityError] = useState('')
  const [query, setQueryState] = useState('')
  const [entryType, setEntryType] = useState<FileNameSearchEntryType>('all')
  const [oneFileSystem, setOneFileSystem] = useState(false)
  const [searchScope, setSearchScopeState] = useState<GlobalFileSearchScope>('system')
  const [advancedFilters, setAdvancedFilters] = useState(
    createDefaultGlobalFileSearchAdvancedFilters,
  )
  const [searchPhase, setSearchPhase] = useState<FileNameSearchPhase>('idle')
  const [searchError, setSearchError] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [result, setResult] = useState<FileNameSearchResult | null>(null)
  const capabilitySequenceRef = useRef(0)
  const searchSequenceRef = useRef(0)
  const capabilityControllerRef = useRef<AbortController | null>(null)
  const searchControllerRef = useRef<AbortController | null>(null)
  const installControllerRef = useRef<AbortController | null>(null)

  const sourceIdentity = [
    source.fileSessionId,
    String(source.connectionGeneration),
  ].join('\u0000')

  const detectCapability = useCallback(async (phase: 'detecting' | 'verifying' = 'detecting') => {
    capabilityControllerRef.current?.abort()
    const sequence = ++capabilitySequenceRef.current
    const controller = new AbortController()
    capabilityControllerRef.current = controller
    setCapabilityPhase(phase)
    setCapabilityError('')
    try {
      const next = await api.fileNameSearchCapability(
        source.fileSessionId,
        source.connectionGeneration,
        controller.signal,
      )
      if (controller.signal.aborted || capabilitySequenceRef.current !== sequence) {
        return null
      }
      if (next.connection_generation !== source.connectionGeneration) {
        throw new Error('FILE_SESSION_GENERATION_CHANGED')
      }
      setCapability(next)
      setCapabilityPhase(next.status === 'ready' ? 'ready' : 'idle')
      return next
    } catch (error) {
      if (controller.signal.aborted || capabilitySequenceRef.current !== sequence) {
        return null
      }
      setCapability(null)
      setCapabilityError(errorMessage(error))
      setCapabilityPhase('failed')
      return null
    }
  }, [api, source.connectionGeneration, source.fileSessionId])

  useEffect(() => {
    capabilityControllerRef.current?.abort()
    searchControllerRef.current?.abort()
    installControllerRef.current?.abort()
    capabilitySequenceRef.current += 1
    searchSequenceRef.current += 1
    setCapability(null)
    setCapabilityPhase('idle')
    setCapabilityError('')
    setQueryState('')
    setEntryType('all')
    setOneFileSystem(false)
    setSearchScopeState('system')
    setAdvancedFilters(createDefaultGlobalFileSearchAdvancedFilters())
    setSearchPhase('idle')
    setSearchError('')
    setSearchedQuery('')
    setResult(null)
    return () => {
      capabilityControllerRef.current?.abort()
      searchControllerRef.current?.abort()
      installControllerRef.current?.abort()
    }
  }, [sourceIdentity])

  useEffect(() => {
    if (!open) {
      capabilityControllerRef.current?.abort()
      return undefined
    }
    if (capability !== null) {
      return undefined
    }
    void detectCapability()
    return () => capabilityControllerRef.current?.abort()
  }, [capability, detectCapability, open])

  useEffect(() => {
    if (open || (searchPhase !== 'running' && searchPhase !== 'stopping')) {
      return
    }
    searchSequenceRef.current += 1
    searchControllerRef.current?.abort()
    searchControllerRef.current = null
    setSearchPhase('cancelled')
  }, [open, searchPhase])

  const setQuery = useCallback((value: string) => {
    setQueryState(normalizeGlobalFileSearchQuery(value))
  }, [])

  const setAdvancedFilter = useCallback(<Key extends keyof GlobalFileSearchAdvancedFilters>(
    key: Key,
    value: GlobalFileSearchAdvancedFilters[Key],
  ) => {
    setAdvancedFilters((current) => (
      Object.is(current[key], value) ? current : { ...current, [key]: value }
    ))
  }, [])

  const resetAdvancedFilters = useCallback(() => {
    setSearchScopeState('system')
    setAdvancedFilters(createDefaultGlobalFileSearchAdvancedFilters())
  }, [])

  const setSearchScope = useCallback((value: GlobalFileSearchScope) => {
    setSearchScopeState(value)
    setAdvancedFilters((current) => {
      const searchRoot = value === 'system' ? '/' : source.currentPath
      return current.searchRoot === searchRoot
        ? current
        : { ...current, searchRoot }
    })
  }, [source.currentPath])

  const runSearch = useCallback(async () => {
    const normalizedQuery = normalizeGlobalFileSearchQuery(query)
    if (
      !canRunGlobalFileSearch(normalizedQuery, capability)
      || !areGlobalFileSearchAdvancedFiltersValid(advancedFilters, entryType)
    ) {
      return false
    }
    searchControllerRef.current?.abort()
    const sequence = ++searchSequenceRef.current
    const controller = new AbortController()
    searchControllerRef.current = controller
    setSearchPhase('running')
    setSearchError('')
    try {
      const next = await api.searchFileSessionNames(
        source.fileSessionId,
        buildGlobalFileSearchRequest({
          connectionGeneration: source.connectionGeneration,
          query: normalizedQuery,
          entryType,
          oneFileSystem,
          filters: advancedFilters,
        }),
        controller.signal,
      )
      if (searchSequenceRef.current !== sequence) {
        return false
      }
      if (controller.signal.aborted) {
        setSearchPhase('cancelled')
        return false
      }
      if (!isCurrentGlobalFileSearchResult(next, source.connectionGeneration)) {
        throw new Error('FILE_SESSION_GENERATION_CHANGED')
      }
      setResult(next)
      setSearchedQuery(normalizedQuery)
      setSearchPhase('completed')
      return true
    } catch (error) {
      if (searchSequenceRef.current !== sequence) {
        return false
      }
      if (controller.signal.aborted) {
        setSearchPhase('cancelled')
        return false
      }
      if (isFileNameSearchUnavailable(error)) {
        setCapability(null)
        setCapabilityPhase('idle')
        setSearchError('')
        setSearchPhase('idle')
        return false
      }
      setSearchError(errorMessage(error))
      setSearchPhase('failed')
      return false
    } finally {
      if (searchControllerRef.current === controller) {
        searchControllerRef.current = null
      }
    }
  }, [
    advancedFilters,
    api,
    capability,
    entryType,
    oneFileSystem,
    query,
    source.connectionGeneration,
    source.fileSessionId,
  ])

  const stopSearch = useCallback(() => {
    if (searchPhase !== 'running') {
      return
    }
    setSearchPhase('stopping')
    searchControllerRef.current?.abort()
  }, [searchPhase])

  const install = useCallback(async () => {
    const planHash = capability?.install_plan?.plan_hash
    if (!planHash || !capability.install_available) {
      return false
    }
    const controller = new AbortController()
    installControllerRef.current = controller
    setCapabilityPhase('installing')
    setCapabilityError('')
    try {
      const installed = await api.installFileNameSearch(source.fileSessionId, {
        expected_connection_generation: source.connectionGeneration,
        expected_plan_hash: planHash,
        confirmed: true,
      }, controller.signal)
      if (controller.signal.aborted) {
        return false
      }
      if (installed.connection_generation !== source.connectionGeneration) {
        throw new Error('FILE_SESSION_GENERATION_CHANGED')
      }
      setCapability(installed)
      if (installed.status === 'ready') {
        setCapabilityPhase('ready')
        return true
      }
      return (await detectCapability('verifying'))?.status === 'ready'
    } catch (error) {
      if (!controller.signal.aborted) {
        setCapabilityError(errorMessage(error))
        setCapabilityPhase('failed')
      }
      return false
    } finally {
      if (installControllerRef.current === controller) {
        installControllerRef.current = null
      }
    }
  }, [api, capability, detectCapability, source.connectionGeneration, source.fileSessionId])

  const searchBusy = searchPhase === 'running' || searchPhase === 'stopping'
  const installBusy = capabilityPhase === 'installing' || capabilityPhase === 'verifying'
  const canSearch = useMemo(
    () => canRunGlobalFileSearch(query, capability)
      && areGlobalFileSearchAdvancedFiltersValid(advancedFilters, entryType)
      && !searchBusy
      && !installBusy,
    [advancedFilters, capability, entryType, installBusy, query, searchBusy],
  )
  const activeAdvancedFilterCount = useMemo(
    () => countGlobalFileSearchAdvancedFilters(advancedFilters),
    [advancedFilters],
  )

  return {
    capability,
    capabilityPhase,
    capabilityError,
    query,
    entryType,
    oneFileSystem,
    searchScope,
    advancedFilters,
    activeAdvancedFilterCount,
    searchPhase,
    searchError,
    searchedQuery,
    result,
    searchBusy,
    installBusy,
    canSearch,
    setQuery,
    setEntryType,
    setOneFileSystem,
    setSearchScope,
    setAdvancedFilter,
    resetAdvancedFilters,
    detectCapability,
    runSearch,
    stopSearch,
    install,
  }
}
