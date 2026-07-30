import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createApiFromRuntime, TermousApi, TermousApiError } from '../api/client'
import type {
  AppData,
  AppearanceSettings,
  CodeSnippet,
  CodeSnippetGroup,
  CodeSnippetGroupInput,
  CodeSnippetInput,
  ConnectionProxyInput,
  CredentialInput,
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
  FileSession,
  ForwardEvent,
  ForwardInstance,
  ForwardProfile,
  ForwardProfileInput,
  ForwardStartRequest,
  GroupReorderItem,
  HostGroup,
  HostReachability,
  HostReachabilityEvent,
  HostInput,
  Language,
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
  LocalShell,
  Session,
  Settings,
  TerminalFont,
  TerminalSettings,
  WindowSettings,
} from '../types/domain'
import { changeLanguage } from '../i18n'
import { defaultAppearanceSettings, defaultTerminalSettings, defaultWindowSettings, normalizeSettings } from '../features/settings/terminalSettings'
import { hostToInput } from '../features/hosts/hostInput'
import {
  adoptSuppressedFileSessionRecoveryResult,
  cleanupSuppressedFileSessionRecoveryResult,
  filterSuppressedFileSessions,
  isFileSessionRecoverySupersededError,
  runQueuedFileSessionRecoveryOperation,
  suppressFileSessionRecoveryResult,
  supersedeQueuedFileSessionRecovery,
  type FileSessionClosureState,
} from '../features/files/fileSessionRecovery'
import {
  filterFileSessionsByActiveSources,
  reconcileFileSessionSnapshotList,
  replaceFileSessionSnapshot,
  upsertFileSessionSnapshot,
} from '../shared/fileSessionSnapshot'
import {
  mergeSessionReloadSnapshot,
  sessionChangedSince,
  shouldApplySessionInventoryResponse,
} from './sessionInventoryState'
import {
  isForwardStartSettledStatus,
  reconcileForwardsAfterRestartFailure,
  restartForwardInstance,
  selectForwardStartSnapshot,
  shouldApplyForwardPollResponse,
} from '../features/forwards/forwardRestart'

const initialSettings: Settings = {
  language: 'zh-CN',
  appearance: defaultAppearanceSettings,
  terminal: defaultTerminalSettings,
  window: defaultWindowSettings,
}
type LoadMode = 'initial' | 'background' | 'silent'

const FORWARD_START_MISSING_GRACE_MS = 2_000
const FORWARD_START_COMPLETION_TIMEOUT_MS = 30 * 60 * 1_000

interface ForwardStartCompletionWaiter {
  resolve: (forward: ForwardInstance | null) => void
  registeredAt: number
  cleanupTimer: number
}

const initialData: AppData = {
  hosts: [],
  groups: [],
  proxies: [],
  credentials: [],
  sessions: [],
  fileSessions: [],
  forwardProfiles: [],
  forwards: [],
  snippetGroups: [],
  snippets: [],
  fileBookmarkGroups: [],
  fileBookmarks: [],
  localPathMappings: [],
  settings: initialSettings,
  terminalFonts: [],
  hostReachability: {},
}

export function useTermousData() {
  const [api, setApi] = useState(() => new TermousApi())
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
    apiClient: TermousApi,
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
        () => apiClient.deleteFileSession(fileSessionId),
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

  const loadWithApi = useCallback(async (apiClient: TermousApi, mode: LoadMode = 'background') => {
    const loadRevision = loadRevisionRef.current + 1
    loadRevisionRef.current = loadRevision
    const sessionRevisionBaseline = new Map(sessionEventRevisionsRef.current)
    const fileSessionRevisionBaseline = new Map(fileSessionEventRevisionsRef.current)
    if (mode === 'initial') {
      setInitializing(true)
    } else if (mode === 'background') {
      setRefreshing(true)
    }
    setError(null)
    try {
      await apiClient.health()
      for (const [fileSessionId, originalSessionId] of suppressedFileSessionIdsRef.current) {
        scheduleSuppressedFileSessionCleanup(apiClient, fileSessionId, originalSessionId)
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
      ] = await Promise.all([
        apiClient.settings(),
        apiClient.terminalFonts(),
        apiClient.codeSnippetGroups(),
        apiClient.codeSnippets(),
        apiClient.fileBookmarkGroups(),
        apiClient.fileBookmarks(),
        apiClient.localPathMappings(),
        apiClient.hostGroups(),
        apiClient.connectionProxies(),
        apiClient.hosts(),
        apiClient.hostReachability(),
        apiClient.credentials(),
        apiClient.sessions(),
        apiClient.fileSessions(),
        apiClient.forwardProfiles(),
        apiClient.forwards(),
      ])
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
        return {
          settings: nextSettings,
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
    (mode: LoadMode = 'background') => loadWithApi(api, mode),
    [api, loadWithApi],
  )

  const reloadForwardsWithApi = useCallback(async (apiClient: TermousApi) => {
    const forwards = await apiClient.forwards()
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
    () => reloadForwardsWithApi(api),
    [api, reloadForwardsWithApi],
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
      api,
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
  }, [api, resolveForwardStartCompletion])

  const reconcileRestartFailure = useCallback(async (
    replacedForwardId: string,
    stopConfirmed: boolean,
  ) => {
    try {
      const forwards = await api.forwards()
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
  }, [api])

  useEffect(() => {
    let disposed = false
    void createApiFromRuntime()
      .then((runtimeApi) => {
        if (disposed) {
          return
        }
        setApi(runtimeApi)
        void loadWithApi(runtimeApi, 'initial')
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
  }, [loadWithApi])

  const actions = useMemo(
    () => ({
      reload: () => load('background'),
      reloadSilent: () => load('silent'),
      reloadForwardsSilent: () => reloadForwards(),
      async setLanguage(language: Language) {
        const settings = normalizeSettings(await api.updateLanguage(language))
        setData((current) => ({ ...current, settings }))
        await changeLanguage(settings.language)
      },
      async setAppearanceSettings(appearance: AppearanceSettings) {
        const previousSettings = data.settings
        setData((current) => ({ ...current, settings: { ...current.settings, appearance } }))
        try {
          const settings = normalizeSettings(await api.updateAppearanceSettings(appearance))
          setData((current) => ({ ...current, settings }))
        } catch (updateError) {
          setData((current) => ({ ...current, settings: previousSettings }))
          throw updateError
        }
      },
      async setTerminalSettings(terminal: TerminalSettings) {
        const previousSettings = data.settings
        setData((current) => ({ ...current, settings: { ...current.settings, terminal } }))
        try {
          const settings = normalizeSettings(await api.updateTerminalSettings(terminal))
          setData((current) => ({ ...current, settings }))
        } catch (updateError) {
          setData((current) => ({ ...current, settings: previousSettings }))
          throw updateError
        }
      },
      async setWindowSettings(windowSettings: WindowSettings) {
        const previousSettings = data.settings
        setData((current) => ({ ...current, settings: { ...current.settings, window: windowSettings } }))
        try {
          const settings = normalizeSettings(await api.updateWindowSettings(windowSettings))
          setData((current) => ({ ...current, settings }))
        } catch (updateError) {
          setData((current) => ({ ...current, settings: previousSettings }))
          throw updateError
        }
      },
      async uploadTerminalFont(file: File) {
        const font = await api.uploadTerminalFont(file)
        const terminalFonts = await api.terminalFonts()
        setData((current) => ({ ...current, terminalFonts: terminalFonts ?? upsertTerminalFont(current.terminalFonts, font) }))
        return font
      },
      async deleteTerminalFont(id: string) {
        await api.deleteTerminalFont(id)
        const [settings, terminalFonts] = await Promise.all([api.settings(), api.terminalFonts()])
        setData((current) => ({
          ...current,
          settings: normalizeSettings(settings),
          terminalFonts: terminalFonts ?? current.terminalFonts.filter((font) => font.id !== id),
        }))
      },
      async uploadHostIcon(file: File) {
        return api.uploadHostIcon(file)
      },
      async deleteHostIcon(id: string) {
        await api.deleteHostIcon(id)
      },
      async createCodeSnippet(input: CodeSnippetInput) {
        const snippet = await api.createCodeSnippet(input)
        setData((current) => ({ ...current, snippets: upsertCodeSnippet(current.snippets, snippet) }))
        return snippet
      },
      async updateCodeSnippet(id: string, input: CodeSnippetInput) {
        const snippet = await api.updateCodeSnippet(id, input)
        setData((current) => ({ ...current, snippets: upsertCodeSnippet(current.snippets, snippet) }))
        return snippet
      },
      async deleteCodeSnippet(id: string) {
        await api.deleteCodeSnippet(id)
        setData((current) => ({ ...current, snippets: current.snippets.filter((snippet) => snippet.id !== id) }))
      },
      async markCodeSnippetUsed(id: string) {
        const snippet = await api.markCodeSnippetUsed(id)
        setData((current) => ({ ...current, snippets: replaceCodeSnippet(current.snippets, snippet) }))
        return snippet
      },
      async createCodeSnippetGroup(input: CodeSnippetGroupInput) {
        const group = await api.createCodeSnippetGroup(input)
        setData((current) => ({
          ...current,
          snippetGroups: upsertCodeSnippetGroup(current.snippetGroups, group),
        }))
        return group
      },
      async updateCodeSnippetGroup(id: string, input: CodeSnippetGroupInput) {
        const group = await api.updateCodeSnippetGroup(id, input)
        setData((current) => ({
          ...current,
          snippetGroups: upsertCodeSnippetGroup(current.snippetGroups, group),
        }))
        return group
      },
      async deleteCodeSnippetGroup(id: string) {
        await api.deleteCodeSnippetGroup(id)
        setData((current) => ({
          ...current,
          snippetGroups: current.snippetGroups.filter((group) => group.id !== id),
          snippets: current.snippets.map((snippet) => (
            snippet.group_id === id ? { ...snippet, group_id: '' } : snippet
          )),
        }))
      },
      async reorderCodeSnippetGroups(items: GroupReorderItem[]) {
        const groups = await api.reorderCodeSnippetGroups(items)
        setData((current) => ({ ...current, snippetGroups: sortCodeSnippetGroups(groups) }))
        return groups
      },
      async createFileBookmarkGroup(input: FileBookmarkGroupInput) {
        const group = await api.createFileBookmarkGroup(input)
        setData((current) => ({ ...current, fileBookmarkGroups: upsertFileBookmarkGroup(current.fileBookmarkGroups, group) }))
        return group
      },
      async updateFileBookmarkGroup(id: string, input: FileBookmarkGroupInput) {
        const group = await api.updateFileBookmarkGroup(id, input)
        setData((current) => ({ ...current, fileBookmarkGroups: upsertFileBookmarkGroup(current.fileBookmarkGroups, group) }))
        return group
      },
      async deleteFileBookmarkGroup(id: string) {
        await api.deleteFileBookmarkGroup(id)
        let nextBookmarks: FileBookmark[] | null = null
        try {
          nextBookmarks = await api.fileBookmarks()
        } catch {
          nextBookmarks = null
        }
        setData((current) => ({
          ...current,
          fileBookmarkGroups: current.fileBookmarkGroups.filter((group) => group.id !== id),
          fileBookmarks: nextBookmarks
            ? sortFileBookmarks(nextBookmarks)
            : sortFileBookmarks(current.fileBookmarks.map((bookmark) => (
              bookmark.group_id === id ? { ...bookmark, group_id: '' } : bookmark
            ))),
        }))
      },
      async reorderFileBookmarkGroups(items: FileBookmarkGroupReorderItem[]) {
        const groups = await api.reorderFileBookmarkGroups(items)
        setData((current) => ({ ...current, fileBookmarkGroups: sortFileBookmarkGroups(groups ?? current.fileBookmarkGroups) }))
        return groups
      },
      async createFileBookmark(input: FileBookmarkInput) {
        const bookmark = await api.createFileBookmark(input)
        setData((current) => ({ ...current, fileBookmarks: upsertFileBookmark(current.fileBookmarks, bookmark) }))
        return bookmark
      },
      async updateFileBookmark(id: string, input: FileBookmarkInput) {
        const bookmark = await api.updateFileBookmark(id, input)
        setData((current) => ({ ...current, fileBookmarks: upsertFileBookmark(current.fileBookmarks, bookmark) }))
        return bookmark
      },
      async deleteFileBookmark(id: string) {
        await api.deleteFileBookmark(id)
        setData((current) => ({ ...current, fileBookmarks: current.fileBookmarks.filter((bookmark) => bookmark.id !== id) }))
      },
      async reorderFileBookmarks(items: FileBookmarkReorderItem[]) {
        const bookmarks = await api.reorderFileBookmarks(items)
        setData((current) => ({ ...current, fileBookmarks: sortFileBookmarks(bookmarks ?? current.fileBookmarks) }))
        return bookmarks
      },
      async createLocalPathMapping(input: LocalPathMappingInput) {
        const mapping = await api.createLocalPathMapping(input)
        setData((current) => ({ ...current, localPathMappings: upsertLocalPathMapping(current.localPathMappings, mapping) }))
        return mapping
      },
      async updateLocalPathMapping(id: string, input: LocalPathMappingInput) {
        const mapping = await api.updateLocalPathMapping(id, input)
        setData((current) => ({ ...current, localPathMappings: upsertLocalPathMapping(current.localPathMappings, mapping) }))
        return mapping
      },
      async deleteLocalPathMapping(id: string) {
        await api.deleteLocalPathMapping(id)
        setData((current) => ({ ...current, localPathMappings: current.localPathMappings.filter((mapping) => mapping.id !== id) }))
      },
      async reorderLocalPathMappings(items: LocalPathMappingReorderItem[]) {
        const mappings = await api.reorderLocalPathMappings(items)
        setData((current) => ({ ...current, localPathMappings: sortLocalPathMappings(mappings ?? current.localPathMappings) }))
        return mappings
      },
      async createForwardProfile(input: ForwardProfileInput) {
        const profile = await api.createForwardProfile(input)
        setData((current) => ({ ...current, forwardProfiles: upsertForwardProfile(current.forwardProfiles, profile) }))
        return profile
      },
      async updateForwardProfile(id: string, input: ForwardProfileInput) {
        const profile = await api.updateForwardProfile(id, input)
        setData((current) => ({ ...current, forwardProfiles: upsertForwardProfile(current.forwardProfiles, profile) }))
        return profile
      },
      async deleteForwardProfile(id: string) {
        await api.deleteForwardProfile(id)
        setData((current) => ({ ...current, forwardProfiles: current.forwardProfiles.filter((profile) => profile.id !== id) }))
      },
      async startForward(input: ForwardStartRequest) {
        const forward = await api.startForward(input)
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
              await api.stopForward(forwardId)
              stopConfirmed = true
            },
            (input) => api.startForward(input),
          )
          const completion = registerStartedForward(replacement, currentForward.id)
          return { forward: replacement, completion }
        } catch (error) {
          await reconcileRestartFailure(id, stopConfirmed)
          throw error
        }
      },
      async stopForward(id: string) {
        await api.stopForward(id)
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
      async createHost(input: HostInput) {
        const host = await api.createHost(input)
        await load('silent')
        return host
      },
      async createHostGroup(name: string) {
        const group = await api.createHostGroup(name)
        setData((current) => ({ ...current, groups: upsertHostGroup(current.groups, group) }))
        return group
      },
      async updateHostGroup(id: string, name: string) {
        const group = await api.updateHostGroup(id, name)
        setData((current) => ({ ...current, groups: upsertHostGroup(current.groups, group) }))
        return group
      },
      async deleteHostGroup(id: string) {
        await api.deleteHostGroup(id)
        setData((current) => ({
          ...current,
          groups: current.groups.filter((group) => group.id !== id),
          hosts: current.hosts.map((host) => (host.group_id === id ? { ...host, group_id: '' } : host)),
        }))
      },
      async reorderHostGroups(items: GroupReorderItem[]) {
        const groups = await api.reorderHostGroups(items)
        setData((current) => ({ ...current, groups: [...groups].sort(sortHostGroups) }))
        return groups
      },
      async createConnectionProxy(input: ConnectionProxyInput) {
        const proxy = await api.createConnectionProxy(input)
        setData((current) => ({
          ...current,
          proxies: upsertConnectionProxy(current.proxies, proxy),
        }))
        return proxy
      },
      async updateConnectionProxy(id: string, input: ConnectionProxyInput) {
        const proxy = await api.updateConnectionProxy(id, input)
        setData((current) => ({
          ...current,
          proxies: upsertConnectionProxy(current.proxies, proxy),
        }))
        return proxy
      },
      async deleteConnectionProxy(id: string) {
        await api.deleteConnectionProxy(id)
        setData((current) => ({
          ...current,
          proxies: current.proxies.filter((proxy) => proxy.id !== id),
        }))
      },
      async updateHost(id: string, input: HostInput) {
        const host = await api.updateHost(id, input)
        await load('silent')
        return host
      },
      async toggleHostFavorite(hostId: string) {
        const host = data.hosts.find((item) => item.id === hostId)
        if (!host) {
          return
        }
        const nextHost = await api.updateHost(host.id, { ...hostToInput(host), favorite: !host.favorite })
        setData((current) => ({
          ...current,
          hosts: current.hosts.map((item) => (item.id === nextHost.id ? nextHost : item)),
        }))
      },
      async deleteHost(id: string) {
        await api.deleteHost(id)
        await load('silent')
      },
      async refreshHostReachability(hostIds: string[] = [], force = false) {
        const states = await api.refreshHostReachability(hostIds, force)
        setData((current) => ({
          ...current,
          hostReachability: mergeHostReachabilityStates(current.hostReachability, states ?? []),
        }))
      },
      updateHostReachability(event: HostReachabilityEvent) {
        setData((current) => ({
          ...current,
          hostReachability: mergeHostReachabilityEvent(current.hostReachability, event),
        }))
      },
      async createCredential(input: CredentialInput) {
        const passphraseCredentialId = input.metadata.passphrase_credential_id?.trim()
        const privateKeyMetadata = { ...input.metadata }
        delete privateKeyMetadata.passphrase_credential_id
        const credential = input.type === 'private_key' && input.ssh_key_info
          ? (await api.createPrivateKeyCredentialBundle({
              private_key: {
                name: input.name,
                vault_id: input.vault_id,
                secret: input.secret,
                metadata: privateKeyMetadata,
              },
              ssh_key_info: input.ssh_key_info,
              passphrase: input.pending_passphrase,
              passphrase_credential_id: input.pending_passphrase ? undefined : passphraseCredentialId,
            })).private_key
          : await api.createCredential(input)
        await load('silent')
        return credential
      },
      async updateCredential(id: string, input: CredentialInput) {
        const credential = await api.updateCredential(id, input)
        await load('silent')
        return credential
      },
      async deleteCredential(id: string) {
        await api.deleteCredential(id)
        await load('silent')
      },
      async connect(hostId: string, cols = 120, rows = 32) {
        const session = await api.createSession(hostId, cols, rows)
        bumpSessionRevision(sessionEventRevisionsRef.current, session.id)
        inventoryStateSignaturesRef.current.set(session.id, sessionInventorySignature(session))
        setActiveSession(session)
        setData((current) => ({ ...current, sessions: upsertSession(current.sessions, session) }))
        void load('silent')
        return session
      },
      async openLocalTerminal(shell: LocalShell, cols = 120, rows = 32) {
        const session = await api.createLocalSession(shell, cols, rows)
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
        await api.deleteSession(sessionId)
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
          refreshed = await api.refreshSessionInventory(sessionId, force, { signal })
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
          ...sessionsToClose.map((session) => api.deleteSession(session.id)),
          ...fileSessionsToClose.map((fileSession) => api.deleteFileSession(fileSession.id)),
          ...forwardsToClose.map((forward) => api.stopForward(forward.id)),
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
        const createFileSession = () => api.createFileSession(hostId, sourceSessionId, initialPath)
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
                      () => api.deleteFileSession(supersededSession.id),
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
                      api,
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
          await api.deleteFileSession(fileSessionId)
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
          () => api.reconnectFileSession(fileSessionId),
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
      api,
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

  return { api, data, initializing, refreshing, apiReady, error, activeSession, setActiveSession, lastUpdatedAt, forwardErrorEvent, fileSessionClosures, actions }
}

function removeMatchingFileSessionClosure(
  closures: Record<string, FileSessionClosureState>,
  sourceSessionId: string,
  fileSessionId: string,
) {
  const closure = closures[sourceSessionId]
  if (!closure || closure.session.id !== fileSessionId) {
    return closures
  }
  const next = { ...closures }
  delete next[sourceSessionId]
  return next
}

function reconcileActiveSession(current: Session | null, nextSessions: Session[], mode: LoadMode) {
  if (current) {
    const updated = nextSessions.find((session) => session.id === current.id)
    if (updated) {
      return updated
    }
  }
  if (mode === 'initial') {
    return nextSessions[0] ?? null
  }
  return null
}

function upsertTerminalFont(fonts: TerminalFont[], next: TerminalFont) {
  const exists = fonts.some((font) => font.id === next.id)
  if (exists) {
    return fonts.map((font) => (font.id === next.id ? next : font))
  }
  return [next, ...fonts]
}

function upsertHostGroup(groups: HostGroup[], next: HostGroup) {
  const exists = groups.some((group) => group.id === next.id)
  const merged = exists ? groups.map((group) => (group.id === next.id ? next : group)) : [...groups, next]
  return [...merged].sort(sortHostGroups)
}

function sortHostGroups(left: HostGroup, right: HostGroup) {
  if (left.sort_order !== right.sort_order) {
    return left.sort_order - right.sort_order
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  return left.id.localeCompare(right.id)
}

function sortConnectionProxies(proxies: AppData['proxies']) {
  return [...proxies].sort((left, right) => (
    left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ))
}

function upsertConnectionProxy(
  proxies: AppData['proxies'],
  next: AppData['proxies'][number],
) {
  const exists = proxies.some((proxy) => proxy.id === next.id)
  return sortConnectionProxies(
    exists
      ? proxies.map((proxy) => (proxy.id === next.id ? next : proxy))
      : [...proxies, next],
  )
}

function upsertSession(sessions: Session[], next: Session) {
  const exists = sessions.some((session) => session.id === next.id)
  if (exists) {
    return sessions.map((session) => (session.id === next.id ? next : session))
  }
  return [...sessions, next]
}

function markHostRecentlyConnected(
  hosts: AppData['hosts'],
  sessions: Session[],
  sessionId: string,
  patch: Partial<Session>,
) {
  const sessionsWithPatch = sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session))
  const updatedSession = sessionsWithPatch.find((session) => session.id === sessionId)
  if (updatedSession?.kind !== 'ssh' || updatedSession.status !== 'connected' || !updatedSession.host_id) {
    return { hosts, sessions: sessionsWithPatch }
  }
  const connectedAt = updatedSession.connected_at ?? new Date().toISOString()
  return {
    hosts: hosts.map((host) => (host.id === updatedSession.host_id ? { ...host, last_connected_at: connectedAt } : host)),
    sessions: sessionsWithPatch,
  }
}

function upsertCodeSnippet(snippets: CodeSnippet[], next: CodeSnippet) {
  const exists = snippets.some((snippet) => snippet.id === next.id)
  const merged = exists ? snippets.map((snippet) => (snippet.id === next.id ? next : snippet)) : [next, ...snippets]
  return [...merged].sort(sortCodeSnippets)
}

function sortCodeSnippetGroups(groups: CodeSnippetGroup[]) {
  return [...groups].sort((left, right) => (
    left.sort_order - right.sort_order
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
  ))
}

function upsertCodeSnippetGroup(groups: CodeSnippetGroup[], next: CodeSnippetGroup) {
  const exists = groups.some((group) => group.id === next.id)
  return sortCodeSnippetGroups(
    exists ? groups.map((group) => (group.id === next.id ? next : group)) : [...groups, next],
  )
}

function replaceCodeSnippet(snippets: CodeSnippet[], next: CodeSnippet) {
  if (!snippets.some((snippet) => snippet.id === next.id)) {
    return upsertCodeSnippet(snippets, next)
  }
  return snippets.map((snippet) => (snippet.id === next.id ? next : snippet))
}

function upsertFileBookmarkGroup(groups: FileBookmarkGroup[], next: FileBookmarkGroup) {
  const exists = groups.some((group) => group.id === next.id)
  const merged = exists ? groups.map((group) => (group.id === next.id ? next : group)) : [...groups, next]
  return sortFileBookmarkGroups(merged)
}

function sortFileBookmarkGroups(groups: FileBookmarkGroup[]) {
  return [...groups].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }
    return left.id.localeCompare(right.id)
  })
}

function upsertFileBookmark(bookmarks: FileBookmark[], next: FileBookmark) {
  const exists = bookmarks.some((bookmark) => bookmark.id === next.id)
  const merged = exists ? bookmarks.map((bookmark) => (bookmark.id === next.id ? next : bookmark)) : [...bookmarks, next]
  return sortFileBookmarks(merged)
}

function sortFileBookmarks(bookmarks: FileBookmark[]) {
  return [...bookmarks].sort((left, right) => {
    if (left.group_id !== right.group_id) {
      return left.group_id.localeCompare(right.group_id)
    }
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }
    return left.id.localeCompare(right.id)
  })
}

function upsertLocalPathMapping(mappings: LocalPathMapping[], next: LocalPathMapping) {
  const exists = mappings.some((mapping) => mapping.id === next.id)
  const merged = exists ? mappings.map((mapping) => (mapping.id === next.id ? next : mapping)) : [...mappings, next]
  return sortLocalPathMappings(merged)
}

function sortLocalPathMappings(mappings: LocalPathMapping[]) {
  return [...mappings].sort((left, right) => {
    if (left.sort_order !== right.sort_order) {
      return left.sort_order - right.sort_order
    }
    if (left.name !== right.name) {
      return left.name.localeCompare(right.name)
    }
    return left.id.localeCompare(right.id)
  })
}

function upsertForwardProfile(profiles: ForwardProfile[], next: ForwardProfile) {
  const exists = profiles.some((profile) => profile.id === next.id)
  const merged = exists ? profiles.map((profile) => (profile.id === next.id ? next : profile)) : [next, ...profiles]
  return [...merged].sort(sortForwardProfiles)
}

function sortForwardProfiles(left: ForwardProfile, right: ForwardProfile) {
  if (left.mode !== right.mode) {
    return left.mode.localeCompare(right.mode)
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  return left.id.localeCompare(right.id)
}

function upsertForward(forwards: ForwardInstance[], next: ForwardInstance) {
  const exists = forwards.some((forward) => forward.id === next.id)
  const merged = exists ? forwards.map((forward) => (forward.id === next.id ? next : forward)) : [next, ...forwards]
  return [...merged].sort(sortForwards)
}

function visibleForwards(forwards: ForwardInstance[]) {
  return forwards.filter((forward) => !shouldRemoveForward(forward))
}

function bumpSessionRevision(revisions: Map<string, number>, sessionId: string) {
  revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1)
}

function settleForwardStartCompletion(
  waiters: Map<string, ForwardStartCompletionWaiter>,
  snapshots: Map<string, ForwardInstance>,
  revisions: Map<string, number>,
  forwardId: string,
  forward: ForwardInstance | null,
) {
  if (forward && !isForwardStartSettledStatus(forward.status)) {
    return false
  }
  const waiter = waiters.get(forwardId)
  if (!waiter) {
    return false
  }
  waiters.delete(forwardId)
  snapshots.delete(forwardId)
  revisions.delete(forwardId)
  window.clearTimeout(waiter.cleanupTimer)
  waiter.resolve(forward)
  return true
}

function reconcileForwardStartCompletions(
  waiters: Map<string, ForwardStartCompletionWaiter>,
  snapshots: Map<string, ForwardInstance>,
  revisions: Map<string, number>,
  authoritativeForwards: ForwardInstance[],
) {
  const byId = new Map(authoritativeForwards.map((forward) => [forward.id, forward]))
  const now = performance.now()
  for (const [forwardId, waiter] of waiters) {
    const forward = byId.get(forwardId)
    if (forward) {
      settleForwardStartCompletion(
        waiters,
        snapshots,
        revisions,
        forwardId,
        forward,
      )
      continue
    }
    if (now - waiter.registeredAt >= FORWARD_START_MISSING_GRACE_MS) {
      settleForwardStartCompletion(
        waiters,
        snapshots,
        revisions,
        forwardId,
        null,
      )
    }
  }
}

function rememberForwardEventSnapshot(
  snapshots: Map<string, ForwardInstance>,
  forward: ForwardInstance,
) {
  snapshots.delete(forward.id)
  snapshots.set(forward.id, forward)
  if (snapshots.size <= 256) {
    return
  }
  const oldestForwardId = snapshots.keys().next().value
  if (oldestForwardId) {
    snapshots.delete(oldestForwardId)
  }
}

function sessionInventorySignature(session: Partial<Session>) {
  return [
    session.inventory_status ?? 'idle',
    session.inventory_message ?? '',
    session.linux_system_info?.collected_at ?? '',
  ].join('\u0000')
}

function indexHostReachability(states: HostReachability[]) {
  return states.reduce<Record<string, HostReachability>>((acc, state) => {
    acc[state.host_id] = state
    return acc
  }, {})
}

function mergeHostReachabilityStates(
  current: Record<string, HostReachability>,
  states: HostReachability[],
) {
  if (states.length === 0) {
    return current
  }
  return { ...current, ...indexHostReachability(states) }
}

function mergeHostReachabilityEvent(
  current: Record<string, HostReachability>,
  event: HostReachabilityEvent,
) {
  if (event.type === 'snapshot' && event.items) {
    return indexHostReachability(event.items)
  }
  if (event.state) {
    return { ...current, [event.state.host_id]: event.state }
  }
  return current
}

function shouldRemoveForward(forward: ForwardInstance) {
  return forward.status === 'stopped' || forward.status === 'failed'
}

function shouldEmitForwardError(event: ForwardEvent) {
  if (event.type === 'snapshot') {
    return false
  }
  if (event.type === 'error' || event.forward.status === 'failed') {
    return true
  }
  return event.type === 'update' && event.forward.status === 'running' && Boolean(event.forward.last_error)
}

function sortForwards(left: ForwardInstance, right: ForwardInstance) {
  const leftTime = new Date(left.started_at).getTime()
  const rightTime = new Date(right.started_at).getTime()
  if (leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return left.id.localeCompare(right.id)
}

async function syncForwardAfterStart(
  api: TermousApi,
  id: string,
  onForward: (forward: ForwardInstance) => void,
  currentEventRevision: () => number,
  isCompletionPending: () => boolean,
): Promise<ForwardInstance | null | undefined> {
  const intervals = [240, 420, 700, 1100, 1700, 2600, 4000]
  for (const interval of intervals) {
    await delay(interval)
    if (!isCompletionPending()) {
      return undefined
    }
    const eventRevision = currentEventRevision()
    try {
      const forward = await api.getForward(id)
      if (!isCompletionPending()) {
        return undefined
      }
      if (!shouldApplyForwardPollResponse(eventRevision, currentEventRevision())) {
        continue
      }
      onForward(forward)
      if (isForwardStartSettledStatus(forward.status)) {
        return forward
      }
    } catch (syncError) {
      if (!isCompletionPending()) {
        return undefined
      }
      if (!shouldApplyForwardPollResponse(eventRevision, currentEventRevision())) {
        continue
      }
      if (syncError instanceof TermousApiError && syncError.status === 404) {
        return syncForwardFromList(
          api,
          id,
          onForward,
          currentEventRevision,
          isCompletionPending,
        )
      }
    }
  }
  return syncForwardFromList(
    api,
    id,
    onForward,
    currentEventRevision,
    isCompletionPending,
  )
}

async function syncForwardFromList(
  api: TermousApi,
  id: string,
  onForward: (forward: ForwardInstance) => void,
  currentEventRevision: () => number,
  isCompletionPending: () => boolean,
): Promise<ForwardInstance | null | undefined> {
  const eventRevision = currentEventRevision()
  try {
    const forwards = await api.forwards()
    if (
      !isCompletionPending()
      || !shouldApplyForwardPollResponse(eventRevision, currentEventRevision())
    ) {
      return undefined
    }
    const forward = (forwards ?? []).find((item) => item.id === id)
    if (!forward) {
      return null
    }
    onForward(forward)
    return isForwardStartSettledStatus(forward.status) ? forward : undefined
  } catch {
    return undefined
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function sortCodeSnippets(left: CodeSnippet, right: CodeSnippet) {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  const leftCreatedAt = new Date(left.created_at).getTime()
  const rightCreatedAt = new Date(right.created_at).getTime()
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt
  }
  return left.id.localeCompare(right.id)
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
