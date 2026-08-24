import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  RemoteDesktopDisplayMode,
  RemoteDesktopProfile,
  RemoteDesktopSession,
  VncCredentials,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '../api/remoteDesktopGateway.ts'
import { decodeRemoteDesktopSessionEvent } from '../model/sessionEventProtocol.ts'
import { shouldAcceptSessionSnapshot } from '../model/sessionSnapshot.ts'
import { VncViewerAdapter } from './adapters/noVncAdapter.ts'
import {
  RemoteDesktopRuntimeContext,
  type VncViewerState,
} from './remoteDesktopRuntimeContext.ts'
import {
  VncConnectionMetricsContext,
  VncConnectionMetricsStore,
} from './vncConnectionMetricsStore.tsx'
import styles from './RemoteDesktopRuntimeProvider.module.scss'

interface RemoteDesktopRuntimeProviderProps {
  api: RemoteDesktopGateway
  enabled: boolean
  profiles: RemoteDesktopProfile[]
  initialSessions: RemoteDesktopSession[]
  children: ReactNode
  onSessionCountChange?: (count: number) => void
}

interface ViewerEntry {
  sessionId: string
  connectionGeneration: number
  container: HTMLDivElement
  viewport: HTMLDivElement | null
  adapter: VncViewerAdapter | null
  attachPromise: Promise<void> | null
  credentials: VncCredentials | null
  acceptedFingerprint: string
  blockedAttachGeneration: number | null
  connectedGeneration: number | null
}

const emptyCapabilities = { power: false }
const reconnectDelayInitial = 800
const reconnectDelayMaximum = 5000

export function RemoteDesktopRuntimeProvider({
  api,
  enabled,
  profiles,
  initialSessions,
  children,
  onSessionCountChange,
}: RemoteDesktopRuntimeProviderProps) {
  const [sessions, setSessions] = useState<RemoteDesktopSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [viewerStates, setViewerStates] = useState<Record<string, VncViewerState>>({})
  const sessionsRef = useRef(new Map<string, RemoteDesktopSession>())
  const profilesRef = useRef(new Map<string, RemoteDesktopProfile>())
  const initialSessionsRef = useRef(initialSessions)
  const entriesRef = useRef(new Map<string, ViewerEntry>())
  const metricsStoreRef = useRef(new VncConnectionMetricsStore())
  const parkingHostRef = useRef<HTMLDivElement>(null)
  const disposedRef = useRef(false)
  const reconcileRevisionRef = useRef(0)
  const viewerStatesRef = useRef(viewerStates)

  sessionsRef.current = new Map(sessions.map((session) => [session.id, session]))
  profilesRef.current = new Map(profiles.map((profile) => [profile.id, profile]))
  initialSessionsRef.current = initialSessions
  viewerStatesRef.current = viewerStates

  const commitViewerState = useCallback((sessionId: string, patch: Partial<VncViewerState>) => {
    setViewerStates((current) => {
      const previous = current[sessionId] ?? viewerStateForSession(
        sessionsRef.current.get(sessionId),
        profilesRef.current.get(sessionsRef.current.get(sessionId)?.profile_id ?? ''),
      )
      return { ...current, [sessionId]: { ...previous, ...patch } }
    })
  }, [])

  const disposeViewer = useCallback((sessionId: string, clearCredentials: boolean) => {
    const entry = entriesRef.current.get(sessionId)
    if (!entry) {
      metricsStoreRef.current.reset(sessionId)
      return
    }
    entry.adapter?.dispose()
    entry.adapter = null
    entry.attachPromise = null
    if (clearCredentials) {
      entry.credentials = null
      entry.acceptedFingerprint = ''
    }
    entry.container.remove()
    entriesRef.current.delete(sessionId)
    metricsStoreRef.current.reset(sessionId)
  }, [])

  const reconcileSessions = useCallback((nextSessions: RemoteDesktopSession[]) => {
    const normalized = sortSessions(nextSessions)
    const previousSessions = sessionsRef.current
    const generationChanged = new Set<string>()
    sessionsRef.current = new Map(normalized.map((session) => [session.id, session]))
    const nextIds = new Set(normalized.map((session) => session.id))
    for (const session of normalized) {
      metricsStoreRef.current.activateGeneration(session.id, session.connection_generation)
    }
    for (const sessionId of previousSessions.keys()) {
      if (!nextIds.has(sessionId)) {
        metricsStoreRef.current.remove(sessionId)
      }
    }
    for (const sessionId of entriesRef.current.keys()) {
      if (!nextIds.has(sessionId)) {
        disposeViewer(sessionId, true)
      }
    }
    for (const session of normalized) {
      const previous = previousSessions.get(session.id)
      if (!previous || previous.connection_generation === session.connection_generation) {
        continue
      }
      generationChanged.add(session.id)
      const entry = entriesRef.current.get(session.id)
      if (!entry) {
        continue
      }
      entry.adapter?.dispose()
      entry.adapter = null
      entry.attachPromise = null
      entry.connectionGeneration = session.connection_generation
      entry.blockedAttachGeneration = null
      entry.connectedGeneration = null
    }
    for (const session of normalized) {
      if (!acceptsTelemetry(session.status)) {
        metricsStoreRef.current.reset(session.id)
      }
      if (session.status !== 'failed') {
        continue
      }
      const entry = entriesRef.current.get(session.id)
      if (!entry) {
        continue
      }
      entry.adapter?.dispose()
      entry.adapter = null
      entry.attachPromise = null
      entry.credentials = null
      entry.acceptedFingerprint = ''
      entry.blockedAttachGeneration = session.connection_generation
      entry.connectedGeneration = null
    }
    setViewerStates((current) => {
      const next: Record<string, VncViewerState> = {}
      for (const session of normalized) {
        const previous = current[session.id]
        const profile = profilesRef.current.get(session.profile_id)
        next[session.id] = previous ?? viewerStateForSession(session, profile)
        if (generationChanged.has(session.id)) {
          next[session.id] = {
            ...next[session.id],
            connection: 'idle',
            credentialTypes: [],
            verification: null,
            desktopName: '',
            remoteClipboard: '',
            capabilities: emptyCapabilities,
            errorCode: '',
          }
        }
        if (session.status === 'failed') {
          next[session.id] = {
            ...next[session.id],
            connection: 'disconnected',
            credentialTypes: [],
            verification: null,
            errorCode: '',
          }
        }
      }
      return next
    })
    setSessions(normalized)
    setActiveSessionId((current) => (
      current && nextIds.has(current) ? current : normalized[0]?.id ?? null
    ))
  }, [disposeViewer])

  const upsertSession = useCallback((next: RemoteDesktopSession) => {
    if (!shouldAcceptSessionSnapshot(sessionsRef.current.get(next.id), next)) {
      return
    }
    reconcileSessions([
      ...Array.from(sessionsRef.current.values()).filter((session) => session.id !== next.id),
      next,
    ])
  }, [reconcileSessions])

  const removeSession = useCallback((sessionId: string) => {
    reconcileSessions(Array.from(sessionsRef.current.values()).filter((session) => session.id !== sessionId))
  }, [reconcileSessions])

  useEffect(() => {
    onSessionCountChange?.(sessions.filter(isActiveSession).length)
  }, [onSessionCountChange, sessions])

  useEffect(() => {
    if (!enabled) {
      reconcileRevisionRef.current += 1
      reconcileSessions([])
      return undefined
    }
    // AppData 只提供启动快照；从此处开始由事件流和权威 GET 单独维护运行态。
    reconcileSessions(initialSessionsRef.current)
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let reconnectDelay = reconnectDelayInitial

    const reconcile = async () => {
      const revision = ++reconcileRevisionRef.current
      try {
        const next = await api.remoteDesktopSessions()
        if (!disposed && revision === reconcileRevisionRef.current) {
          reconcileSessions(next)
        }
      } catch {
        // 实时通道会继续重连；保留已知会话避免短暂网络故障清空工作区。
      }
    }
    const connect = () => {
      if (disposed) {
        return
      }
      socket = new WebSocket(api.remoteDesktopSessionEventsUrl())
      socket.onopen = () => {
        reconnectDelay = reconnectDelayInitial
        void reconcile()
      }
      socket.onmessage = (message: MessageEvent<string>) => {
        const event = decodeRemoteDesktopSessionEvent(message.data)
        if (!event) {
          void reconcile()
          return
        }
        if (event.type === 'telemetry') {
          const session = sessionsRef.current.get(event.session_id)
          const sampledAt = Date.parse(event.sampled_at)
          if (
            session?.connection_generation === event.connection_generation
            && acceptsTelemetry(session.status)
            && Number.isFinite(sampledAt)
          ) {
            metricsStoreRef.current.publishSshRtt(
              event.session_id,
              event.connection_generation,
              event.ssh_rtt_ms,
              sampledAt,
            )
          }
          return
        }
        // 已按序到达的实时事件比更早启动的 GET 更新，禁止迟到响应回退会话代际或复活已删除会话。
        reconcileRevisionRef.current += 1
        if (event.type === 'snapshot') {
          reconcileSessions(event.sessions)
        } else if (event.type === 'upsert') {
          upsertSession(event.session)
        } else if (event.type === 'removed') {
          removeSession(event.session.id)
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        socket = null
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, reconnectDelayMaximum)
        }
      }
    }

    void reconcile()
    connect()
    return () => {
      disposed = true
      reconcileRevisionRef.current += 1
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [api, enabled, reconcileSessions, removeSession, upsertSession])

  useEffect(() => {
    disposedRef.current = false
    const entries = entriesRef.current
    return () => {
      disposedRef.current = true
      for (const sessionId of entries.keys()) {
        disposeViewer(sessionId, true)
      }
    }
  }, [disposeViewer])

  const ensureViewer = useCallback((sessionId: string) => {
    const session = sessionsRef.current.get(sessionId)
    const entry = entriesRef.current.get(sessionId)
    if (
      !session
      || !entry
      || !entry.viewport
      || entry.adapter
      || entry.attachPromise
      || (session.status !== 'ready' && session.status !== 'reattach_wait')
    ) {
      return
    }
    const profile = profilesRef.current.get(session.profile_id)
    const expectedGeneration = session.connection_generation
    if (
      entry.blockedAttachGeneration === expectedGeneration
      || (
        session.status === 'ready'
        && entry.connectedGeneration === expectedGeneration
      )
    ) {
      return
    }
    commitViewerState(sessionId, { connection: 'loading', errorCode: '' })
    const attach = api.createRemoteDesktopAttachTicket(sessionId, expectedGeneration)
      .then(async (ticket) => {
        const current = entriesRef.current.get(sessionId)
        const latestSession = sessionsRef.current.get(sessionId)
        if (
          disposedRef.current
          || current !== entry
          || latestSession?.connection_generation !== expectedGeneration
          || ticket.connection_generation !== expectedGeneration
          || entry.blockedAttachGeneration === expectedGeneration
          || latestSession.status === 'failed'
          || latestSession.status === 'stopping'
        ) {
          return
        }
        const state = viewerStateSnapshot(viewerStatesRef.current, sessionId, latestSession, profile)
        const adapter = await VncViewerAdapter.create({
          target: entry.container,
          url: api.remoteDesktopStreamUrl(ticket),
          shared: latestSession?.vnc.shared ?? profile?.vnc.shared ?? true,
          viewOnly: state.viewOnly,
          displayMode: state.displayMode,
          credentials: entry.credentials ?? undefined,
          events: {
            onConnected: () => {
              if (isCurrentViewer(entry, expectedGeneration, adapter)) {
                entry.connectedGeneration = expectedGeneration
                entry.blockedAttachGeneration = null
                commitViewerState(sessionId, { connection: 'connected', errorCode: '' })
              }
            },
            onDisconnected: (clean) => {
              if (isCurrentViewer(entry, expectedGeneration, adapter)) {
                const connected = entry.connectedGeneration === expectedGeneration
                adapter.dispose()
                entry.adapter = null
                if (!connected) {
                  entry.blockedAttachGeneration = expectedGeneration
                }
                commitViewerState(sessionId, {
                  connection: 'disconnected',
                  credentialTypes: [],
                  verification: null,
                  errorCode: clean ? '' : 'stream_disconnected',
                })
              }
            },
            onCredentialsRequired: (credentialTypes) => {
              if (isCurrentViewer(entry, expectedGeneration, adapter)) {
                commitViewerState(sessionId, {
                  connection: 'credentials_required',
                  credentialTypes,
                  verification: null,
                })
              }
            },
            onSecurityFailure: (error) => {
              if (isCurrentViewer(entry, expectedGeneration, adapter)) {
                entry.credentials = null
                entry.blockedAttachGeneration = expectedGeneration
                adapter.dispose()
                entry.adapter = null
                commitViewerState(sessionId, {
                  connection: 'security_failed',
                  credentialTypes: [],
                  verification: null,
                  errorCode: error.code,
                })
              }
            },
            onServerVerification: (verification) => {
              if (!isCurrentViewer(entry, expectedGeneration, adapter)) {
                return
              }
              if (entry.acceptedFingerprint && entry.acceptedFingerprint === verification.fingerprint) {
                adapter.approveServer()
                return
              }
              commitViewerState(sessionId, {
                connection: 'verifying_server',
                credentialTypes: [],
                verification,
              })
            },
            onClipboard: (remoteClipboard) => {
              if (isCurrentViewer(entry, expectedGeneration, adapter) && utf8Size(remoteClipboard) <= 256 * 1024) {
                commitViewerState(sessionId, { remoteClipboard })
              }
            },
            onDesktopName: (desktopName) => {
              if (isCurrentViewer(entry, expectedGeneration, adapter)) {
                commitViewerState(sessionId, { desktopName })
              }
            },
            onCapabilities: (capabilities) => {
              if (isCurrentViewer(entry, expectedGeneration, adapter)) {
                commitViewerState(sessionId, { capabilities })
              }
            },
            onMetrics: (metrics) => {
              if (isCurrentViewer(entry, expectedGeneration, adapter)) {
                metricsStoreRef.current.publish(sessionId, expectedGeneration, metrics)
              }
            },
          },
        })
        if (
          disposedRef.current
          || entriesRef.current.get(sessionId) !== entry
          || sessionsRef.current.get(sessionId)?.connection_generation !== expectedGeneration
          || entry.blockedAttachGeneration === expectedGeneration
          || sessionsRef.current.get(sessionId)?.status === 'failed'
          || sessionsRef.current.get(sessionId)?.status === 'stopping'
        ) {
          adapter.dispose()
          return
        }
        entry.adapter = adapter
        commitViewerState(sessionId, { connection: 'connecting' })
      })
      .catch(() => {
        if (
          entriesRef.current.get(sessionId) === entry
          && entry.connectionGeneration === expectedGeneration
          && entry.attachPromise === attach
        ) {
          entry.blockedAttachGeneration = expectedGeneration
          commitViewerState(sessionId, {
            connection: 'disconnected',
            errorCode: 'attach_failed',
          })
        }
      })
      .finally(() => {
        if (
          entriesRef.current.get(sessionId) === entry
          && entry.attachPromise === attach
        ) {
          entry.attachPromise = null
        }
      })
    entry.attachPromise = attach
  }, [api, commitViewerState])

  useEffect(() => {
    for (const session of sessions) {
      ensureViewer(session.id)
    }
  }, [ensureViewer, sessions, viewerStates])

  const createSession = useCallback(async (profileId: string) => {
    const session = await api.createRemoteDesktopSession(profileId)
    upsertSession(session)
    setActiveSessionId(session.id)
    return session
  }, [api, upsertSession])

  const closeSession = useCallback(async (sessionId: string) => {
    await api.deleteRemoteDesktopSession(sessionId)
    disposeViewer(sessionId, true)
    removeSession(sessionId)
  }, [api, disposeViewer, removeSession])

  const reconnectSession = useCallback(async (sessionId: string) => {
    const session = sessionsRef.current.get(sessionId)
    if (!session) {
      return
    }
    const entry = entriesRef.current.get(sessionId)
    metricsStoreRef.current.reset(sessionId)
    if (entry) {
      entry.adapter?.dispose()
      entry.adapter = null
      entry.attachPromise = null
      entry.credentials = null
      entry.blockedAttachGeneration = session.connection_generation
      entry.connectedGeneration = null
    }
    commitViewerState(sessionId, {
      connection: 'idle',
      credentialTypes: [],
      verification: null,
      errorCode: '',
    })
    upsertSession(await api.reconnectRemoteDesktopSession(sessionId, session.connection_generation))
  }, [api, commitViewerState, upsertSession])

  const registerViewport = useCallback((sessionId: string, host: HTMLDivElement) => {
    let entry = entriesRef.current.get(sessionId)
    if (!entry) {
      const container = document.createElement('div')
      container.className = styles.surface
      container.dataset.remoteDesktopViewer = sessionId
      entry = {
        sessionId,
        connectionGeneration: sessionsRef.current.get(sessionId)?.connection_generation ?? 0,
        container,
        viewport: null,
        adapter: null,
        attachPromise: null,
        credentials: null,
        acceptedFingerprint: '',
        blockedAttachGeneration: null,
        connectedGeneration: null,
      }
      entriesRef.current.set(sessionId, entry)
    }
    entry.viewport = host
    host.appendChild(entry.container)
    const currentState = viewerStatesRef.current[sessionId]
    entry.adapter?.setViewportActive(true, currentState?.displayMode ?? 'fit')
    ensureViewer(sessionId)
    return () => {
      const current = entriesRef.current.get(sessionId)
      if (!current || current.viewport !== host) {
        return
      }
      current.viewport = null
      current.adapter?.blur()
      current.adapter?.setViewportActive(false, viewerStatesRef.current[sessionId]?.displayMode ?? 'fit')
      parkingHostRef.current?.appendChild(current.container)
    }
  }, [ensureViewer])

  const setDisplayMode = useCallback((sessionId: string, displayMode: RemoteDesktopDisplayMode) => {
    entriesRef.current.get(sessionId)?.adapter?.setDisplayMode(displayMode)
    commitViewerState(sessionId, { displayMode })
  }, [commitViewerState])

  const setViewOnly = useCallback((sessionId: string, viewOnly: boolean) => {
    entriesRef.current.get(sessionId)?.adapter?.setViewOnly(viewOnly)
    commitViewerState(sessionId, { viewOnly })
  }, [commitViewerState])

  const submitCredentials = useCallback((sessionId: string, credentials: VncCredentials) => {
    const entry = entriesRef.current.get(sessionId)
    if (!entry?.adapter) {
      return
    }
    entry.credentials = { ...credentials }
    entry.adapter.sendCredentials(credentials)
    commitViewerState(sessionId, { connection: 'connecting', credentialTypes: [], errorCode: '' })
  }, [commitViewerState])

  const approveServer = useCallback((sessionId: string) => {
    const entry = entriesRef.current.get(sessionId)
    const verification = viewerStates[sessionId]?.verification
    if (!entry?.adapter || !verification) {
      return
    }
    entry.acceptedFingerprint = verification.fingerprint
    entry.adapter.approveServer()
    commitViewerState(sessionId, { connection: 'connecting', verification: null })
  }, [commitViewerState, viewerStates])

  const rejectServer = useCallback(async (sessionId: string) => {
    const entry = entriesRef.current.get(sessionId)
    if (entry) {
      entry.credentials = null
      entry.acceptedFingerprint = ''
      entry.blockedAttachGeneration = entry.connectionGeneration
      entry.adapter?.dispose()
      entry.adapter = null
    }
    commitViewerState(sessionId, {
      connection: 'security_failed',
      verification: null,
      errorCode: 'server_identity_rejected',
    })
    await api.deleteRemoteDesktopSession(sessionId)
    disposeViewer(sessionId, true)
    removeSession(sessionId)
  }, [api, commitViewerState, disposeViewer, removeSession])

  const value = useMemo(() => ({
    sessions,
    activeSessionId,
    viewerStates,
    selectSession: setActiveSessionId,
    createSession,
    closeSession,
    reconnectSession,
    registerViewport,
    setDisplayMode,
    setViewOnly,
    focusViewer: (sessionId: string) => entriesRef.current.get(sessionId)?.adapter?.focus(),
    blurViewer: (sessionId: string) => entriesRef.current.get(sessionId)?.adapter?.blur(),
    submitCredentials,
    approveServer,
    rejectServer,
    sendCtrlAltDel: (sessionId: string) => entriesRef.current.get(sessionId)?.adapter?.sendCtrlAltDel(),
    sendClipboard: (sessionId: string, text: string) => {
      if (utf8Size(text) > 256 * 1024) {
        throw new Error('REMOTE_DESKTOP_CLIPBOARD_TOO_LARGE')
      }
      entriesRef.current.get(sessionId)?.adapter?.sendClipboard(text)
    },
  }), [
    activeSessionId,
    approveServer,
    closeSession,
    createSession,
    reconnectSession,
    registerViewport,
    rejectServer,
    sessions,
    setDisplayMode,
    setViewOnly,
    submitCredentials,
    viewerStates,
  ])

  return (
    <RemoteDesktopRuntimeContext.Provider value={value}>
      <VncConnectionMetricsContext.Provider value={metricsStoreRef.current}>
        {children}
        <div ref={parkingHostRef} className={styles.parking} aria-hidden="true" />
      </VncConnectionMetricsContext.Provider>
    </RemoteDesktopRuntimeContext.Provider>
  )
}

function viewerStateForSession(
  session?: RemoteDesktopSession,
  profile?: RemoteDesktopProfile,
): VncViewerState {
  return {
    connection: session?.status === 'streaming' ? 'connecting' : 'idle',
    credentialTypes: [],
    verification: null,
    displayMode: session?.vnc.default_display_mode ?? profile?.vnc.default_display_mode ?? 'fit',
    viewOnly: session?.vnc.default_view_only ?? profile?.vnc.default_view_only ?? false,
    desktopName: '',
    remoteClipboard: '',
    capabilities: emptyCapabilities,
    errorCode: '',
  }
}

function viewerStateSnapshot(
  states: Record<string, VncViewerState>,
  sessionId: string,
  session?: RemoteDesktopSession,
  profile?: RemoteDesktopProfile,
) {
  return states[sessionId] ?? viewerStateForSession(session, profile)
}

function sortSessions(sessions: RemoteDesktopSession[]) {
  return [...sessions].sort((left, right) => (
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
  ))
}

function isActiveSession(session: RemoteDesktopSession) {
  return session.status !== 'failed'
}

function isCurrentViewer(entry: ViewerEntry, generation: number, adapter: VncViewerAdapter) {
  return entry.connectionGeneration === generation && entry.adapter === adapter
}

function acceptsTelemetry(status: RemoteDesktopSession['status']) {
  return status === 'ready' || status === 'streaming' || status === 'reattach_wait'
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength
}
