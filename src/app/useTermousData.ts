import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiFromRuntime, TermousApi, TermousApiError } from '../api/client'
import type {
  AppData,
  CodeSnippet,
  CodeSnippetInput,
  CredentialInput,
  FileSession,
  ForwardEvent,
  ForwardInstance,
  ForwardProfile,
  ForwardProfileInput,
  ForwardStartRequest,
  HostGroup,
  HostReachability,
  HostReachabilityEvent,
  HostInput,
  Language,
  LocalShell,
  Session,
  Settings,
  TerminalFont,
  TerminalSettings,
} from '../types/domain'
import { changeLanguage } from '../i18n'
import { defaultTerminalSettings, normalizeSettings } from '../features/settings/terminalSettings'
import { hostToInput } from '../features/hosts/hostInput'

const initialSettings: Settings = { language: 'zh-CN', terminal: defaultTerminalSettings }
type LoadMode = 'initial' | 'background' | 'silent'

const initialData: AppData = {
  hosts: [],
  groups: [],
  credentials: [],
  knownHosts: [],
  sessions: [],
  fileSessions: [],
  forwardProfiles: [],
  forwards: [],
  snippets: [],
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

  const loadWithApi = useCallback(async (apiClient: TermousApi, mode: LoadMode = 'background') => {
    if (mode === 'initial') {
      setInitializing(true)
    } else if (mode === 'background') {
      setRefreshing(true)
    }
    setError(null)
    try {
      await apiClient.health()
      const [settings, terminalFonts, snippets, groups, hosts, hostReachability, credentials, knownHosts, sessions, fileSessions, forwardProfiles, forwards] = await Promise.all([
        apiClient.settings(),
        apiClient.terminalFonts(),
        apiClient.codeSnippets(),
        apiClient.hostGroups(),
        apiClient.hosts(),
        apiClient.hostReachability(),
        apiClient.credentials(),
        apiClient.knownHosts(),
        apiClient.sessions(),
        apiClient.fileSessions(),
        apiClient.forwardProfiles(),
        apiClient.forwards(),
      ])
      const nextSessions = sessions ?? []
      const nextSettings = normalizeSettings(settings)
      setData({
        settings: nextSettings,
        groups: groups ?? [],
        hosts: hosts ?? [],
        credentials: credentials ?? [],
        knownHosts: knownHosts ?? [],
        sessions: nextSessions,
        fileSessions: fileSessions ?? [],
        forwardProfiles: forwardProfiles ?? [],
        forwards: visibleForwards(forwards ?? []),
        snippets: snippets ?? [],
        terminalFonts: terminalFonts ?? [],
        hostReachability: indexHostReachability(hostReachability ?? []),
      })
      setActiveSession((current) => reconcileActiveSession(current, nextSessions, mode))
      setApiReady(true)
      setLastUpdatedAt(new Date().toISOString())
      await changeLanguage(nextSettings.language)
    } catch (loadError) {
      setApiReady(false)
      setError(publicMessage(loadError))
    } finally {
      if (mode === 'initial') {
        setInitializing(false)
      } else if (mode === 'background') {
        setRefreshing(false)
      }
    }
  }, [])

  const load = useCallback(
    (mode: LoadMode = 'background') => loadWithApi(api, mode),
    [api, loadWithApi],
  )

  const reloadForwardsWithApi = useCallback(async (apiClient: TermousApi) => {
    const forwards = await apiClient.forwards()
    setData((current) => ({ ...current, forwards: visibleForwards(forwards ?? []) }))
    setLastUpdatedAt(new Date().toISOString())
  }, [])

  const reloadForwards = useCallback(
    () => reloadForwardsWithApi(api),
    [api, reloadForwardsWithApi],
  )

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
        setData((current) => ({ ...current, forwards: upsertForward(current.forwards, forward) }))
        void syncForwardAfterStart(
          api,
          forward.id,
          (nextForward) => {
            const shouldRemove = shouldRemoveForward(nextForward)
            if (shouldRemove) {
              setForwardErrorEvent({ type: 'error', forward: nextForward, message: nextForward.last_error || nextForward.status_message })
            }
            setData((current) => {
              if (shouldRemove) {
                return { ...current, forwards: current.forwards.filter((item) => item.id !== nextForward.id) }
              }
              return { ...current, forwards: upsertForward(current.forwards, nextForward) }
            })
          },
          () => reloadForwards(),
        )
        return forward
      },
      async stopForward(id: string) {
        await api.stopForward(id)
        setData((current) => {
          const existing = current.forwards.find((forward) => forward.id === id)
          if (existing && isTransientForward(existing)) {
            return { ...current, forwards: current.forwards.filter((forward) => forward.id !== id) }
          }
          return { ...current, forwards: markForwardStopped(current.forwards, id) }
        })
      },
      updateForward(event: ForwardEvent) {
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
        await api.createHost(input)
        await load('silent')
      },
      async createHostGroup(name: string) {
        const group = await api.createHostGroup(name)
        setData((current) => ({ ...current, groups: upsertHostGroup(current.groups, group) }))
        return group
      },
      async updateHost(id: string, input: HostInput) {
        await api.updateHost(id, input)
        await load('silent')
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
      async importSSHConfig() {
        const result = await api.importSSHConfig()
        await load('silent')
        return result
      },
      async createCredential(input: CredentialInput) {
        await api.createCredential(input)
        await load('silent')
      },
      async updateCredential(id: string, input: CredentialInput) {
        await api.updateCredential(id, input)
        await load('silent')
      },
      async deleteCredential(id: string) {
        await api.deleteCredential(id)
        await load('silent')
      },
      async generateKey() {
        await api.generateKey()
        await load('silent')
      },
      async connect(hostId: string, cols = 120, rows = 32) {
        const session = await api.createSession(hostId, cols, rows)
        setActiveSession(session)
        setData((current) => ({ ...current, sessions: upsertSession(current.sessions, session) }))
        void load('silent')
        return session
      },
      async openLocalTerminal(shell: LocalShell, cols = 120, rows = 32) {
        const session = await api.createLocalSession(shell, cols, rows)
        setActiveSession(session)
        setData((current) => ({ ...current, sessions: upsertSession(current.sessions, session) }))
        void load('silent')
        return session
      },
      async disconnect(sessionId: string) {
        await api.deleteSession(sessionId)
        const fallbackSession = data.sessions.find((session) => session.id !== sessionId) ?? null
        setData((current) => ({ ...current, sessions: current.sessions.filter((session) => session.id !== sessionId) }))
        setActiveSession((current) => (current?.id === sessionId ? fallbackSession : current))
        void load('silent')
      },
      async disconnectAllConnections() {
        const sessionsToClose = data.sessions
        const fileSessionsToClose = data.fileSessions
        const forwardsToClose = data.forwards.filter((forward) => forward.status === 'starting' || forward.status === 'running' || forward.status === 'stopping')
        const results = await Promise.allSettled([
          ...sessionsToClose.map((session) => api.deleteSession(session.id)),
          ...fileSessionsToClose.map((fileSession) => api.deleteFileSession(fileSession.id)),
          ...forwardsToClose.map((forward) => api.stopForward(forward.id)),
        ])
        const failed = results.find((result) => result.status === 'rejected')
        if (failed && failed.status === 'rejected') {
          throw failed.reason
        }
        setData((current) => ({ ...current, sessions: [], fileSessions: [], forwards: markAllForwardsStopped(current.forwards) }))
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
      async connectFileSession(hostId: string, sourceSessionId = '', initialPath = '/') {
        const fileSession = await api.createFileSession(hostId, sourceSessionId, initialPath)
        setData((current) => ({ ...current, fileSessions: upsertFileSession(current.fileSessions, fileSession) }))
        return fileSession
      },
      async closeFileSession(fileSessionId: string) {
        await api.deleteFileSession(fileSessionId)
        setData((current) => ({
          ...current,
          fileSessions: current.fileSessions.filter((session) => session.id !== fileSessionId),
        }))
      },
      async reconnectFileSession(fileSessionId: string) {
        const fileSession = await api.reconnectFileSession(fileSessionId)
        setData((current) => ({ ...current, fileSessions: upsertFileSession(current.fileSessions, fileSession) }))
        return fileSession
      },
      async trustFileSessionHost(fileSessionId: string, decision: 'trust' | 'replace' | 'reject', fingerprintSHA256: string) {
        const fileSession = await api.trustFileSessionHost(fileSessionId, decision, fingerprintSHA256)
        setData((current) => ({ ...current, fileSessions: upsertFileSession(current.fileSessions, fileSession) }))
        return fileSession
      },
      updateFileSession(fileSession: FileSession) {
        setData((current) => ({ ...current, fileSessions: upsertFileSession(current.fileSessions, fileSession) }))
      },
    }),
    [api, data.fileSessions, data.forwards, data.hosts, data.settings, data.sessions, load, reloadForwards],
  )

  return { api, data, initializing, refreshing, apiReady, error, activeSession, setActiveSession, lastUpdatedAt, forwardErrorEvent, actions }
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

function upsertFileSession(fileSessions: FileSession[], next: FileSession) {
  const exists = fileSessions.some((session) => session.id === next.id)
  if (exists) {
    return fileSessions.map((session) => (session.id === next.id ? next : session))
  }
  return [next, ...fileSessions]
}

function upsertCodeSnippet(snippets: CodeSnippet[], next: CodeSnippet) {
  const exists = snippets.some((snippet) => snippet.id === next.id)
  const merged = exists ? snippets.map((snippet) => (snippet.id === next.id ? next : snippet)) : [next, ...snippets]
  return [...merged].sort(sortCodeSnippets)
}

function replaceCodeSnippet(snippets: CodeSnippet[], next: CodeSnippet) {
  if (!snippets.some((snippet) => snippet.id === next.id)) {
    return upsertCodeSnippet(snippets, next)
  }
  return snippets.map((snippet) => (snippet.id === next.id ? next : snippet))
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

function markForwardStopped(forwards: ForwardInstance[], id: string) {
  return forwards.map((forward) => (
    forward.id === id
      ? { ...forward, status: 'stopped' as const, phase: 'stopped' as const, progress: 100, status_message: '端口转发已停止' }
      : forward
  ))
}

function markAllForwardsStopped(forwards: ForwardInstance[]) {
  return forwards
    .filter((forward) => !isTransientForward(forward))
    .map((forward) => (
      forward.status === 'starting' || forward.status === 'running' || forward.status === 'stopping'
        ? { ...forward, status: 'stopped' as const, phase: 'stopped' as const, progress: 100, status_message: '端口转发已停止' }
        : forward
    ))
}

function visibleForwards(forwards: ForwardInstance[]) {
  return forwards.filter((forward) => !shouldRemoveForward(forward))
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
  return isTransientForward(forward) && (forward.status === 'stopped' || forward.status === 'failed')
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

function isTransientForward(forward: ForwardInstance) {
  return forward.scope === 'session' || forward.scope === 'background_once'
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
  onFallback: () => Promise<void>,
) {
  const intervals = [240, 420, 700, 1100, 1700, 2600, 4000]
  for (const interval of intervals) {
    await delay(interval)
    try {
      const forward = await api.getForward(id)
      onForward(forward)
      if (forward.status !== 'starting' && forward.status !== 'stopping') {
        return
      }
    } catch (syncError) {
      if (syncError instanceof TermousApiError && syncError.status === 404) {
        await runForwardSyncFallback(onFallback)
        return
      }
    }
  }
  await runForwardSyncFallback(onFallback)
}

async function runForwardSyncFallback(onFallback: () => Promise<void>) {
  try {
    await onFallback()
  } catch {
    // 转发启动后的补偿刷新不能反向扰动主界面状态。
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
