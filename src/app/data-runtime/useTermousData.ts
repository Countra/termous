import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TermousApiError } from '#shared/api'
import {
  createRuntimeGateways,
  createRuntimeGatewaysFromConfig,
  type RuntimeGateways,
} from './api/runtimeGateways'
import type {
  ForwardEvent,
  ForwardInstance,
} from '#entities/forward'
import type { SessionSnapshotEvent } from '#entities/session'
import { sortCodeSnippetGroups } from '#entities/snippet'
import { normalizeSettings } from '#features/settings'
import { changeLanguage } from '#shared/i18n'
import {
  cleanupSuppressedFileSessionRecoveryResult,
  filterSuppressedFileSessions,
  releaseConfirmedFileSessionCloseSuppressions,
  isFileSessionRecoverySupersededError,
  runQueuedFileSessionRecoveryOperation,
  supersedeQueuedFileSessionRecovery,
  type FileSessionClosureState,
  type FileSessionSnapshotEvent,
  filterFileSessionsByActiveSources,
  reconcileFileSessionSnapshotList,
} from '#entities/file'
import {
  mergeSessionReloadSnapshot,
  sessionChangedSince,
} from './model/sessionInventoryState'
import {
  affectedSessionIds,
  decideSessionSnapshot,
  initialSessionSnapshotCursor,
} from './model/sessionSnapshotState'
import {
  affectedFileSessionIds,
  decideFileSessionSnapshot,
  initialFileSessionSnapshotCursor,
  reconcileVisibleAuthoritativeFileSessionSnapshot,
} from './model/fileSessionSnapshotState'
import {
  beginSnippetReload,
  canApplySnippetReload,
  initialSnippetRuntimeCursor,
  recoverFailedSnippetReload,
  resetSnippetEventRevision,
  snippetStateChangedSince,
  type SnippetReloadCheckpoint,
} from './model/snippetRuntimeState'
import { canApplyReloadedValue, SerialMutationQueue } from '#shared/async'
import {
  bumpSessionRevision,
  indexHostReachability,
  initialData,
  reconcileActiveSession,
  sessionInventorySignature,
  sortConnectionProxies,
  sortFileBookmarkGroups,
  sortFileBookmarks,
  sortHostIcons,
  sortLocalPathMappings,
  type LoadMode,
} from './model/appDataState'
import {
  reconcileForwardReloadSnapshot,
  reconcileForwardStartCompletions,
  type ForwardStartCompletionWaiter,
} from './model/forwardRuntimeState'
import { createCredentialCommands } from './commands/credentialCommands'
import { createFileCatalogCommands } from './commands/fileCatalogCommands'
import { createFileSessionCommands } from './commands/fileSessionCommands'
import { createForwardCommands } from './commands/forwardCommands'
import { createForwardProfileCommands } from './commands/forwardProfileCommands'
import { createHostCommands } from './commands/hostCommands'
import { createSessionCommands } from './commands/sessionCommands'
import { createSettingsCommands } from './commands/settingsCommands'
import { createSnippetCommands } from './commands/snippetCommands'
import { loadAppDataSnapshot } from './api/appDataSnapshotGateway'
import type { AppData } from './model/appData'
import type { Session } from './model/sessionTypes'

export function useTermousData() {
  const [gateways, setGateways] = useState(() => createRuntimeGatewaysFromConfig())
  const [data, setData] = useState<AppData>(initialData)
  const [initializing, setInitializing] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [apiReady, setApiReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [forwardErrorEvent, setForwardErrorEvent] = useState<ForwardEvent | null>(null)
  const [fileSessionClosures, setFileSessionClosures] = useState<Record<string, FileSessionClosureState>>({})
  const fileSessionRecoveryCloseEpochsRef = useRef(new Map<string, number>())
  const fileSessionRecoveryQueuesRef = useRef(new Map<string, Promise<void>>())
  const suppressedFileSessionIdsRef = useRef(new Map<string, string>())
  const closeSuppressedFileSessionIdsRef = useRef(new Set<string>())
  const scheduledFileSessionCleanupIdsRef = useRef(new Set<string>())
  const sessionEventRevisionsRef = useRef(new Map<string, number>())
  const sessionSnapshotCursorRef = useRef(initialSessionSnapshotCursor)
  const sessionSnapshotSessionsRef = useRef(data.sessions)
  const fileSessionEventRevisionsRef = useRef(new Map<string, number>())
  const fileSessionSnapshotCursorRef = useRef(initialFileSessionSnapshotCursor)
  const fileSessionSnapshotRevisionBaselineRef = useRef(new Map<string, number>())
  const fileSessionSnapshotKnownIdsRef = useRef(new Set<string>())
  const fileSessionSnapshotSessionsRef = useRef(data.fileSessions)
  const inventoryEventRevisionsRef = useRef(new Map<string, number>())
  const inventoryStateSignaturesRef = useRef(new Map<string, string>())
  const inventoryRequestRevisionsRef = useRef(new Map<string, number>())
  const forwardReloadChangeTrackersRef = useRef(new Set<Set<string>>())
  const forwardEventRevisionsRef = useRef(new Map<string, number>())
  const forwardEventSnapshotsRef = useRef(new Map<string, ForwardInstance>())
  const snippetRuntimeCursorRef = useRef(initialSnippetRuntimeCursor)
  const snippetReloadPendingRef = useRef<{
    gateways: RuntimeGateways
    checkpoint: SnippetReloadCheckpoint
  } | null>(null)
  const snippetReloadLoopRef = useRef<Promise<void> | null>(null)
  const completionSettingsMutationRef = useRef(0)
  const completionSettingsPendingWritesRef = useRef(0)
  const completionSettingsWriteQueueRef = useRef<SerialMutationQueue | null>(null)
  if (!completionSettingsWriteQueueRef.current) {
    completionSettingsWriteQueueRef.current = new SerialMutationQueue()
  }
  const completionSettingsWriteQueue = completionSettingsWriteQueueRef.current
  const completionSettingsRef = useRef(data.settings.completion)
  const completionSettingsConfirmedRef = useRef(data.settings.completion)
  completionSettingsRef.current = data.settings.completion
  const connectionSettingsMutationRef = useRef(0)
  const connectionSettingsPendingWritesRef = useRef(0)
  const connectionSettingsWriteQueueRef = useRef<SerialMutationQueue | null>(null)
  if (!connectionSettingsWriteQueueRef.current) {
    connectionSettingsWriteQueueRef.current = new SerialMutationQueue()
  }
  const connectionSettingsWriteQueue = connectionSettingsWriteQueueRef.current
  const connectionSettingsRef = useRef(data.settings.connection)
  const connectionSettingsConfirmedRef = useRef(data.settings.connection)
  connectionSettingsRef.current = data.settings.connection
  const shortcutSettingsMutationRef = useRef(0)
  const shortcutSettingsPendingWritesRef = useRef(0)
  const shortcutSettingsWriteQueueRef = useRef<SerialMutationQueue | null>(null)
  if (!shortcutSettingsWriteQueueRef.current) {
    shortcutSettingsWriteQueueRef.current = new SerialMutationQueue()
  }
  const shortcutSettingsWriteQueue = shortcutSettingsWriteQueueRef.current
  const shortcutSettingsRef = useRef(data.settings.shortcuts)
  const shortcutSettingsConfirmedRef = useRef(data.settings.shortcuts)
  shortcutSettingsRef.current = data.settings.shortcuts
  const forwardStartCompletionWaitersRef = useRef(
    new Map<string, ForwardStartCompletionWaiter>(),
  )
  const loadRevisionRef = useRef(0)
  sessionSnapshotSessionsRef.current = data.sessions
  fileSessionSnapshotSessionsRef.current = data.fileSessions
  data.sessions.forEach((session) => {
    if (!inventoryStateSignaturesRef.current.has(session.id)) {
      inventoryStateSignaturesRef.current.set(session.id, sessionInventorySignature(session))
    }
  })

  const releaseFileSessionRecoveryEpoch = useCallback((fileSessionId: string) => {
    fileSessionRecoveryCloseEpochsRef.current.delete(fileSessionId)
  }, [])

  const supersedeFileSessionRecoveryOperation = useCallback((fileSessionId: string) => {
    supersedeQueuedFileSessionRecovery(
      fileSessionRecoveryCloseEpochsRef.current,
      fileSessionRecoveryQueuesRef.current,
      fileSessionId,
    )
  }, [])

  const scheduleSuppressedFileSessionCleanup = useCallback((
    runtimeGateways: RuntimeGateways,
    fileSessionId: string,
    originalSessionId: string,
  ) => {
    if (
      suppressedFileSessionIdsRef.current.get(fileSessionId) !== originalSessionId
      || scheduledFileSessionCleanupIdsRef.current.has(fileSessionId)
    ) {
      return
    }
    scheduledFileSessionCleanupIdsRef.current.add(fileSessionId)
    const cleanup = runQueuedFileSessionRecoveryOperation(
      fileSessionRecoveryCloseEpochsRef.current,
      fileSessionRecoveryQueuesRef.current,
      originalSessionId,
      () => cleanupSuppressedFileSessionRecoveryResult(
        suppressedFileSessionIdsRef.current,
        fileSessionId,
        originalSessionId,
        () => runtimeGateways.fileSessions.deleteFileSession(fileSessionId),
      ).then((cleaned) => {
        if (cleaned) {
          bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSessionId)
        }
        return cleaned
      }),
      undefined,
      releaseFileSessionRecoveryEpoch,
    )
    void cleanup.catch((error) => {
      if (!isFileSessionRecoverySupersededError(error)) {
        console.error('重试清理已抑制的文件会话失败', { fileSessionId, error })
      }
    }).finally(() => {
      scheduledFileSessionCleanupIdsRef.current.delete(fileSessionId)
    })
  }, [releaseFileSessionRecoveryEpoch])

  useEffect(() => {
    const activeSourceSessionIds = new Set(data.sessions.map((session) => session.id))
    const fileSessionBySource = new Map(
      data.fileSessions.flatMap((session) => (
        session.source_session_id ? [[session.source_session_id, session] as const] : []
      )),
    )
    setFileSessionClosures((current) => {
      const entries = Object.entries(current)
      const retained = entries.filter(([sourceSessionId, closure]) => {
        if (!activeSourceSessionIds.has(sourceSessionId)) {
          return false
        }
        const replacement = fileSessionBySource.get(sourceSessionId)
        return !replacement || replacement.id === closure.session.id
      })
      return retained.length === entries.length ? current : Object.fromEntries(retained)
    })
  }, [data.fileSessions, data.sessions])

  const loadWithGateways = useCallback(async (
    runtimeGateways: RuntimeGateways,
    mode: LoadMode = 'background',
  ) => {
    const loadRevision = loadRevisionRef.current + 1
    loadRevisionRef.current = loadRevision
    const changedForwardIds = new Set<string>()
    forwardReloadChangeTrackersRef.current.add(changedForwardIds)
    const completionSettingsReloadCheckpoint = {
      generation: completionSettingsMutationRef.current,
      hadPendingWrites: completionSettingsPendingWritesRef.current > 0,
    }
    const connectionSettingsReloadCheckpoint = {
      generation: connectionSettingsMutationRef.current,
      hadPendingWrites: connectionSettingsPendingWritesRef.current > 0,
    }
    const shortcutSettingsReloadCheckpoint = {
      generation: shortcutSettingsMutationRef.current,
      hadPendingWrites: shortcutSettingsPendingWritesRef.current > 0,
    }
    const sessionRevisionBaseline = new Map(sessionEventRevisionsRef.current)
    const fileSessionRevisionBaseline = new Map(fileSessionEventRevisionsRef.current)
    const snippetGenerationBaseline = snippetRuntimeCursorRef.current.generation
    if (mode === 'initial') {
      setInitializing(true)
    } else if (mode === 'background') {
      setRefreshing(true)
    }
    setError(null)
    try {
      await runtimeGateways.runtime.health()
      for (const [fileSessionId, originalSessionId] of suppressedFileSessionIdsRef.current) {
        scheduleSuppressedFileSessionCleanup(runtimeGateways, fileSessionId, originalSessionId)
      }
      const [
        settings,
        terminalFonts,
        snippetGroups,
        snippets,
        fileBookmarkGroups,
        fileBookmarks,
        localPathMappings,
        groups,
        hostIcons,
        proxies,
        hosts,
        hostReachability,
        credentials,
        sessions,
        fileSessions,
        forwardProfiles,
        forwards,
      ] = await loadAppDataSnapshot(runtimeGateways.snapshot)
      if (loadRevision !== loadRevisionRef.current) {
        return
      }
      reconcileForwardStartCompletions(
        forwardStartCompletionWaitersRef.current,
        forwardEventSnapshotsRef.current,
        forwardEventRevisionsRef.current,
        forwards ?? [],
      )
      const reloadedSessions = sessions ?? []
      const nextSettings = normalizeSettings(settings)
      const canApplyReloadedCompletion = canApplyReloadedValue(
        completionSettingsReloadCheckpoint,
        completionSettingsMutationRef.current,
        completionSettingsPendingWritesRef.current,
      )
      if (canApplyReloadedCompletion) {
        completionSettingsConfirmedRef.current = nextSettings.completion
        completionSettingsRef.current = nextSettings.completion
      }
      const canApplyReloadedConnection = canApplyReloadedValue(
        connectionSettingsReloadCheckpoint,
        connectionSettingsMutationRef.current,
        connectionSettingsPendingWritesRef.current,
      )
      if (canApplyReloadedConnection) {
        connectionSettingsConfirmedRef.current = nextSettings.connection
        connectionSettingsRef.current = nextSettings.connection
      }
      const canApplyReloadedShortcuts = canApplyReloadedValue(
        shortcutSettingsReloadCheckpoint,
        shortcutSettingsMutationRef.current,
        shortcutSettingsPendingWritesRef.current,
      )
      if (canApplyReloadedShortcuts) {
        shortcutSettingsConfirmedRef.current = nextSettings.shortcuts
        shortcutSettingsRef.current = nextSettings.shortcuts
      }
      reloadedSessions.forEach((session) => {
        if (!sessionChangedSince(
          session.id,
          sessionRevisionBaseline,
          sessionEventRevisionsRef.current,
        )) {
          const signature = sessionInventorySignature(session)
          const previous = inventoryStateSignaturesRef.current.get(session.id)
          inventoryStateSignaturesRef.current.set(session.id, signature)
          if (previous !== undefined && previous !== signature) {
            bumpSessionRevision(inventoryEventRevisionsRef.current, session.id)
          }
        }
      })
      setData((current) => {
        const nextSessions = mergeSessionReloadSnapshot(
          current.sessions,
          reloadedSessions,
          sessionRevisionBaseline,
          sessionEventRevisionsRef.current,
        )
        const activeSourceSessionIds = new Set(nextSessions.map((session) => session.id))
        const canApplyReloadedSnippets = !snippetStateChangedSince(
          snippetRuntimeCursorRef.current,
          snippetGenerationBaseline,
        )
        const mergedSettings = {
          ...nextSettings,
          completion: canApplyReloadedCompletion
            ? nextSettings.completion
            : current.settings.completion,
          connection: canApplyReloadedConnection
            ? nextSettings.connection
            : current.settings.connection,
          shortcuts: canApplyReloadedShortcuts
            ? nextSettings.shortcuts
            : current.settings.shortcuts,
        }
        return {
          settings: mergedSettings,
          groups: groups ?? [],
          hostIcons: sortHostIcons(hostIcons ?? []),
          proxies: sortConnectionProxies(proxies ?? []),
          hosts: hosts ?? [],
          credentials: credentials ?? [],
          sessions: nextSessions,
          fileSessions: filterFileSessionsByActiveSources(
            reconcileFileSessionSnapshotList(
              current.fileSessions,
              filterSuppressedFileSessions(
                fileSessions ?? [],
                suppressedFileSessionIdsRef.current,
              ),
              fileSessionRevisionBaseline,
              fileSessionEventRevisionsRef.current,
            ),
            activeSourceSessionIds,
          ),
          forwardProfiles: forwardProfiles ?? [],
          forwards: reconcileForwardReloadSnapshot(
            current.forwards,
            forwards ?? [],
            changedForwardIds,
          ),
          snippetGroups: canApplyReloadedSnippets
            ? sortCodeSnippetGroups(snippetGroups ?? [])
            : current.snippetGroups,
          snippets: canApplyReloadedSnippets ? snippets ?? [] : current.snippets,
          fileBookmarkGroups: sortFileBookmarkGroups(fileBookmarkGroups ?? []),
          fileBookmarks: sortFileBookmarks(fileBookmarks ?? []),
          localPathMappings: sortLocalPathMappings(localPathMappings ?? []),
          terminalFonts: terminalFonts ?? [],
          hostReachability: indexHostReachability(hostReachability ?? []),
        }
      })
      setActiveSession((current) => {
        if (current && sessionChangedSince(
          current.id,
          sessionRevisionBaseline,
          sessionEventRevisionsRef.current,
        )) {
          return current
        }
        return reconcileActiveSession(current, reloadedSessions, mode)
      })
      setApiReady(true)
      setLastUpdatedAt(new Date().toISOString())
      await changeLanguage(nextSettings.language)
    } catch (loadError) {
      if (loadRevision === loadRevisionRef.current) {
        setApiReady(false)
        setError(publicMessage(loadError))
      }
    } finally {
      forwardReloadChangeTrackersRef.current.delete(changedForwardIds)
      if (loadRevision === loadRevisionRef.current) {
        setInitializing(false)
        setRefreshing(false)
      }
    }
  }, [scheduleSuppressedFileSessionCleanup])

  const load = useCallback(
    (mode: LoadMode = 'background') => loadWithGateways(gateways, mode),
    [gateways, loadWithGateways],
  )

  const reloadForwardsWithGateways = useCallback(async (runtimeGateways: RuntimeGateways) => {
    const changedForwardIds = new Set<string>()
    forwardReloadChangeTrackersRef.current.add(changedForwardIds)
    try {
      const forwards = await runtimeGateways.forwards.forwards()
      reconcileForwardStartCompletions(
        forwardStartCompletionWaitersRef.current,
        forwardEventSnapshotsRef.current,
        forwardEventRevisionsRef.current,
        forwards ?? [],
      )
      setData((current) => ({
        ...current,
        forwards: reconcileForwardReloadSnapshot(
          current.forwards,
          forwards ?? [],
          changedForwardIds,
        ),
      }))
      setLastUpdatedAt(new Date().toISOString())
    } finally {
      forwardReloadChangeTrackersRef.current.delete(changedForwardIds)
    }
  }, [])

  const reloadForwards = useCallback(
    () => reloadForwardsWithGateways(gateways),
    [gateways, reloadForwardsWithGateways],
  )

  const reloadSnippetsWithGateways = useCallback(async (
    runtimeGateways: RuntimeGateways,
    eventRevision: number | null = null,
  ) => {
    const decision = beginSnippetReload(snippetRuntimeCursorRef.current, eventRevision)
    snippetRuntimeCursorRef.current = decision.cursor
    if (!decision.checkpoint) {
      return
    }
    snippetReloadPendingRef.current = {
      gateways: runtimeGateways,
      checkpoint: decision.checkpoint,
    }
    if (!snippetReloadLoopRef.current) {
      const drain = async () => {
        while (snippetReloadPendingRef.current) {
          const request = snippetReloadPendingRef.current
          snippetReloadPendingRef.current = null
          try {
            const [snippetGroups, snippets] = await Promise.all([
              request.gateways.snippets.codeSnippetGroups(),
              request.gateways.snippets.codeSnippets(),
            ])
            if (canApplySnippetReload(snippetRuntimeCursorRef.current, request.checkpoint)) {
              setData((current) => ({
                ...current,
                snippetGroups: sortCodeSnippetGroups(snippetGroups ?? []),
                snippets: snippets ?? [],
              }))
              setLastUpdatedAt(new Date().toISOString())
            }
          } catch (reloadError) {
            if (!snippetReloadPendingRef.current) {
              snippetRuntimeCursorRef.current = recoverFailedSnippetReload(
                snippetRuntimeCursorRef.current,
                request.checkpoint,
              )
              throw reloadError
            }
          }
        }
      }
      const loop = drain().finally(() => {
        if (snippetReloadLoopRef.current === loop) {
          snippetReloadLoopRef.current = null
        }
      })
      snippetReloadLoopRef.current = loop
    }
    await snippetReloadLoopRef.current
  }, [])

  const reloadSnippets = useCallback(
    (eventRevision?: number) => reloadSnippetsWithGateways(gateways, eventRevision ?? null),
    [gateways, reloadSnippetsWithGateways],
  )

  const resetSnippetEventCursor = useCallback(() => {
    snippetRuntimeCursorRef.current = resetSnippetEventRevision(
      snippetRuntimeCursorRef.current,
    )
    snippetReloadPendingRef.current = null
  }, [])

  const applySessionSnapshot = useCallback((
    event: SessionSnapshotEvent,
    generation: number,
  ) => {
    const decision = decideSessionSnapshot(
      sessionSnapshotCursorRef.current,
      event,
      generation,
    )
    sessionSnapshotCursorRef.current = decision.cursor
    if (!decision.accepted) {
      return false
    }

    const previousSessions = sessionSnapshotSessionsRef.current
    const nextSessions = event.sessions
    const nextSessionIds = new Set(nextSessions.map((session) => session.id))
    affectedSessionIds(previousSessions, nextSessions).forEach((sessionId) => {
      bumpSessionRevision(sessionEventRevisionsRef.current, sessionId)
      if (!nextSessionIds.has(sessionId)) {
        inventoryRequestRevisionsRef.current.delete(sessionId)
        inventoryEventRevisionsRef.current.delete(sessionId)
        inventoryStateSignaturesRef.current.delete(sessionId)
      }
    })
    nextSessions.forEach((session) => {
      const signature = sessionInventorySignature(session)
      if (inventoryStateSignaturesRef.current.get(session.id) !== signature) {
        inventoryStateSignaturesRef.current.set(session.id, signature)
        bumpSessionRevision(inventoryEventRevisionsRef.current, session.id)
      }
    })

    sessionSnapshotSessionsRef.current = nextSessions
    setData((current) => ({
      ...current,
      sessions: nextSessions,
      fileSessions: filterFileSessionsByActiveSources(
        current.fileSessions,
        nextSessionIds,
      ),
    }))
    setActiveSession((current) => reconcileActiveSession(current, nextSessions, 'initial'))
    return true
  }, [])

  const applyFileSessionSnapshot = useCallback((
    event: FileSessionSnapshotEvent,
    generation: number,
  ) => {
    const previousCursor = fileSessionSnapshotCursorRef.current
    const decision = decideFileSessionSnapshot(
      previousCursor,
      event,
      generation,
    )
    fileSessionSnapshotCursorRef.current = decision.cursor
    if (!decision.accepted) {
      return false
    }
    const instanceChanged = previousCursor.instanceId !== null
      && previousCursor.instanceId !== event.instance_id
    if (instanceChanged) {
      fileSessionSnapshotKnownIdsRef.current.clear()
      fileSessionSnapshotRevisionBaselineRef.current.clear()
    }

    const previousSessions = fileSessionSnapshotSessionsRef.current
    const visibleSessions = filterSuppressedFileSessions(
      event.sessions,
      suppressedFileSessionIdsRef.current,
    )
    releaseConfirmedFileSessionCloseSuppressions(
      closeSuppressedFileSessionIdsRef.current,
      event.sessions,
    )
    const revisionBaseline = new Map(fileSessionSnapshotRevisionBaselineRef.current)
    const latestRevisions = new Map(fileSessionEventRevisionsRef.current)
    const bumpedSessionIds = new Set(affectedFileSessionIds(
      previousSessions,
      visibleSessions,
    ))
    bumpedSessionIds.forEach((sessionId) => {
      bumpSessionRevision(fileSessionEventRevisionsRef.current, sessionId)
    })
    setData((current) => {
      const nextSessions = reconcileVisibleAuthoritativeFileSessionSnapshot(
        current.fileSessions,
        visibleSessions,
        new Set(current.sessions.map((session) => session.id)),
        revisionBaseline,
        latestRevisions,
        fileSessionSnapshotKnownIdsRef.current,
        instanceChanged,
        closeSuppressedFileSessionIdsRef.current,
      )
      const activeSourceSessionIds = new Set(
        current.sessions.map((session) => session.id),
      )
      visibleSessions.forEach((session) => {
        if (!session.source_session_id || activeSourceSessionIds.has(session.source_session_id)) {
          fileSessionSnapshotKnownIdsRef.current.add(session.id)
        }
      })
      affectedFileSessionIds(current.fileSessions, nextSessions).forEach((sessionId) => {
        if (!bumpedSessionIds.has(sessionId)) {
          bumpedSessionIds.add(sessionId)
          bumpSessionRevision(fileSessionEventRevisionsRef.current, sessionId)
          if (fileSessionSnapshotCursorRef.current === decision.cursor) {
            fileSessionSnapshotRevisionBaselineRef.current.set(
              sessionId,
              fileSessionEventRevisionsRef.current.get(sessionId) ?? 0,
            )
          }
        }
      })
      fileSessionSnapshotSessionsRef.current = nextSessions
      return { ...current, fileSessions: nextSessions }
    })
    fileSessionSnapshotRevisionBaselineRef.current = new Map(
      fileSessionEventRevisionsRef.current,
    )
    return true
  }, [])

  useEffect(() => () => {
    const waiters = [...forwardStartCompletionWaitersRef.current.values()]
    forwardStartCompletionWaitersRef.current.clear()
    forwardEventSnapshotsRef.current.clear()
    forwardEventRevisionsRef.current.clear()
    waiters.forEach((waiter) => {
      window.clearTimeout(waiter.cleanupTimer)
      waiter.resolve(null)
    })
  }, [])

  useEffect(() => {
    let disposed = false
    void createRuntimeGateways()
      .then((runtimeGateways) => {
        if (disposed) {
          return
        }
        setGateways(runtimeGateways)
        void loadWithGateways(runtimeGateways, 'initial')
      })
      .catch((runtimeError) => {
        if (disposed) {
          return
        }
        setApiReady(false)
        setError(publicMessage(runtimeError))
        setInitializing(false)
      })
    return () => {
      disposed = true
    }
  }, [loadWithGateways])

  const actions = useMemo(
    () => ({
      reload: () => load('background'),
      reloadSilent: () => load('silent'),
      reloadForwardsSilent: () => reloadForwards(),
      reloadSnippetsSilent: (eventRevision?: number) => reloadSnippets(eventRevision),
      resetSnippetEventCursor,
      applySessionSnapshot,
      applyFileSessionSnapshot,
      ...createSettingsCommands({
        api: gateways.settings,
        currentSettings: data.settings,
        setData,
        completionSettingsMutation: completionSettingsMutationRef,
        completionSettingsPendingWrites: completionSettingsPendingWritesRef,
        completionSettingsWriteQueue,
        completionSettings: completionSettingsRef,
        confirmedCompletionSettings: completionSettingsConfirmedRef,
        connectionSettingsMutation: connectionSettingsMutationRef,
        connectionSettingsPendingWrites: connectionSettingsPendingWritesRef,
        connectionSettingsWriteQueue,
        connectionSettings: connectionSettingsRef,
        confirmedConnectionSettings: connectionSettingsConfirmedRef,
        shortcutSettingsMutation: shortcutSettingsMutationRef,
        shortcutSettingsPendingWrites: shortcutSettingsPendingWritesRef,
        shortcutSettingsWriteQueue,
        shortcutSettings: shortcutSettingsRef,
        confirmedShortcutSettings: shortcutSettingsConfirmedRef,
      }),
      ...createSnippetCommands(gateways.snippets, setData),
      ...createFileCatalogCommands(gateways.fileCatalog, setData),
      ...createForwardProfileCommands(gateways.forwards, setData),
      ...createForwardCommands({
        api: gateways.forwards,
        forwards: data.forwards,
        setData,
        setForwardErrorEvent,
        forwardReloadChangeTrackers: forwardReloadChangeTrackersRef.current,
        forwardStartCompletionWaiters: forwardStartCompletionWaitersRef.current,
        forwardEventRevisions: forwardEventRevisionsRef.current,
        forwardEventSnapshots: forwardEventSnapshotsRef.current,
      }),
      ...createHostCommands({ api: gateways.hosts, hosts: data.hosts, load, setData }),
      ...createCredentialCommands(gateways.credentials, load),
      ...createSessionCommands({
        sessionApi: gateways.sessions,
        fileSessionApi: gateways.fileSessions,
        forwardApi: gateways.forwards,
        sessions: data.sessions,
        fileSessions: data.fileSessions,
        forwards: data.forwards,
        setData,
        setActiveSession,
        setFileSessionClosures,
        sessionEventRevisions: sessionEventRevisionsRef.current,
        fileSessionEventRevisions: fileSessionEventRevisionsRef.current,
        inventoryRequestRevisions: inventoryRequestRevisionsRef.current,
        inventoryEventRevisions: inventoryEventRevisionsRef.current,
        inventoryStateSignatures: inventoryStateSignaturesRef.current,
        load,
        supersedeFileSessionRecoveryOperation,
      }),
      ...createFileSessionCommands({
        api: gateways.fileSessions,
        fileSessions: data.fileSessions,
        setData,
        setFileSessionClosures,
        fileSessionRecoveryCloseEpochs: fileSessionRecoveryCloseEpochsRef.current,
        fileSessionRecoveryQueues: fileSessionRecoveryQueuesRef.current,
        suppressedFileSessionIds: suppressedFileSessionIdsRef.current,
        closeSuppressedFileSessionIds: closeSuppressedFileSessionIdsRef.current,
        fileSessionEventRevisions: fileSessionEventRevisionsRef.current,
        releaseFileSessionRecoveryEpoch,
        scheduleSuppressedFileSessionCleanup: (fileSessionId, originalSessionId) => {
          scheduleSuppressedFileSessionCleanup(
            gateways,
            fileSessionId,
            originalSessionId,
          )
        },
        supersedeFileSessionRecoveryOperation,
      }),
    }),
    [
      gateways,
      applySessionSnapshot,
      applyFileSessionSnapshot,
      completionSettingsWriteQueue,
      connectionSettingsWriteQueue,
      shortcutSettingsWriteQueue,
      data.fileSessions,
      data.forwards,
      data.hosts,
      data.settings,
      data.sessions,
      load,
      releaseFileSessionRecoveryEpoch,
      reloadForwards,
      reloadSnippets,
      resetSnippetEventCursor,
      scheduleSuppressedFileSessionCleanup,
      supersedeFileSessionRecoveryOperation,
    ],
  )

  return { gateways, data, initializing, refreshing, apiReady, error, activeSession, setActiveSession, lastUpdatedAt, forwardErrorEvent, fileSessionClosures, actions }
}

function publicMessage(error: unknown) {
  if (error instanceof TermousApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return '本地 API 不可用'
}
