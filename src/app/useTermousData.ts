import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiFromRuntime, TermousApi, TermousApiError } from '../api/client'
import type {
  AppData,
  CredentialInput,
  HostInput,
  Language,
  LocalShell,
  Session,
  Settings,
  TerminalSettings,
} from '../types/domain'
import { changeLanguage } from '../i18n'
import { defaultTerminalSettings, normalizeSettings } from '../features/settings/terminalSettings'

const initialSettings: Settings = { language: 'zh-CN', terminal: defaultTerminalSettings }
type LoadMode = 'initial' | 'background' | 'silent'

const initialData: AppData = {
  hosts: [],
  groups: [],
  credentials: [],
  knownHosts: [],
  sessions: [],
  settings: initialSettings,
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

  const loadWithApi = useCallback(async (apiClient: TermousApi, mode: LoadMode = 'background') => {
    if (mode === 'initial') {
      setInitializing(true)
    } else if (mode === 'background') {
      setRefreshing(true)
    }
    setError(null)
    try {
      await apiClient.health()
      const [settings, groups, hosts, credentials, knownHosts, sessions] = await Promise.all([
        apiClient.settings(),
        apiClient.hostGroups(),
        apiClient.hosts(),
        apiClient.credentials(),
        apiClient.knownHosts(),
        apiClient.sessions(),
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
      })
      setActiveSession((current) => {
        if (current) {
          const updated = nextSessions.find((session) => session.id === current.id)
          if (updated) {
            return updated
          }
        }
        return nextSessions[0] ?? null
      })
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
      async createHost(input: HostInput) {
        await api.createHost(input)
        await load('silent')
      },
      async updateHost(id: string, input: HostInput) {
        await api.updateHost(id, input)
        await load('silent')
      },
      async deleteHost(id: string) {
        await api.deleteHost(id)
        await load('silent')
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
      async disconnectAllSessions() {
        const sessionsToClose = data.sessions
        const results = await Promise.allSettled(sessionsToClose.map((session) => api.deleteSession(session.id)))
        const failed = results.find((result) => result.status === 'rejected')
        if (failed && failed.status === 'rejected') {
          throw failed.reason
        }
        setData((current) => ({ ...current, sessions: [] }))
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
          sessions: current.sessions.map((session) => (session.id === sessionId ? { ...session, ...patch } : session)),
        }))
      },
    }),
    [api, data.settings, data.sessions, load],
  )

  return { api, data, initializing, refreshing, apiReady, error, activeSession, setActiveSession, lastUpdatedAt, actions }
}

function upsertSession(sessions: Session[], next: Session) {
  const exists = sessions.some((session) => session.id === next.id)
  if (exists) {
    return sessions.map((session) => (session.id === next.id ? next : session))
  }
  return [next, ...sessions]
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
