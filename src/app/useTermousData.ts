import { useCallback, useEffect, useMemo, useState } from 'react'
import { createApiFromRuntime, TermousApi, TermousApiError } from '../api/client'
import type {
  AppData,
  CredentialInput,
  HostInput,
  Language,
  Session,
  Settings,
} from '../types/domain'
import { changeLanguage } from '../i18n'

const initialSettings: Settings = { language: 'zh-CN' }

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
  const [loading, setLoading] = useState(true)
  const [apiReady, setApiReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSession, setActiveSession] = useState<Session | null>(null)

  useEffect(() => {
    void createApiFromRuntime().then(setApi)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
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
        if (current && sessions.some((session) => session.id === current.id)) {
          return current
        }
        return sessions[0] ?? null
      })
      setApiReady(true)
      await changeLanguage(settings.language)
    } catch (loadError) {
      setApiReady(false)
      setError(publicMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const actions = useMemo(
    () => ({
      reload: load,
      async setLanguage(language: Language) {
        const settings = await api.updateLanguage(language)
        setData((current) => ({ ...current, settings }))
        await changeLanguage(settings.language)
      },
      async createHost(input: HostInput) {
        await api.createHost(input)
        await load()
      },
      async updateHost(id: string, input: HostInput) {
        await api.updateHost(id, input)
        await load()
      },
      async deleteHost(id: string) {
        await api.deleteHost(id)
        await load()
      },
      async importSSHConfig() {
        const result = await api.importSSHConfig()
        await load()
        return result
      },
      async createCredential(input: CredentialInput) {
        await api.createCredential(input)
        await load()
      },
      async updateCredential(id: string, input: CredentialInput) {
        await api.updateCredential(id, input)
        await load()
      },
      async deleteCredential(id: string) {
        await api.deleteCredential(id)
        await load()
      },
      async generateKey() {
        await api.generateKey()
        await load()
      },
      async connect(hostId: string, cols = 120, rows = 32) {
        const session = await api.createSession(hostId, cols, rows)
        setActiveSession(session)
        await load()
        return session
      },
      async disconnect(sessionId: string) {
        await api.deleteSession(sessionId)
        setActiveSession(null)
        await load()
      },
    }),
    [api, load],
  )

  return { api, data, loading, apiReady, error, activeSession, setActiveSession, actions }
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
