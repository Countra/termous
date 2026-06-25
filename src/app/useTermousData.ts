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
} from '../types/domain'
import { changeLanguage } from '../i18n'

const initialSettings: Settings = { language: 'zh-CN' }
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

  useEffect(() => {
    void createApiFromRuntime().then(setApi)
  }, [])

  const load = useCallback(async (mode: LoadMode = 'background') => {
    if (mode === 'initial') {
      setInitializing(true)
    } else if (mode === 'background') {
      setRefreshing(true)
    }
    setError(null)
    try {
      await api.health()
      const [settings, groups, hosts, credentials, knownHosts, sessions] = await Promise.all([
        api.settings(),
        api.hostGroups(),
        api.hosts(),
        api.credentials(),
        api.knownHosts(),
        api.sessions(),
      ])
      setData({
        settings,
        groups: groups ?? [],
        hosts: hosts ?? [],
        credentials: credentials ?? [],
        knownHosts: knownHosts ?? [],
        sessions: sessions ?? [],
      })
      setActiveSession((current) => {
        if (current) {
          const updated = sessions.find((session) => session.id === current.id)
          if (updated) {
            return updated
          }
        }
        return sessions[0] ?? null
      })
      setApiReady(true)
      setLastUpdatedAt(new Date().toISOString())
      await changeLanguage(settings.language)
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
  }, [api])

  useEffect(() => {
    void load('initial')
  }, [load])

  const actions = useMemo(
    () => ({
      reload: () => load('background'),
      async setLanguage(language: Language) {
        const settings = await api.updateLanguage(language)
        setData((current) => ({ ...current, settings }))
        await changeLanguage(settings.language)
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
        setActiveSession((current) => (current?.id === sessionId ? null : current))
        setData((current) => ({ ...current, sessions: current.sessions.filter((session) => session.id !== sessionId) }))
        void load('silent')
      },
      updateActiveSession(patch: Partial<Session>) {
        setActiveSession((current) => (current ? { ...current, ...patch } : current))
        setData((current) => ({
          ...current,
          sessions: current.sessions.map((session) => (session.id === activeSession?.id ? { ...session, ...patch } : session)),
        }))
      },
    }),
    [activeSession?.id, api, load],
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
