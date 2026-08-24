export interface VncViewerCapabilities {
  power: boolean
}

export type VncViewerErrorCode =
  | 'security_failure'
  | 'server_identity_missing'
  | 'server_identity_unverifiable'

export interface VncTransportMetricsSnapshot {
  connectedAt: number | null
  sampledAt: number
  receivedBytes: number
  sentBytes: number
  receiveBytesPerSecond: number
  sendBytesPerSecond: number
  bufferedAmount: number
  outboundMeasured: boolean
}

export interface VncConnectionMetrics extends VncTransportMetricsSnapshot {
  sshRttMs: number | null
  sshRttSampledAt: number
}

export const emptyVncConnectionMetrics: VncConnectionMetrics = Object.freeze({
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
