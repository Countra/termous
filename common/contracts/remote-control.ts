import type { JsonValue } from '@bufbuild/protobuf'
import type { AppLanguage, AppTheme } from './application'

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
  hosts: { id: string }[]
  directories: { id: string; name: string; path: string; read: boolean; write: boolean }[]
}
export interface RemoteBootstrap {
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
  open(generation: string, deviceId: string, deviceName: string): Promise<RemoteResult<boolean>>
  devices(generation: string): Promise<RemoteResult<RemoteDevice[]>>
  policy(generation: string): Promise<RemoteResult<RemotePolicy>>
  configure(generation: string, revision: number, enabled: boolean, hostIds: string[]): Promise<RemoteResult<RemotePolicy>>
  hosts(): Promise<RemoteResult<{ id: string; name: string }[]>>
  addDirectory(generation: string, revision: number, write: boolean): Promise<RemoteResult<RemotePolicy | null>>
  removeDirectory(generation: string, revision: number, id: string): Promise<RemoteResult<RemotePolicy>>
}
export interface RemoteWindowBridge {
  bootstrap(): Promise<RemoteBootstrap>
  connection(): Promise<RemoteResult<RemoteConnection>>
  request(request: JsonValue): Promise<RemoteResult<JsonValue>>
  selectTransfer(input: RemoteLocalSelection): Promise<RemoteResult<RemoteLocalTask | null>>
  localTransfers(): Promise<RemoteResult<RemoteLocalTask[]>>
  localTransferAction(id: string, action: 'resume' | 'cancel'): Promise<RemoteResult<RemoteLocalTask>>
  subscribe(callback: (sequence: number, data: Uint8Array) => void, closed: () => void): () => void
  consume(sequence: number): void
  send(data: Uint8Array): Promise<RemoteResult<boolean>>
  disconnect(): Promise<RemoteResult<boolean>>
  close(): Promise<void>
  onAppearance(callback: (value: RemoteBootstrap) => void): () => void
}
