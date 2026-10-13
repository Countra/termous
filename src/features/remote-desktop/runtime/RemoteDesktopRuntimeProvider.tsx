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
  sessionId?: string
}

export function RemoteDesktopRuntimeProvider({
  api,
  enabled,
  profiles,
  initialSessions,
  children,
  onSessionCountChange,
  onSessionsChange,
  sessionId,
}: RemoteDesktopRuntimeProviderProps) {
  const [sessions, setSessions] = useState<RemoteDesktopSession[]>([])
  const [hiddenSessionIds, setHiddenSessionIds] = useState<string[]>([])
  const hiddenSessionIdsRef = useRef(new Set<string>())
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [viewerStates, setViewerStates] = useState<Record<string, RemoteDesktopViewerState>>({})
  const sessionsRef = useRef(new Map<string, RemoteDesktopSession>())
  const approvedCertificatesRef = useRef(new Map<string, { generation: number; challengeId: string }>())
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
    const normalized = sortSessions(sessionId ? nextSessions.filter((session) => session.id === sessionId) : nextSessions)
    const previousSessions = sessionsRef.current
    const generationChanged = lifecycleRef.current?.reconcileSessions(
      previousSessions,
      normalized,
    ) ?? new Set<string>()
    sessionsRef.current = new Map(normalized.map((session) => [session.id, session]))
    for (const [id, approved] of approvedCertificatesRef.current) {
      const session = sessionsRef.current.get(id)
      if (!session || session.connection_generation !== approved.generation
        || (session.certificate && session.certificate.challenge_id !== approved.challengeId)) {
        approvedCertificatesRef.current.delete(id)
      }
    }
    const nextIds = new Set(sessionsRef.current.keys())
    hiddenSessionIdsRef.current = new Set([...hiddenSessionIdsRef.current].filter((id) => nextIds.has(id)))
    setHiddenSessionIds([...hiddenSessionIdsRef.current])

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
        // 拒绝决定优先于同一代次的在途快照，直到会话移除或显式重连。
        const rejected = session.protocol === 'rdp' && next[session.id].errorCode === 'server_identity_rejected'
        if (session.status === 'failed' || session.status === 'stopping') {
          next[session.id] = {
            ...next[session.id],
            connection: 'disconnected',
            credentialFields: [],
            verification: null,
            errorCode: rejected ? 'server_identity_rejected' : '',
          }
        }
        const approved = approvedCertificatesRef.current.get(session.id)
        const certificateAccepted = approved?.generation === session.connection_generation
          && approved?.challengeId === session.certificate?.challenge_id
        if (session.protocol === 'rdp' && session.status === 'waiting_host_trust' && session.certificate && !rejected && !certificateAccepted) {
          next[session.id] = { ...next[session.id], connection: 'verifying_server', verification: { type: 'RDP TLS', fingerprint: session.certificate.fingerprint } }
        } else if (session.protocol === 'rdp' && next[session.id].connection === 'verifying_server') {
          next[session.id] = { ...next[session.id], connection: 'connecting', verification: null }
        }
        if (session.protocol === 'rdp' && session.credentials_required && session.status !== 'failed' && session.status !== 'stopping' && !rejected) {
          next[session.id] = { ...next[session.id], connection: 'credentials_required', credentialFields: [{ id: 'password', kind: 'secret', required: true }] }
        } else if (session.protocol === 'rdp' && next[session.id].connection === 'credentials_required') {
          next[session.id] = { ...next[session.id], connection: 'connecting', credentialFields: [] }
        }
      }
      viewerStatesRef.current = next
      return next
    })
    setSessions(normalized)
    setActiveSessionId((current) => (
      current && nextIds.has(current) && !hiddenSessionIdsRef.current.has(current)
        ? current : normalized.find((session) => !hiddenSessionIdsRef.current.has(session.id))?.id ?? null
    ))
  }, [sessionId])

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
      session?.route === 'ssh_tunnel'
      && session.connection_generation === event.connection_generation
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

  const selectSession = useCallback((sessionId: string) => {
    hiddenSessionIdsRef.current.delete(sessionId)
    setHiddenSessionIds([...hiddenSessionIdsRef.current])
    setActiveSessionId(sessionId)
  }, [])

  const closeViewer = useCallback((sessionId: string) => {
    hiddenSessionIdsRef.current.add(sessionId)
    setHiddenSessionIds([...hiddenSessionIdsRef.current])
    lifecycleRef.current?.disposeViewer(sessionId, true)
    setActiveSessionId((current) => current === sessionId
      ? [...sessionsRef.current.values()].find((session) => !hiddenSessionIdsRef.current.has(session.id))?.id ?? null : current)
  }, [])

  const createSession = useCallback(async (profileId: string) => {
    const existing = [...sessionsRef.current.values()].find((s) => s.protocol === 'rdp' && s.profile_id === profileId && s.status !== 'stopping')
    if (existing) { selectSession(existing.id); return existing }
    const session = await apiRef.current.createRemoteDesktopSession(profileId)
    upsertSession(session)
    setActiveSessionId(session.id)
    return session
  }, [selectSession, upsertSession])

  const closeSession = useCallback(async (sessionId: string) => {
    const session = sessionsRef.current.get(sessionId)
    if (!session) return
    await apiRef.current.deleteRemoteDesktopSession(sessionId)
    const current = sessionsRef.current.get(sessionId)
    // 关闭响应仅回收发起请求时的会话，不能清除已进入重连的新生命周期。
    if (current?.connection_generation !== session.connection_generation || current.status === 'reconnecting') return
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

  const reclaimRemoteViewer = useCallback(async (sessionId: string) => {
    const session = sessionsRef.current.get(sessionId)
    if (!session || !apiRef.current.execution) return
    await apiRef.current.execution.reclaim(sessionId, session.connection_generation, false)
    reconcileSessions(await apiRef.current.remoteDesktopSessions())
  }, [reconcileSessions])

  const submitCredentials = useCallback(async (sessionId: string, credentials: RemoteDesktopCredentials) => {
    const session = sessionsRef.current.get(sessionId)
    if (session?.protocol === 'rdp' && session.credentials_required) {
      await apiRef.current.supplyRemoteDesktopCredentials(sessionId, session.connection_generation, credentials.password ?? '')
      setViewerStates((states) => {
        const current = sessionsRef.current.get(sessionId)
        const previous = states[sessionId]
        // 凭据响应不能复活已关闭会话，也不能覆盖新连接或后续证书确认。
        if (current?.connection_generation !== session.connection_generation
          || current.status === 'stopping' || current.status === 'failed' || current.status === 'reconnecting'
          || previous?.connection !== 'credentials_required') return states
        return { ...states, [sessionId]: { ...previous, connection: 'connecting', credentialFields: [] } }
      })
      return
    }
    if (!lifecycleRef.current?.submitCredentials(sessionId, credentials)) {
      return
    }
    commitViewerState(sessionId, {
      connection: 'connecting',
      credentialFields: [],
      errorCode: '',
    })
  }, [commitViewerState])

  const approveServer = useCallback(async (sessionId: string, remember = false) => {
    const session = sessionsRef.current.get(sessionId)
    if (session?.protocol === 'rdp' && session.certificate) {
      const challengeId = session.certificate.challenge_id
      await apiRef.current.resolveRemoteDesktopCertificate(sessionId, session.connection_generation, challengeId, true, remember)
      const current = sessionsRef.current.get(sessionId)
      // 已确认挑战在权威状态推进前仍可能重复到达，只抑制当前代次的同一挑战。
      if (current?.connection_generation !== session.connection_generation
        || current.certificate?.challenge_id !== challengeId
        || current.status !== 'waiting_host_trust') return
      approvedCertificatesRef.current.set(sessionId, {
        generation: session.connection_generation, challengeId,
      })
      setViewerStates((states) => {
        const previous = states[sessionId]
        const latest = sessionsRef.current.get(sessionId)
        // 响应返回期间可能已拒绝连接、进入凭据验证或连接成功，不能覆盖后续状态。
        if (previous?.connection !== 'verifying_server'
          || latest?.connection_generation !== session.connection_generation
          || latest.certificate?.challenge_id !== challengeId
          || latest.status !== 'waiting_host_trust') return states
        return { ...states, [sessionId]: { ...previous, connection: 'connecting', verification: null } }
      })
      return
    }
    const verification = viewerStatesRef.current[sessionId]?.verification
    if (!verification || !lifecycleRef.current?.approveServer(sessionId, verification.fingerprint)) {
      return
    }
    commitViewerState(sessionId, { connection: 'connecting', verification: null })
  }, [commitViewerState])

  const rejectServer = useCallback(async (sessionId: string) => {
    if (!sessionsRef.current.has(sessionId)) return
    lifecycleRef.current?.rejectServer(sessionId)
    commitViewerState(sessionId, {
      connection: 'security_failed',
      verification: null,
      errorCode: 'server_identity_rejected',
    })
    await closeSession(sessionId)
  }, [closeSession, commitViewerState])

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
    automation: api.automation,
    desktopFiles: api.desktopFiles,
    sessions,
    hiddenSessionIds,
    closeViewer,
    activeSessionId,
    viewerStates,
    selectSession,
    createSession,
    closeSession,
    reconnectSession,
    registerViewport,
    setDisplayMode,
    setViewOnly,
    reclaimRemoteViewer,
    focusViewer,
    blurViewer,
    submitCredentials,
    approveServer,
    rejectServer,
    sendCtrlAltDel,
    sendClipboard,
  }), [
    api.desktopFiles,
    api.automation,
    hiddenSessionIds,
    closeViewer,
    selectSession,
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
    reclaimRemoteViewer,
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
