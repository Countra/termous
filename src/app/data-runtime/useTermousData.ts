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
  ForwardStartRequest,
} from '#entities/forward'
import type {
  FileSession,
} from '#entities/file'
import { sortCodeSnippetGroups } from '#entities/snippet'
import { normalizeSettings } from '#features/settings'
import { changeLanguage } from '#shared/i18n'
import {
  adoptSuppressedFileSessionRecoveryResult,
  cleanupSuppressedFileSessionRecoveryResult,
  filterSuppressedFileSessions,
  isFileSessionRecoverySupersededError,
  runQueuedFileSessionRecoveryOperation,
  suppressFileSessionRecoveryResult,
  supersedeQueuedFileSessionRecovery,
  type FileSessionClosureState,
  filterFileSessionsByActiveSources,
  reconcileFileSessionSnapshotList,
  replaceFileSessionSnapshot,
  upsertFileSessionSnapshot,
} from '#entities/file'
import {
  mergeSessionReloadSnapshot,
  sessionChangedSince,
  shouldApplySessionInventoryResponse,
} from './model/sessionInventoryState'
import {
  isForwardStartSettledStatus,
  reconcileForwardsAfterRestartFailure,
  restartForwardInstance,
  selectForwardStartSnapshot,
} from '#features/forwards'
import { canApplyReloadedValue, SerialMutationQueue } from '#shared/async'
import {
  bumpSessionRevision,
  indexHostReachability,
  initialData,
  markHostRecentlyConnected,
  reconcileActiveSession,
  removeMatchingFileSessionClosure,
  sessionInventorySignature,
  sortConnectionProxies,
  sortFileBookmarkGroups,
  sortFileBookmarks,
  sortLocalPathMappings,
  upsertSession,
  type LoadMode,
} from './model/appDataState'
import {
  FORWARD_START_COMPLETION_TIMEOUT_MS,
  reconcileForwardStartCompletions,
  rememberForwardEventSnapshot,
  settleForwardStartCompletion,
  shouldEmitForwardError,
  shouldRemoveForward,
  syncForwardAfterStart,
  upsertForward,
  visibleForwards,
  type ForwardStartCompletionWaiter,
} from './model/forwardRuntimeState'
import { createCredentialCommands } from './commands/credentialCommands'
import { createFileCatalogCommands } from './commands/fileCatalogCommands'
import { createForwardProfileCommands } from './commands/forwardProfileCommands'
import { createHostCommands } from './commands/hostCommands'
import { createSettingsCommands } from './commands/settingsCommands'
import { createSnippetCommands } from './commands/snippetCommands'
import { loadAppDataSnapshot } from './api/appDataSnapshotGateway'
import type { AppData } from './model/appData'
import type { LocalShell, Session } from './model/sessionTypes'

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
  const scheduledFileSessionCleanupIdsRef = useRef(new Set<string>())
  const sessionEventRevisionsRef = useRef(new Map<string, number>())
  const fileSessionEventRevisionsRef = useRef(new Map<string, number>())
  const inventoryEventRevisionsRef = useRef(new Map<string, number>())
  const inventoryStateSignaturesRef = useRef(new Map<string, string>())
  const inventoryRequestRevisionsRef = useRef(new Map<string, number>())
  const forwardEventRevisionsRef = useRef(new Map<string, number>())
  const forwardEventSnapshotsRef = useRef(new Map<string, ForwardInstance>())
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
    const completionSettingsReloadCheckpoint = {
      generation: completionSettingsMutationRef.current,
      hadPendingWrites: completionSettingsPendingWritesRef.current > 0,
    }
    const shortcutSettingsReloadCheckpoint = {
      generation: shortcutSettingsMutationRef.current,
      hadPendingWrites: shortcutSettingsPendingWritesRef.current > 0,
    }
    const sessionRevisionBaseline = new Map(sessionEventRevisionsRef.current)
    const fileSessionRevisionBaseline = new Map(fileSessionEventRevisionsRef.current)
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
        const mergedSettings = {
          ...nextSettings,
          completion: canApplyReloadedCompletion
            ? nextSettings.completion
            : current.settings.completion,
          shortcuts: canApplyReloadedShortcuts
            ? nextSettings.shortcuts
            : current.settings.shortcuts,
        }
        return {
          settings: mergedSettings,
          groups: groups ?? [],
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
          forwards: visibleForwards(forwards ?? []),
          snippetGroups: sortCodeSnippetGroups(snippetGroups ?? []),
          snippets: snippets ?? [],
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
    const forwards = await runtimeGateways.forwards.forwards()
    reconcileForwardStartCompletions(
      forwardStartCompletionWaitersRef.current,
      forwardEventSnapshotsRef.current,
      forwardEventRevisionsRef.current,
      forwards ?? [],
    )
    setData((current) => ({ ...current, forwards: visibleForwards(forwards ?? []) }))
    setLastUpdatedAt(new Date().toISOString())
  }, [])

  const reloadForwards = useCallback(
    () => reloadForwardsWithGateways(gateways),
    [gateways, reloadForwardsWithGateways],
  )

  const resolveForwardStartCompletion = useCallback((
    forwardId: string,
    forward: ForwardInstance | null,
  ) => {
    settleForwardStartCompletion(
      forwardStartCompletionWaitersRef.current,
      forwardEventSnapshotsRef.current,
      forwardEventRevisionsRef.current,
      forwardId,
      forward,
    )
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

  const registerStartedForward = useCallback((
    forward: ForwardInstance,
    replacedForwardId = '',
  ) => {
    const latestForward = selectForwardStartSnapshot(
      forward,
      forwardEventSnapshotsRef.current.get(forward.id) ?? null,
    )
    setData((current) => ({
      ...current,
      forwards: shouldRemoveForward(latestForward)
        ? current.forwards.filter((item) => (
            item.id !== replacedForwardId && item.id !== latestForward.id
          ))
        : upsertForward(
            current.forwards.filter((item) => item.id !== replacedForwardId),
            latestForward,
          ),
    }))
    const previousWaiter = forwardStartCompletionWaitersRef.current.get(forward.id)
    forwardStartCompletionWaitersRef.current.delete(forward.id)
    if (previousWaiter) {
      window.clearTimeout(previousWaiter.cleanupTimer)
      previousWaiter.resolve(null)
    }
    let waiter!: ForwardStartCompletionWaiter
    const completion = new Promise<ForwardInstance | null>((resolve) => {
      waiter = {
        resolve,
        registeredAt: performance.now(),
        cleanupTimer: 0,
      }
    })
    waiter.cleanupTimer = window.setTimeout(() => {
      if (forwardStartCompletionWaitersRef.current.get(forward.id) === waiter) {
        resolveForwardStartCompletion(forward.id, null)
      }
    }, FORWARD_START_COMPLETION_TIMEOUT_MS)
    forwardStartCompletionWaitersRef.current.set(forward.id, waiter)
    if (isForwardStartSettledStatus(latestForward.status)) {
      resolveForwardStartCompletion(forward.id, latestForward)
      return completion
    }
    void syncForwardAfterStart(
      gateways.forwards,
      forward.id,
      (nextForward) => {
        const shouldRemove = shouldRemoveForward(nextForward)
        if (shouldRemove) {
          setForwardErrorEvent({
            type: 'error',
            forward: nextForward,
            message: nextForward.last_error || nextForward.status_message,
          })
        }
        setData((current) => {
          if (shouldRemove) {
            return {
              ...current,
              forwards: current.forwards.filter((item) => item.id !== nextForward.id),
            }
          }
          return { ...current, forwards: upsertForward(current.forwards, nextForward) }
        })
      },
      () => forwardEventRevisionsRef.current.get(forward.id) ?? 0,
      () => forwardStartCompletionWaitersRef.current.has(forward.id),
    ).then((settledForward) => {
      if (settledForward !== undefined) {
        resolveForwardStartCompletion(forward.id, settledForward)
      }
    }).catch((error) => {
      console.error('同步端口转发启动终态失败', error)
    })
    return completion
  }, [gateways.forwards, resolveForwardStartCompletion])

  const reconcileRestartFailure = useCallback(async (
    replacedForwardId: string,
    stopConfirmed: boolean,
  ) => {
    try {
      const forwards = await gateways.forwards.forwards()
      setData((current) => ({
        ...current,
        forwards: reconcileForwardsAfterRestartFailure(
          current.forwards,
          visibleForwards(forwards ?? []),
          replacedForwardId,
          stopConfirmed,
        ),
      }))
    } catch (error) {
      console.error('端口转发重启失败后的状态对账失败', error)
      setData((current) => ({
        ...current,
        forwards: reconcileForwardsAfterRestartFailure(
          current.forwards,
          null,
          replacedForwardId,
          stopConfirmed,
        ),
      }))
    }
  }, [gateways.forwards])

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
      ...createSettingsCommands({
        api: gateways.settings,
        currentSettings: data.settings,
        setData,
        completionSettingsMutation: completionSettingsMutationRef,
        completionSettingsPendingWrites: completionSettingsPendingWritesRef,
        completionSettingsWriteQueue,
        completionSettings: completionSettingsRef,
        confirmedCompletionSettings: completionSettingsConfirmedRef,
        shortcutSettingsMutation: shortcutSettingsMutationRef,
        shortcutSettingsPendingWrites: shortcutSettingsPendingWritesRef,
        shortcutSettingsWriteQueue,
        shortcutSettings: shortcutSettingsRef,
        confirmedShortcutSettings: shortcutSettingsConfirmedRef,
      }),
      ...createSnippetCommands(gateways.snippets, setData),
      ...createFileCatalogCommands(gateways.fileCatalog, setData),
      ...createForwardProfileCommands(gateways.forwards, setData),
      async startForward(input: ForwardStartRequest) {
        const forward = await gateways.forwards.startForward(input)
        void registerStartedForward(forward)
        return forward
      },
      async restartForward(id: string) {
        const currentForward = data.forwards.find((forward) => forward.id === id)
        if (!currentForward) {
          throw new Error('端口转发任务不存在')
        }
        let stopConfirmed = false
        try {
          const replacement = await restartForwardInstance(
            currentForward,
            async (forwardId) => {
              await gateways.forwards.stopForward(forwardId)
              stopConfirmed = true
            },
            (input) => gateways.forwards.startForward(input),
          )
          const completion = registerStartedForward(replacement, currentForward.id)
          return { forward: replacement, completion }
        } catch (error) {
          await reconcileRestartFailure(id, stopConfirmed)
          throw error
        }
      },
      async stopForward(id: string) {
        await gateways.forwards.stopForward(id)
        resolveForwardStartCompletion(id, null)
        setData((current) => ({
          ...current,
          forwards: current.forwards.filter((forward) => forward.id !== id),
        }))
      },
      updateForward(event: ForwardEvent) {
        if (forwardStartCompletionWaitersRef.current.has(event.forward.id)) {
          bumpSessionRevision(forwardEventRevisionsRef.current, event.forward.id)
        }
        rememberForwardEventSnapshot(forwardEventSnapshotsRef.current, event.forward)
        resolveForwardStartCompletion(event.forward.id, event.forward)
        if (shouldEmitForwardError(event)) {
          setForwardErrorEvent(event)
        }
        setData((current) => {
          if (event.type === 'deleted' || shouldRemoveForward(event.forward)) {
            return { ...current, forwards: current.forwards.filter((forward) => forward.id !== event.forward.id) }
          }
          return { ...current, forwards: upsertForward(current.forwards, event.forward) }
        })
      },
      ...createHostCommands({ api: gateways.hosts, hosts: data.hosts, load, setData }),
      ...createCredentialCommands(gateways.credentials, load),
      async connect(hostId: string, cols = 120, rows = 32) {
        const session = await gateways.sessions.createSession(hostId, cols, rows)
        bumpSessionRevision(sessionEventRevisionsRef.current, session.id)
        inventoryStateSignaturesRef.current.set(session.id, sessionInventorySignature(session))
        setActiveSession(session)
        setData((current) => ({ ...current, sessions: upsertSession(current.sessions, session) }))
        void load('silent')
        return session
      },
      async openLocalTerminal(shell: LocalShell, cols = 120, rows = 32) {
        const session = await gateways.sessions.createLocalSession(shell, cols, rows)
        bumpSessionRevision(sessionEventRevisionsRef.current, session.id)
        inventoryStateSignaturesRef.current.set(session.id, sessionInventorySignature(session))
        setActiveSession(session)
        setData((current) => ({ ...current, sessions: upsertSession(current.sessions, session) }))
        void load('silent')
        return session
      },
      async disconnect(sessionId: string) {
        const linkedFileSessionIds = data.fileSessions
          .filter((session) => session.source_session_id === sessionId)
          .map((session) => session.id)
        try {
          await gateways.sessions.deleteSession(sessionId)
        } catch (error) {
          if (
            !(error instanceof TermousApiError)
            || error.status !== 404
            || error.code !== 'SESSION_NOT_FOUND'
          ) {
            throw error
          }
        }
        inventoryRequestRevisionsRef.current.delete(sessionId)
        inventoryEventRevisionsRef.current.delete(sessionId)
        inventoryStateSignaturesRef.current.delete(sessionId)
        bumpSessionRevision(sessionEventRevisionsRef.current, sessionId)
        linkedFileSessionIds.forEach((fileSessionId) => {
          supersedeFileSessionRecoveryOperation(fileSessionId)
          bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSessionId)
        })
        const fallbackSession = data.sessions.find((session) => session.id !== sessionId) ?? null
        setData((current) => ({
          ...current,
          sessions: current.sessions.filter((session) => session.id !== sessionId),
          fileSessions: current.fileSessions.filter((session) => session.source_session_id !== sessionId),
        }))
        setFileSessionClosures((current) => {
          if (!current[sessionId]) {
            return current
          }
          const next = { ...current }
          delete next[sessionId]
          return next
        })
        setActiveSession((current) => (current?.id === sessionId ? fallbackSession : current))
        void load('silent')
      },
      async refreshSessionInventory(sessionId: string, force = false, signal?: AbortSignal) {
        const requestRevision = (inventoryRequestRevisionsRef.current.get(sessionId) ?? 0) + 1
        inventoryRequestRevisionsRef.current.set(sessionId, requestRevision)
        const baselineEventRevision = inventoryEventRevisionsRef.current.get(sessionId) ?? 0
        let refreshed: Session
        try {
          refreshed = await gateways.sessions.refreshSessionInventory(sessionId, force, { signal })
        } catch (requestError) {
          if (baselineEventRevision !== (inventoryEventRevisionsRef.current.get(sessionId) ?? 0)) {
            throw new TermousApiError('系统信息状态已由实时事件更新', 'REQUEST_SUPERSEDED', 0)
          }
          throw requestError
        }
        if (!shouldApplySessionInventoryResponse({
          sessionId,
          responseSessionId: refreshed.id,
          requestRevision,
          latestRequestRevision: inventoryRequestRevisionsRef.current.get(sessionId) ?? 0,
          baselineEventRevision,
          latestEventRevision: inventoryEventRevisionsRef.current.get(sessionId) ?? 0,
          aborted: Boolean(signal?.aborted),
        })) {
          return refreshed
        }
        bumpSessionRevision(sessionEventRevisionsRef.current, sessionId)
        bumpSessionRevision(inventoryEventRevisionsRef.current, sessionId)
        inventoryStateSignaturesRef.current.set(sessionId, sessionInventorySignature(refreshed))
        setData((current) => ({ ...current, sessions: upsertSession(current.sessions, refreshed) }))
        setActiveSession((current) => (current?.id === refreshed.id ? refreshed : current))
        return refreshed
      },
      async disconnectAllConnections() {
        const sessionsToClose = data.sessions
        const fileSessionsToClose = data.fileSessions
        const forwardsToClose = data.forwards.filter((forward) => (
          forward.status === 'starting' ||
          forward.status === 'waiting_host_trust' ||
          forward.status === 'running' ||
          forward.status === 'stopping'
        ))
        fileSessionsToClose.forEach((fileSession) => {
          bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSession.id)
        })
        const results = await Promise.allSettled([
          ...sessionsToClose.map((session) => gateways.sessions.deleteSession(session.id)),
          ...fileSessionsToClose.map((fileSession) => (
            gateways.fileSessions.deleteFileSession(fileSession.id)
          )),
          ...forwardsToClose.map((forward) => gateways.forwards.stopForward(forward.id)),
        ])
        const failed = results.find((result) => result.status === 'rejected')
        if (failed && failed.status === 'rejected') {
          throw failed.reason
        }
        inventoryRequestRevisionsRef.current.clear()
        sessionsToClose.forEach((session) => {
          bumpSessionRevision(sessionEventRevisionsRef.current, session.id)
          inventoryEventRevisionsRef.current.delete(session.id)
          inventoryStateSignaturesRef.current.delete(session.id)
        })
        fileSessionsToClose.forEach((fileSession) => {
          bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSession.id)
        })
        setData((current) => ({ ...current, sessions: [], fileSessions: [], forwards: [] }))
        setActiveSession(null)
        void load('silent')
      },
      selectSession(sessionId: string) {
        const next = data.sessions.find((session) => session.id === sessionId)
        if (next) {
          setActiveSession(next)
        }
      },
      updateSession(sessionId: string, patch: Partial<Session>) {
        bumpSessionRevision(sessionEventRevisionsRef.current, sessionId)
        const nextInventorySignature = sessionInventorySignature(patch)
        if (inventoryStateSignaturesRef.current.get(sessionId) !== nextInventorySignature) {
          inventoryStateSignaturesRef.current.set(sessionId, nextInventorySignature)
          bumpSessionRevision(inventoryEventRevisionsRef.current, sessionId)
        }
        setActiveSession((current) => (current?.id === sessionId ? { ...current, ...patch } : current))
        setData((current) => ({
          ...current,
          ...markHostRecentlyConnected(
            current.hosts,
            current.sessions,
            sessionId,
            patch,
          ),
        }))
      },
      async connectFileSession(
        hostId: string,
        sourceSessionId = '',
        initialPath = '',
        replacedFileSessionId = '',
      ) {
        if (replacedFileSessionId) {
          bumpSessionRevision(fileSessionEventRevisionsRef.current, replacedFileSessionId)
        }
        const createFileSession = () => (
          gateways.fileSessions.createFileSession(hostId, sourceSessionId, initialPath)
        )
        const fileSession = replacedFileSessionId
          ? await runQueuedFileSessionRecoveryOperation(
              fileSessionRecoveryCloseEpochsRef.current,
              fileSessionRecoveryQueuesRef.current,
              replacedFileSessionId,
              createFileSession,
              async (supersededSession) => {
                if (supersededSession.id !== replacedFileSessionId) {
                  suppressFileSessionRecoveryResult(
                    suppressedFileSessionIdsRef.current,
                    supersededSession.id,
                    replacedFileSessionId,
                  )
                  bumpSessionRevision(
                    fileSessionEventRevisionsRef.current,
                    supersededSession.id,
                  )
                  setData((current) => ({
                    ...current,
                    fileSessions: current.fileSessions.filter(
                      (session) => session.id !== supersededSession.id,
                    ),
                  }))
                  try {
                    const cleaned = await cleanupSuppressedFileSessionRecoveryResult(
                      suppressedFileSessionIdsRef.current,
                      supersededSession.id,
                      replacedFileSessionId,
                      () => gateways.fileSessions.deleteFileSession(supersededSession.id),
                    )
                    if (cleaned) {
                      bumpSessionRevision(
                        fileSessionEventRevisionsRef.current,
                        supersededSession.id,
                      )
                    }
                  } catch (error) {
                    console.error('清理已被显式关闭覆盖的文件会话失败', {
                      fileSessionId: supersededSession.id,
                      error,
                    })
                    scheduleSuppressedFileSessionCleanup(
                      gateways,
                      supersededSession.id,
                      replacedFileSessionId,
                    )
                    throw error
                  }
                }
              },
              releaseFileSessionRecoveryEpoch,
            )
          : await createFileSession()
        adoptSuppressedFileSessionRecoveryResult(
          suppressedFileSessionIdsRef.current,
          fileSession.id,
        )
        if (replacedFileSessionId && replacedFileSessionId !== fileSession.id) {
          bumpSessionRevision(fileSessionEventRevisionsRef.current, replacedFileSessionId)
        }
        bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSession.id)
        setData((current) => ({
          ...current,
          fileSessions: replaceFileSessionSnapshot(
            current.fileSessions,
            fileSession,
            replacedFileSessionId,
          ),
        }))
        if (fileSession.source_session_id) {
          setFileSessionClosures((current) => {
            if (!current[fileSession.source_session_id as string]) {
              return current
            }
            const next = { ...current }
            delete next[fileSession.source_session_id as string]
            return next
          })
        }
        return fileSession
      },
      async closeFileSession(fileSessionId: string) {
        supersedeFileSessionRecoveryOperation(fileSessionId)
        const closingFileSession = data.fileSessions.find((session) => session.id === fileSessionId)
        const sourceSessionId = closingFileSession?.source_session_id ?? ''
        if (closingFileSession && sourceSessionId) {
          setFileSessionClosures((current) => ({
            ...current,
            [sourceSessionId]: {
              session: closingFileSession,
              phase: 'closing',
            },
          }))
        }
        bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSessionId)
        try {
          await gateways.fileSessions.deleteFileSession(fileSessionId)
        } catch (error) {
          if (!(error instanceof TermousApiError && error.code === 'SFTP_FILE_SESSION_NOT_FOUND')) {
            if (sourceSessionId) {
              setFileSessionClosures((current) => removeMatchingFileSessionClosure(
                current,
                sourceSessionId,
                fileSessionId,
              ))
            }
            throw error
          }
        }
        bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSessionId)
        if (closingFileSession && sourceSessionId) {
          setFileSessionClosures((current) => {
            const closure = current[sourceSessionId]
            if (!closure || closure.session.id !== fileSessionId) {
              return current
            }
            return {
              ...current,
              [sourceSessionId]: {
                session: closingFileSession,
                phase: 'closed',
              },
            }
          })
        }
        setData((current) => ({
          ...current,
          fileSessions: current.fileSessions.filter((session) => session.id !== fileSessionId),
        }))
      },
      async reconnectFileSession(fileSessionId: string) {
        const fileSession = await runQueuedFileSessionRecoveryOperation(
          fileSessionRecoveryCloseEpochsRef.current,
          fileSessionRecoveryQueuesRef.current,
          fileSessionId,
          () => gateways.fileSessions.reconnectFileSession(fileSessionId),
          undefined,
          releaseFileSessionRecoveryEpoch,
        )
        adoptSuppressedFileSessionRecoveryResult(
          suppressedFileSessionIdsRef.current,
          fileSession.id,
        )
        bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSession.id)
        setData((current) => ({
          ...current,
          fileSessions: upsertFileSessionSnapshot(current.fileSessions, fileSession),
        }))
        if (fileSession.source_session_id) {
          setFileSessionClosures((current) => removeMatchingFileSessionClosure(
            current,
            fileSession.source_session_id as string,
            fileSession.id,
          ))
        }
        return fileSession
      },
      supersedeFileSessionRecovery(fileSessionId: string) {
        supersedeFileSessionRecoveryOperation(fileSessionId)
      },
      updateFileSession(fileSession: FileSession) {
        if (suppressedFileSessionIdsRef.current.has(fileSession.id)) {
          return
        }
        bumpSessionRevision(fileSessionEventRevisionsRef.current, fileSession.id)
        setData((current) => {
          if (!current.fileSessions.some((session) => session.id === fileSession.id)) {
            return current
          }
          return {
            ...current,
            fileSessions: upsertFileSessionSnapshot(current.fileSessions, fileSession),
          }
        })
      },
    }),
    [
      gateways,
      completionSettingsWriteQueue,
      shortcutSettingsWriteQueue,
      data.fileSessions,
      data.forwards,
      data.hosts,
      data.settings,
      data.sessions,
      load,
      releaseFileSessionRecoveryEpoch,
      reloadForwards,
      reconcileRestartFailure,
      registerStartedForward,
      resolveForwardStartCompletion,
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
