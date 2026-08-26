import type {
  RemoteDesktopAccessProfile,
  RemoteDesktopDisplayMode,
  RemoteDesktopProtocol,
  RemoteDesktopSession,
} from '#entities/remote-desktop'

export type RemoteDesktopViewerConnectionState =
  | 'idle'
  | 'loading'
  | 'connecting'
  | 'credentials_required'
  | 'verifying_server'
  | 'connected'
  | 'disconnected'
  | 'security_failed'

export interface RemoteDesktopCredentialField {
  id: string
  kind: 'text' | 'secret'
  required: boolean
}

export type RemoteDesktopCredentials = Record<string, string>

export interface RemoteDesktopViewerCapabilities {
  power: boolean
}

export type RemoteDesktopViewerErrorCode =
  | 'security_failure'
  | 'server_identity_missing'
  | 'server_identity_unverifiable'
  | 'server_identity_rejected'
  | 'stream_disconnected'
  | 'attach_failed'
  | ''

export interface RemoteDesktopViewerState {
  connection: RemoteDesktopViewerConnectionState
  credentialFields: RemoteDesktopCredentialField[]
  verification: { type: string; fingerprint: string } | null
  displayMode: RemoteDesktopDisplayMode
  viewOnly: boolean
  desktopName: string
  remoteClipboard: string
  capabilities: RemoteDesktopViewerCapabilities
  targetLabel: string
  errorCode: RemoteDesktopViewerErrorCode
}

export interface RemoteDesktopTransportMetricsSnapshot {
  connectedAt: number | null
  sampledAt: number
  receivedBytes: number
  sentBytes: number
  receiveBytesPerSecond: number
  sendBytesPerSecond: number
  bufferedAmount: number
  outboundMeasured: boolean
}

export interface RemoteDesktopConnectionMetrics extends RemoteDesktopTransportMetricsSnapshot {
  sshRttMs: number | null
  sshRttSampledAt: number
}

export const emptyRemoteDesktopConnectionMetrics: RemoteDesktopConnectionMetrics = Object.freeze({
  connectedAt: null,
  sampledAt: 0,
  receivedBytes: 0,
  sentBytes: 0,
  receiveBytesPerSecond: 0,
  sendBytesPerSecond: 0,
  bufferedAmount: 0,
  outboundMeasured: false,
  sshRttMs: null,
  sshRttSampledAt: 0,
})

export const emptyRemoteDesktopViewerState: RemoteDesktopViewerState = Object.freeze({
  connection: 'idle',
  credentialFields: [],
  verification: null,
  displayMode: 'fit',
  viewOnly: false,
  desktopName: '',
  remoteClipboard: '',
  capabilities: Object.freeze({ power: false }),
  targetLabel: '',
  errorCode: '',
})

export interface RemoteDesktopViewerEvents {
  onConnected: () => void
  onDisconnected: (clean: boolean) => void
  onCredentialsRequired: (fields: RemoteDesktopCredentialField[]) => void
  onSecurityFailure: (error: { code: RemoteDesktopViewerErrorCode; detail?: string }) => void
  onServerVerification: (verification: { type: string; fingerprint: string }) => void
  onClipboard: (text: string) => void
  onDesktopName: (name: string) => void
  onCapabilities: (capabilities: RemoteDesktopViewerCapabilities) => void
  onMetrics: (metrics: RemoteDesktopTransportMetricsSnapshot) => void
}

export interface RemoteDesktopViewerHandle {
  dispose: () => void
  setDisplayMode: (mode: RemoteDesktopDisplayMode) => void
  setViewOnly: (value: boolean) => void
  setViewportActive: (active: boolean, mode: RemoteDesktopDisplayMode) => void
  focus: () => void
  blur: () => void
  sendCredentials: (credentials: RemoteDesktopCredentials) => void
  approveServer: () => void
  sendCtrlAltDel: () => void
  sendClipboard: (text: string) => void
}

export interface RemoteDesktopViewerCreateOptions {
  target: HTMLElement
  url: string
  session: RemoteDesktopSession
  profile?: RemoteDesktopAccessProfile
  state: RemoteDesktopViewerState
  credentials?: RemoteDesktopCredentials
  events: RemoteDesktopViewerEvents
}

export interface RemoteDesktopProtocolDriver {
  readonly id: RemoteDesktopProtocol
  readonly configVersion: number
  prepare: () => Promise<void>
  initialViewerState: (
    session: RemoteDesktopSession,
    profile?: RemoteDesktopAccessProfile,
  ) => RemoteDesktopViewerState
  createViewer: (
    options: RemoteDesktopViewerCreateOptions,
  ) => Promise<RemoteDesktopViewerHandle>
}
