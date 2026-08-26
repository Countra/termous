import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopDisplayMode,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import type { RemoteDesktopGateway } from '../../api/remoteDesktopGateway.ts'
import type { RemoteDesktopConnectionMetricsStore } from './connectionMetricsStore.tsx'
import type { RemoteDesktopProtocolRegistry } from './protocolRegistry.ts'
import type { RemoteDesktopRouteRegistry } from './routeRegistry.ts'
import { resolveRemoteDesktopSessionDrivers } from './sessionDriverResolver.ts'
import { RemoteDesktopTargetAuthController } from './targetAuthController.ts'
import type {
  RemoteDesktopCredentials,
  RemoteDesktopViewerHandle,
  RemoteDesktopViewerState,
} from './viewerContracts.ts'

interface ViewerEntry {
  sessionId: string
  connectionGeneration: number
  container: HTMLDivElement
  viewport: HTMLDivElement | null
  viewer: RemoteDesktopViewerHandle | null
  attachPromise: Promise<void> | null
  credentials: RemoteDesktopCredentials | null
  targetAuth: RemoteDesktopTargetAuthController
  acceptedFingerprint: string
  blockedAttachGeneration: number | null
  connectedGeneration: number | null
  automaticCredentialGeneration: number | null
  savedCredentialRejected: boolean
}

interface RemoteDesktopViewerLifecycleOptions {
  api: () => Pick<
    RemoteDesktopGateway,
    | 'createRemoteDesktopAttachTicket'
    | 'consumeRemoteDesktopTargetAuth'
    | 'remoteDesktopStreamUrl'
  >
  protocolRegistry: RemoteDesktopProtocolRegistry
  routeRegistry: RemoteDesktopRouteRegistry
  metrics: RemoteDesktopConnectionMetricsStore
  surfaceClassName: string
  session: (sessionId: string) => RemoteDesktopSession | undefined
  profile: (profileId: string) => RemoteDesktopAccessProfile | undefined
  viewerState: (sessionId: string) => RemoteDesktopViewerState | undefined
  commitViewerState: (sessionId: string, patch: Partial<RemoteDesktopViewerState>) => void
}

export class RemoteDesktopViewerLifecycle {
  private readonly entries = new Map<string, ViewerEntry>()
  private parkingHost: HTMLDivElement | null = null
  private disposed = false

  constructor(private readonly options: RemoteDesktopViewerLifecycleOptions) {}

  activate() {
    this.disposed = false
  }

  setParkingHost(host: HTMLDivElement | null) {
    this.parkingHost = host
  }

  reconcileSessions(
    previousSessions: ReadonlyMap<string, RemoteDesktopSession>,
    nextSessions: RemoteDesktopSession[],
  ) {
    const generationChanged = new Set<string>()
    const nextIds = new Set(nextSessions.map((session) => session.id))
    for (const session of nextSessions) {
      this.options.metrics.activateGeneration(session.id, session.connection_generation)
    }
    for (const sessionId of previousSessions.keys()) {
      if (!nextIds.has(sessionId)) {
        this.options.metrics.remove(sessionId)
      }
    }
    for (const sessionId of this.entries.keys()) {
      if (!nextIds.has(sessionId)) {
        this.disposeViewer(sessionId, true)
      }
    }
    for (const session of nextSessions) {
      const previous = previousSessions.get(session.id)
      const entry = this.entries.get(session.id)
      if (
        !previous
        || (
          previous.connection_generation === session.connection_generation
          && hasSameDriverIdentity(previous, session)
        )
      ) {
        continue
      }
      generationChanged.add(session.id)
      if (!entry) {
        continue
      }
      entry.viewer?.dispose()
      entry.viewer = null
      entry.attachPromise = null
      entry.targetAuth.clear()
      if (!hasSameDriverIdentity(previous, session)) {
        entry.credentials = null
        entry.acceptedFingerprint = ''
        entry.savedCredentialRejected = false
      }
      entry.connectionGeneration = session.connection_generation
      entry.blockedAttachGeneration = null
      entry.connectedGeneration = null
      entry.automaticCredentialGeneration = null
    }
    for (const session of nextSessions) {
      if (!acceptsTelemetry(session.status)) {
        this.options.metrics.reset(session.id)
      }
      if (session.status !== 'failed') {
        continue
      }
      const entry = this.entries.get(session.id)
      if (!entry) {
        continue
      }
      entry.viewer?.dispose()
      entry.viewer = null
      entry.attachPromise = null
      entry.credentials = null
      entry.targetAuth.clear()
      entry.acceptedFingerprint = ''
      entry.automaticCredentialGeneration = null
      entry.blockedAttachGeneration = session.connection_generation
      entry.connectedGeneration = null
    }
    return generationChanged
  }

  ensureViewer(sessionId: string) {
    const session = this.options.session(sessionId)
    const entry = this.entries.get(sessionId)
    if (!session || !entry || !this.canStartAttach(session, entry)) {
      return
    }
    const expectedGeneration = session.connection_generation
    this.options.commitViewerState(sessionId, { connection: 'loading', errorCode: '' })
    const attach = this.attachViewer(entry, session, expectedGeneration)
      .catch(() => {
        if (
          this.entries.get(sessionId) === entry
          && entry.connectionGeneration === expectedGeneration
          && entry.attachPromise === attach
        ) {
          entry.targetAuth.clear()
          entry.blockedAttachGeneration = expectedGeneration
          this.options.commitViewerState(sessionId, {
            connection: 'disconnected',
            errorCode: 'attach_failed',
          })
        }
      })
      .finally(() => {
        if (this.entries.get(sessionId) === entry && entry.attachPromise === attach) {
          entry.attachPromise = null
        }
      })
    entry.attachPromise = attach
  }

  registerViewport(sessionId: string, host: HTMLDivElement) {
    const session = this.options.session(sessionId)
    if (!session) {
      return () => undefined
    }
    let entry = this.entries.get(sessionId)
    if (!entry) {
      const container = document.createElement('div')
      container.className = this.options.surfaceClassName
      container.dataset.remoteDesktopViewer = sessionId
      entry = {
        sessionId,
        connectionGeneration: session.connection_generation,
        container,
        viewport: null,
        viewer: null,
        attachPromise: null,
        credentials: null,
        targetAuth: new RemoteDesktopTargetAuthController(),
        acceptedFingerprint: '',
        blockedAttachGeneration: null,
        connectedGeneration: null,
        automaticCredentialGeneration: null,
        savedCredentialRejected: false,
      }
      this.entries.set(sessionId, entry)
    }
    entry.viewport = host
    host.appendChild(entry.container)
    const currentState = this.options.viewerState(sessionId)
    entry.viewer?.setViewportActive(true, currentState?.displayMode ?? 'fit')
    this.ensureViewer(sessionId)
    return () => {
      const current = this.entries.get(sessionId)
      if (!current || current.viewport !== host) {
        return
      }
      current.viewport = null
      current.viewer?.blur()
      current.viewer?.setViewportActive(
        false,
        this.options.viewerState(sessionId)?.displayMode ?? 'fit',
      )
      this.parkingHost?.appendChild(current.container)
    }
  }

  disposeViewer(sessionId: string, clearCredentials: boolean) {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      this.options.metrics.reset(sessionId)
      return
    }
    entry.viewer?.dispose()
    entry.viewer = null
    entry.attachPromise = null
    entry.targetAuth.clear()
    if (clearCredentials) {
      entry.credentials = null
      entry.acceptedFingerprint = ''
      entry.savedCredentialRejected = false
    }
    entry.container.remove()
    this.entries.delete(sessionId)
    this.options.metrics.reset(sessionId)
  }

  disposeAll() {
    this.disposed = true
    for (const sessionId of [...this.entries.keys()]) {
      this.disposeViewer(sessionId, true)
    }
  }

  resetForReconnect(sessionId: string, generation: number) {
    this.options.metrics.reset(sessionId)
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    entry.viewer?.dispose()
    entry.viewer = null
    entry.attachPromise = null
    entry.targetAuth.clear()
    entry.blockedAttachGeneration = generation
    entry.connectedGeneration = null
    entry.automaticCredentialGeneration = null
  }

  setDisplayMode(sessionId: string, mode: RemoteDesktopDisplayMode) {
    this.entries.get(sessionId)?.viewer?.setDisplayMode(mode)
  }

  setViewOnly(sessionId: string, value: boolean) {
    this.entries.get(sessionId)?.viewer?.setViewOnly(value)
  }

  focus(sessionId: string) {
    this.entries.get(sessionId)?.viewer?.focus()
  }

  blur(sessionId: string) {
    this.entries.get(sessionId)?.viewer?.blur()
  }

  submitCredentials(sessionId: string, credentials: RemoteDesktopCredentials) {
    const entry = this.entries.get(sessionId)
    if (!entry?.viewer) {
      return false
    }
    entry.credentials = { ...credentials }
    entry.automaticCredentialGeneration = null
    entry.viewer.sendCredentials(credentials)
    return true
  }

  approveServer(sessionId: string, fingerprint: string) {
    const entry = this.entries.get(sessionId)
    if (!entry?.viewer || !fingerprint) {
      return false
    }
    entry.acceptedFingerprint = fingerprint
    entry.viewer.approveServer()
    return true
  }

  rejectServer(sessionId: string) {
    const entry = this.entries.get(sessionId)
    if (!entry) {
      return
    }
    entry.credentials = null
    entry.targetAuth.clear()
    entry.acceptedFingerprint = ''
    entry.automaticCredentialGeneration = null
    entry.blockedAttachGeneration = entry.connectionGeneration
    entry.viewer?.dispose()
    entry.viewer = null
  }

  sendCtrlAltDel(sessionId: string) {
    this.entries.get(sessionId)?.viewer?.sendCtrlAltDel()
  }

  sendClipboard(sessionId: string, text: string) {
    this.entries.get(sessionId)?.viewer?.sendClipboard(text)
  }

  private async attachViewer(
    entry: ViewerEntry,
    session: RemoteDesktopSession,
    expectedGeneration: number,
  ) {
    const profile = this.options.profile(session.profile_id)
    const { protocol: driver } = resolveRemoteDesktopSessionDrivers(
      session,
      this.options.routeRegistry,
      this.options.protocolRegistry,
    )
    // 先完成协议模块加载，再申请短时 Ticket，避免冷加载消耗有效期。
    await driver.prepare()
    if (!this.isCurrentAttach(entry, expectedGeneration)) {
      return
    }
    const api = this.options.api()
    const ticket = await api.createRemoteDesktopAttachTicket(entry.sessionId, expectedGeneration)
    if (
      ticket.connection_generation !== expectedGeneration
      || !this.isCurrentAttach(entry, expectedGeneration)
    ) {
      return
    }
    const latestSession = this.options.session(entry.sessionId)
    if (!latestSession) {
      return
    }
    const state = this.options.viewerState(entry.sessionId)
      ?? driver.initialViewerState(latestSession, profile)
    entry.targetAuth.reset(entry.savedCredentialRejected ? '' : ticket.credential_ticket)
    let viewer: RemoteDesktopViewerHandle | null = null
    viewer = await driver.createViewer({
      target: entry.container,
      url: api.remoteDesktopStreamUrl(ticket),
      session: latestSession,
      profile,
      state,
      credentials: entry.credentials ?? undefined,
      events: {
        onConnected: () => {
          if (viewer && this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            entry.connectedGeneration = expectedGeneration
            entry.blockedAttachGeneration = null
            entry.automaticCredentialGeneration = null
            this.options.commitViewerState(entry.sessionId, {
              connection: 'connected',
              errorCode: '',
            })
          }
        },
        onDisconnected: (clean) => {
          if (!viewer || !this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            return
          }
          const connected = entry.connectedGeneration === expectedGeneration
          entry.targetAuth.clear()
          entry.automaticCredentialGeneration = null
          viewer.dispose()
          entry.viewer = null
          if (!connected) {
            entry.blockedAttachGeneration = expectedGeneration
          }
          this.options.commitViewerState(entry.sessionId, {
            connection: 'disconnected',
            credentialFields: [],
            verification: null,
            errorCode: clean ? '' : 'stream_disconnected',
          })
        },
        onCredentialsRequired: (credentialFields) => {
          if (!viewer || !this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            return
          }
          void entry.targetAuth.handleRequest({
            fields: credentialFields,
            consume: (credentialTicket) => this.options.api().consumeRemoteDesktopTargetAuth(
              entry.sessionId,
              expectedGeneration,
              credentialTicket,
            ),
            isCurrent: () => Boolean(
              viewer && this.isCurrentViewer(entry, expectedGeneration, viewer),
            ),
            submit: (credentials) => {
              entry.automaticCredentialGeneration = expectedGeneration
              this.options.commitViewerState(entry.sessionId, {
                connection: 'connecting',
                credentialFields: [],
                verification: null,
              })
              viewer?.sendCredentials(credentials)
            },
            fallback: () => this.showCredentialPrompt(entry.sessionId, credentialFields),
          })
        },
        onSecurityFailure: (error) => {
          if (!viewer || !this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            return
          }
          entry.credentials = null
          entry.targetAuth.clear()
          if (entry.automaticCredentialGeneration === expectedGeneration) {
            // 保存凭据被服务端拒绝后，本会话后续重连改由用户手工认证，避免重复提交错误秘密。
            entry.savedCredentialRejected = true
          }
          entry.automaticCredentialGeneration = null
          entry.blockedAttachGeneration = expectedGeneration
          viewer.dispose()
          entry.viewer = null
          this.options.commitViewerState(entry.sessionId, {
            connection: 'security_failed',
            credentialFields: [],
            verification: null,
            errorCode: error.code,
          })
        },
        onServerVerification: (verification) => {
          if (!viewer || !this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            return
          }
          if (entry.acceptedFingerprint === verification.fingerprint) {
            viewer.approveServer()
            return
          }
          this.options.commitViewerState(entry.sessionId, {
            connection: 'verifying_server',
            credentialFields: [],
            verification,
          })
        },
        onClipboard: (remoteClipboard) => {
          if (
            viewer
            && this.isCurrentViewer(entry, expectedGeneration, viewer)
            && utf8Size(remoteClipboard) <= 256 * 1024
          ) {
            this.options.commitViewerState(entry.sessionId, { remoteClipboard })
          }
        },
        onDesktopName: (desktopName) => {
          if (viewer && this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            this.options.commitViewerState(entry.sessionId, { desktopName })
          }
        },
        onCapabilities: (capabilities) => {
          if (viewer && this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            this.options.commitViewerState(entry.sessionId, { capabilities })
          }
        },
        onMetrics: (metrics) => {
          if (viewer && this.isCurrentViewer(entry, expectedGeneration, viewer)) {
            this.options.metrics.publish(entry.sessionId, expectedGeneration, metrics)
          }
        },
      },
    })
    if (!this.isCurrentAttach(entry, expectedGeneration)) {
      if (entry.connectionGeneration === expectedGeneration) {
        entry.targetAuth.clear()
      }
      viewer.dispose()
      return
    }
    entry.viewer = viewer
    this.options.commitViewerState(entry.sessionId, { connection: 'connecting' })
  }

  private showCredentialPrompt(
    sessionId: string,
    credentialFields: RemoteDesktopViewerState['credentialFields'],
  ) {
    this.options.commitViewerState(sessionId, {
      connection: 'credentials_required',
      credentialFields,
      verification: null,
    })
  }

  private canStartAttach(session: RemoteDesktopSession, entry: ViewerEntry) {
    return Boolean(
      entry.viewport
      && !entry.viewer
      && !entry.attachPromise
      && (session.status === 'ready' || session.status === 'reattach_wait')
      && entry.blockedAttachGeneration !== session.connection_generation
      && !(
        session.status === 'ready'
        && entry.connectedGeneration === session.connection_generation
      ),
    )
  }

  private isCurrentAttach(entry: ViewerEntry, generation: number) {
    const session = this.options.session(entry.sessionId)
    return !this.disposed
      && this.entries.get(entry.sessionId) === entry
      && entry.connectionGeneration === generation
      && entry.blockedAttachGeneration !== generation
      && session?.connection_generation === generation
      && session.status !== 'failed'
      && session.status !== 'stopping'
  }

  private isCurrentViewer(
    entry: ViewerEntry,
    generation: number,
    viewer: RemoteDesktopViewerHandle,
  ) {
    const session = this.options.session(entry.sessionId)
    return !this.disposed
      && entry.connectionGeneration === generation
      && entry.viewer === viewer
      && session?.connection_generation === generation
      && session.status !== 'failed'
      && session.status !== 'stopping'
  }
}

function acceptsTelemetry(status: RemoteDesktopSession['status']) {
  return status === 'ready' || status === 'streaming' || status === 'reattach_wait'
}

function hasSameDriverIdentity(left: RemoteDesktopSession, right: RemoteDesktopSession) {
  return left.route === right.route
    && left.route_config_version === right.route_config_version
    && left.protocol === right.protocol
    && left.protocol_config_version === right.protocol_config_version
}

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength
}
