import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopDisplayMode,
  RemoteDesktopSession,
  RemoteDesktopTelemetryEvent,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '../api/remoteDesktopGateway.ts'
import { shouldAcceptSessionSnapshot } from '../model/sessionSnapshot.ts'
import {
  RemoteDesktopConnectionMetricsContext,
  RemoteDesktopConnectionMetricsStore,
} from './core/connectionMetricsStore.tsx'
import {
  RemoteDesktopRuntimeContext,
} from './core/remoteDesktopRuntimeContext.ts'
import { useRemoteDesktopSessionFeed } from './core/useRemoteDesktopSessionFeed.ts'
import type {
  RemoteDesktopCredentials,
  RemoteDesktopViewerState,
} from './core/viewerContracts.ts'
import { RemoteDesktopViewerLifecycle } from './core/viewerLifecycle.ts'
import { resolveRemoteDesktopSessionDrivers } from './core/sessionDriverResolver.ts'
import {
  remoteDesktopProtocolRegistry,
  remoteDesktopRouteRegistry,
} from './registry.ts'
import styles from './RemoteDesktopRuntimeProvider.module.scss'

interface RemoteDesktopRuntimeProviderProps {
  api: RemoteDesktopGateway
  enabled: boolean
  profiles: RemoteDesktopAccessProfile[]
  initialSessions: RemoteDesktopSession[]
  children: ReactNode
  onSessionCountChange?: (count: number) => void
  onSessionsChange?: (sessions: RemoteDesktopSession[]) => void
}

export function RemoteDesktopRuntimeProvider({
  api,
  enabled,
  profiles,
  initialSessions,
  children,
  onSessionCountChange,
  onSessionsChange,
}: RemoteDesktopRuntimeProviderProps) {
  const [sessions, setSessions] = useState<RemoteDesktopSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [viewerStates, setViewerStates] = useState<Record<string, RemoteDesktopViewerState>>({})
  const sessionsRef = useRef(new Map<string, RemoteDesktopSession>())
  const profilesRef = useRef(new Map<string, RemoteDesktopAccessProfile>())
  const viewerStatesRef = useRef(viewerStates)
  const initialSessionsRef = useRef(initialSessions)
  const apiRef = useRef(api)
  const metricsStoreRef = useRef(new RemoteDesktopConnectionMetricsStore())
  const lifecycleRef = useRef<RemoteDesktopViewerLifecycle | null>(null)

  apiRef.current = api
  initialSessionsRef.current = initialSessions
  profilesRef.current = indexProfiles(profiles)
  viewerStatesRef.current = viewerStates

  const commitViewerState = useCallback((
    sessionId: string,
    patch: Partial<RemoteDesktopViewerState>,
  ) => {
    setViewerStates((current) => {
      const session = sessionsRef.current.get(sessionId)
      const previous = current[sessionId] ?? viewerStateForSession(
        session,
        profilesRef.current.get(session?.profile_id ?? ''),
      )
      return { ...current, [sessionId]: { ...previous, ...patch } }
    })
  }, [])

  if (!lifecycleRef.current) {
    lifecycleRef.current = new RemoteDesktopViewerLifecycle({
      api: () => apiRef.current,
      protocolRegistry: remoteDesktopProtocolRegistry,
      routeRegistry: remoteDesktopRouteRegistry,
      metrics: metricsStoreRef.current,
      surfaceClassName: styles.surface,
      session: (sessionId) => sessionsRef.current.get(sessionId),
      profile: (profileId) => profilesRef.current.get(profileId),
      viewerState: (sessionId) => viewerStatesRef.current[sessionId],
      commitViewerState,
    })
  }

  const reconcileSessions = useCallback((nextSessions: RemoteDesktopSession[]) => {
    const normalized = sortSessions(nextSessions)
    const previousSessions = sessionsRef.current
    const generationChanged = lifecycleRef.current?.reconcileSessions(
      previousSessions,
      normalized,
    ) ?? new Set<string>()
    sessionsRef.current = new Map(normalized.map((session) => [session.id, session]))
    const nextIds = new Set(sessionsRef.current.keys())

    setViewerStates((current) => {
      const next: Record<string, RemoteDesktopViewerState> = {}
      for (const session of normalized) {
        const initial = viewerStateForSession(
          session,
          profilesRef.current.get(session.profile_id),
        )
        const previous = current[session.id]
        next[session.id] = previous ?? initial
        if (generationChanged.has(session.id)) {
          next[session.id] = {
            ...next[session.id],
            connection: 'idle',
            credentialFields: [],
            verification: null,
            desktopName: '',
            remoteClipboard: '',
            capabilities: { power: false },
            targetLabel: initial.targetLabel,
            errorCode: '',
          }
        }
        if (session.status === 'failed') {
          next[session.id] = {
            ...next[session.id],
            connection: 'disconnected',
            credentialFields: [],
            verification: null,
            errorCode: '',
          }
        }
      }
      viewerStatesRef.current = next
      return next
    })
    setSessions(normalized)
    setActiveSessionId((current) => (
      current && nextIds.has(current) ? current : normalized[0]?.id ?? null
    ))
  }, [])

  const upsertSession = useCallback((next: RemoteDesktopSession) => {
    if (!shouldAcceptSessionSnapshot(sessionsRef.current.get(next.id), next)) {
      return
    }
    reconcileSessions([
      ...[...sessionsRef.current.values()].filter((session) => session.id !== next.id),
      next,
    ])
  }, [reconcileSessions])

  const removeSession = useCallback((sessionId: string) => {
    reconcileSessions(
      [...sessionsRef.current.values()].filter((session) => session.id !== sessionId),
    )
  }, [reconcileSessions])

  const initialSessionSnapshot = useCallback(() => initialSessionsRef.current, [])
  const handleTelemetry = useCallback((event: RemoteDesktopTelemetryEvent) => {
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
  }, [])

  useRemoteDesktopSessionFeed({
    api,
    enabled,
    initialSessions: initialSessionSnapshot,
    onSnapshot: reconcileSessions,
    onUpsert: upsertSession,
    onRemove: removeSession,
    onTelemetry: handleTelemetry,
  })

  useEffect(() => {
    const lifecycle = lifecycleRef.current
    const metrics = metricsStoreRef.current
    lifecycle?.activate()
    return () => {
      lifecycle?.disposeAll()
      metrics.clear()
    }
  }, [])

  useEffect(() => {
    for (const session of sessions) {
      lifecycleRef.current?.ensureViewer(session.id)
    }
  }, [sessions, viewerStates])

  useEffect(() => {
    onSessionCountChange?.(sessions.filter(isActiveSession).length)
    onSessionsChange?.(sessions)
  }, [onSessionCountChange, onSessionsChange, sessions])

  const createSession = useCallback(async (profileId: string) => {
    const session = await apiRef.current.createRemoteDesktopSession(profileId)
    upsertSession(session)
    setActiveSessionId(session.id)
    return session
  }, [upsertSession])

  const closeSession = useCallback(async (sessionId: string) => {
    await apiRef.current.deleteRemoteDesktopSession(sessionId)
    lifecycleRef.current?.disposeViewer(sessionId, true)
    removeSession(sessionId)
  }, [removeSession])

  const reconnectSession = useCallback(async (sessionId: string) => {
    const session = sessionsRef.current.get(sessionId)
    if (!session) {
      return
    }
    lifecycleRef.current?.resetForReconnect(sessionId, session.connection_generation)
    commitViewerState(sessionId, {
      connection: 'idle',
      credentialFields: [],
      verification: null,
      errorCode: '',
    })
    upsertSession(await apiRef.current.reconnectRemoteDesktopSession(
      sessionId,
      session.connection_generation,
    ))
  }, [commitViewerState, upsertSession])

  const registerViewport = useCallback((sessionId: string, host: HTMLDivElement) => (
    lifecycleRef.current?.registerViewport(sessionId, host) ?? (() => undefined)
  ), [])

  const setParkingHost = useCallback((host: HTMLDivElement | null) => {
    lifecycleRef.current?.setParkingHost(host)
  }, [])

  const setDisplayMode = useCallback((sessionId: string, displayMode: RemoteDesktopDisplayMode) => {
    lifecycleRef.current?.setDisplayMode(sessionId, displayMode)
    commitViewerState(sessionId, { displayMode })
  }, [commitViewerState])

  const setViewOnly = useCallback((sessionId: string, viewOnly: boolean) => {
    lifecycleRef.current?.setViewOnly(sessionId, viewOnly)
    commitViewerState(sessionId, { viewOnly })
  }, [commitViewerState])

  const submitCredentials = useCallback((sessionId: string, credentials: RemoteDesktopCredentials) => {
    if (!lifecycleRef.current?.submitCredentials(sessionId, credentials)) {
      return
    }
    commitViewerState(sessionId, {
      connection: 'connecting',
      credentialFields: [],
      errorCode: '',
    })
  }, [commitViewerState])

  const approveServer = useCallback((sessionId: string) => {
    const verification = viewerStatesRef.current[sessionId]?.verification
    if (!verification || !lifecycleRef.current?.approveServer(sessionId, verification.fingerprint)) {
      return
    }
    commitViewerState(sessionId, { connection: 'connecting', verification: null })
  }, [commitViewerState])

  const rejectServer = useCallback(async (sessionId: string) => {
    lifecycleRef.current?.rejectServer(sessionId)
    commitViewerState(sessionId, {
      connection: 'security_failed',
      verification: null,
      errorCode: 'server_identity_rejected',
    })
    await apiRef.current.deleteRemoteDesktopSession(sessionId)
    lifecycleRef.current?.disposeViewer(sessionId, true)
    removeSession(sessionId)
  }, [commitViewerState, removeSession])

  const focusViewer = useCallback((sessionId: string) => {
    lifecycleRef.current?.focus(sessionId)
  }, [])
  const blurViewer = useCallback((sessionId: string) => {
    lifecycleRef.current?.blur(sessionId)
  }, [])
  const sendCtrlAltDel = useCallback((sessionId: string) => {
    lifecycleRef.current?.sendCtrlAltDel(sessionId)
  }, [])
  const sendClipboard = useCallback((sessionId: string, text: string) => {
    if (utf8Size(text) > 256 * 1024) {
      throw new Error('REMOTE_DESKTOP_CLIPBOARD_TOO_LARGE')
    }
    lifecycleRef.current?.sendClipboard(sessionId, text)
  }, [])

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
    focusViewer,
    blurViewer,
    submitCredentials,
    approveServer,
    rejectServer,
    sendCtrlAltDel,
    sendClipboard,
  }), [
    activeSessionId,
    approveServer,
    blurViewer,
    closeSession,
    createSession,
    focusViewer,
    reconnectSession,
    registerViewport,
    rejectServer,
    sendClipboard,
    sendCtrlAltDel,
    sessions,
    setDisplayMode,
    setViewOnly,
    submitCredentials,
    viewerStates,
  ])

  return (
    <RemoteDesktopRuntimeContext.Provider value={value}>
      <RemoteDesktopConnectionMetricsContext.Provider value={metricsStoreRef.current}>
        {children}
        <div ref={setParkingHost} className={styles.parking} aria-hidden="true" />
      </RemoteDesktopConnectionMetricsContext.Provider>
    </RemoteDesktopRuntimeContext.Provider>
  )
}

function indexProfiles(profiles: RemoteDesktopAccessProfile[]) {
  const result = new Map<string, RemoteDesktopAccessProfile>()
  for (const profile of profiles) {
    if (result.has(profile.id)) {
      throw new Error('REMOTE_DESKTOP_PROFILE_DUPLICATE')
    }
    remoteDesktopRouteRegistry.resolve(profile.route, profile.route_config_version)
    remoteDesktopProtocolRegistry.resolve(profile.protocol, profile.protocol_config_version)
    result.set(profile.id, profile)
  }
  return result
}

function viewerStateForSession(
  session?: RemoteDesktopSession,
  profile?: RemoteDesktopAccessProfile,
): RemoteDesktopViewerState {
  if (!session) {
    return {
      connection: 'idle',
      credentialFields: [],
      verification: null,
      displayMode: 'fit',
      viewOnly: false,
      desktopName: '',
      remoteClipboard: '',
      capabilities: { power: false },
      targetLabel: '',
      errorCode: '',
    }
  }
  return resolveRemoteDesktopSessionDrivers(
    session,
    remoteDesktopRouteRegistry,
    remoteDesktopProtocolRegistry,
  ).protocol
    .initialViewerState(session, profile)
}

function sortSessions(sessions: RemoteDesktopSession[]) {
  return [...sessions].sort((left, right) => (
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
  ))
}

function isActiveSession(session: RemoteDesktopSession) {
  return session.status !== 'failed'
}

function acceptsTelemetry(status: RemoteDesktopSession['status']) {
  return status === 'ready' || status === 'streaming' || status === 'reattach_wait'
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength
}
