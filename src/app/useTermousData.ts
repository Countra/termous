import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiFromRuntime, TermousApi, TermousApiError } from '../api/client'
import type {
  AppData,
  AppearanceSettings,
  CodeSnippet,
  CodeSnippetGroup,
  CodeSnippetGroupInput,
  CodeSnippetInput,
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

const initialSettings: Settings = {
  language: 'zh-CN',
  appearance: defaultAppearanceSettings,
  terminal: defaultTerminalSettings,
  window: defaultWindowSettings,
}
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

  const loadWithApi = useCallback(async (apiClient: TermousApi, mode: LoadMode = 'background') => {
    if (mode === 'initial') {
      setInitializing(true)
    } else if (mode === 'background') {
      setRefreshing(true)
    }
    setError(null)
    try {
      await apiClient.health()
      const [
        settings,
        terminalFonts,
        snippetGroups,
        snippets,
        fileBookmarkGroups,
        fileBookmarks,
        localPathMappings,
        groups,
        hosts,
        hostReachability,
        credentials,
        knownHosts,
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
        snippetGroups: sortCodeSnippetGroups(snippetGroups ?? []),
        snippets: snippets ?? [],
        fileBookmarkGroups: sortFileBookmarkGroups(fileBookmarkGroups ?? []),
        fileBookmarks: sortFileBookmarks(fileBookmarks ?? []),
        localPathMappings: sortLocalPathMappings(localPathMappings ?? []),
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
        const credential = await api.createCredential(input)
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
      async generateKey() {
        const credential = await api.generateKey()
        await load('silent')
        return credential
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
      async connectFileSession(hostId: string, sourceSessionId = '', initialPath = '') {
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
