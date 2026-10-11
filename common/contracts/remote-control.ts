import type { JsonValue } from '@bufbuild/protobuf'
import type { AppLanguage, AppTheme } from './application'
import type { NotificationTarget } from './notification'

export interface RemoteConnection {
  id: string
  state: string
  scope: { connection_id: string; generation: string; controller_id: string; host_id: string }
  lease_expires_at: string
  stats: {
    state: string; path: string; protocol: string; encryption: string
    ip_version?: string; local_candidate?: string; remote_candidate?: string; relay_protocol?: string
    rtt_ms: number; bytes_sent: number; bytes_received: number
    send_bytes_per_second?: number; receive_bytes_per_second?: number
  }
}
export interface RemoteDevice {
  id: string; name: string; trust: string; online: string
  advertisement: { protocol: string; host_enabled: boolean; platform: string; policy_revision: string }
}
export interface RemotePolicy {
  revision: number; enabled: boolean
  agent_enabled?: boolean
  hosts: { id: string; connections?: { id: string; kind: string }[] }[]
  directories: { id: string; name: string; path: string; read: boolean; write: boolean }[]
}
export interface RemoteAgentQuote { key: number; text: string; sessionId: string; capturedAt: string }
export interface RemoteBootstrap {
  platform?: string
  agentTarget?: { id: string; sessionId: string; approvalId?: string }
  generation: string; deviceId: string; deviceName: string
  language: AppLanguage; theme: AppTheme
}
export type RemoteResult<T> = { ok: true; value: T } | { ok: false; code: string; uncertain?: boolean }
export interface RemoteLocalTask {
  id: string; state: string; error_code?: string; remote_id: string; name: string
  direction: 'upload' | 'download'; confirmed_bytes: number; total_bytes: number; resumable: boolean
  target_bytes?: number; stage?: string; session_id?: string
}
export interface RemoteLocalSelection {
  direction: 'upload' | 'download'; location: JsonValue; name?: string
  overwrite: 'rename' | 'skip' | 'replace'
  locations?: JsonValue[]
  directory?: boolean
}
export interface RemoteLauncher {
  openAgent(generation: string, target: Extract<NotificationTarget, { kind: 'remote_agent' }>): Promise<RemoteResult<boolean>>
  open(generation: string, deviceId: string, deviceName: string): Promise<RemoteResult<boolean>>
  devices(generation: string): Promise<RemoteResult<RemoteDevice[]>>
  policy(generation: string): Promise<RemoteResult<RemotePolicy>>
  configure(generation: string, revision: number, enabled: boolean, hostIds: string[]): Promise<RemoteResult<RemotePolicy>>
  configureAgent(generation: string, revision: number, enabled: boolean): Promise<RemoteResult<RemotePolicy>>
  configureDesktops?(generation: string, revision: number, profiles: string[], exchangeProfiles?: string[]): Promise<RemoteResult<RemotePolicy>>
  desktopProfiles?(): Promise<RemoteResult<{ id: string; host_id: string; name: string; protocol: string }[]>>
  hosts(): Promise<RemoteResult<{ id: string; name: string }[]>>
  addDirectory(generation: string, revision: number, write: boolean): Promise<RemoteResult<RemotePolicy | null>>
  removeDirectory(generation: string, revision: number, id: string): Promise<RemoteResult<RemotePolicy>>
}
export interface RemoteWindowBridge {
  desktopICE?(connectionId: string): Promise<RemoteResult<RTCIceServer[]>>
  windowControls?: {
    minimize(): Promise<RemoteResult<boolean>>
    toggleMaximize(): Promise<RemoteResult<boolean>>
    isMaximized(): Promise<RemoteResult<boolean>>
    onMaximizeState(callback: (maximized: boolean) => void): () => void
  }
  setAgentView?(sessionId: string | undefined, connectionId: string): Promise<RemoteResult<boolean>>
  agentUpload(data: Uint8Array, mime: string, connectionId: string): Promise<RemoteResult<{ id: string }>>
  agentDownload(id: string, connectionId: string): Promise<RemoteResult<Uint8Array>>
  bootstrap(): Promise<RemoteBootstrap>
  connection(): Promise<RemoteResult<RemoteConnection>>
  reconnect(): Promise<RemoteResult<RemoteConnection>>
  request(request: JsonValue, connectionId: string): Promise<RemoteResult<JsonValue>>
  selectTransfer(input: RemoteLocalSelection, connectionId: string): Promise<RemoteResult<RemoteLocalTask | null>>
  localTransfers(connectionId: string): Promise<RemoteResult<RemoteLocalTask[]>>
  localTransferAction(id: string, action: 'resume' | 'cancel', connectionId: string): Promise<RemoteResult<RemoteLocalTask>>
  subscribe(callback: (sequence: number, data: Uint8Array) => void, closed: () => void, connectionId: string): () => void
  consume(sequence: number, connectionId: string): void
  send(data: Uint8Array, connectionId: string): Promise<RemoteResult<boolean>>
  disconnect(): Promise<RemoteResult<boolean>>
  close(): Promise<void>
  onAppearance(callback: (value: RemoteBootstrap) => void): () => void
}
