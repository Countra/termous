import type { JsonValue } from '@bufbuild/protobuf'
import type { ICEConfiguration, TransportPolicy } from '@termous/remote-protocol/connection-policy'
import type { DesktopConnectionDiagnostic } from '@termous/remote-protocol/desktop-diagnostics'
import type { AppLanguage, AppTheme } from './application'
import type { NotificationTarget } from './notification'
import type { SettingsSnapshot } from './settings-center'
import type { HostDesktopTarget } from './desktop-target'

export interface HostDesktopAccess {
  id: string; device_id: string; target: HostDesktopTarget; title: string
  controlling: boolean; stopping: boolean
}

export interface RemoteConnection {
  transport_policy: TransportPolicy
	capabilities?: string[]
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
export type RemoteAccessMode = 'full' | 'custom'

export interface RemotePolicy {
  access_mode?: RemoteAccessMode
	host_desktop?: { observe: boolean; control: boolean; secure_capture?: boolean; secure_control?: boolean }
  revision: number; enabled: boolean
  agent_enabled?: boolean
  // 首次授权或清空授权后，后端的空切片可能序列化为 null。
  hosts: { id: string; terminal_file_access?: boolean; connections?: { id: string; kind: string }[] | null }[] | null
  directories: { id: string; name: string; path: string; read: boolean; write: boolean }[] | null
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
  editPolicy?(generation: string, editor: string): Promise<RemoteResult<RemotePolicyEditor>>
  closePolicyEditor?(editor: string): Promise<RemoteResult<boolean>>
  changePolicy?(generation: string, editor: string, revision: number, change: RemotePolicyChange): Promise<RemoteResult<RemotePolicyReceipt>>
  selectPolicyDirectory?(generation: string, editor: string): Promise<RemoteResult<string | null>>
  hostDesktopAccesses?(generation: string): Promise<RemoteResult<HostDesktopAccess[]>>
  stopHostDesktopAccess?(generation: string, id: string): Promise<RemoteResult<unknown>>
  openAgent(generation: string, target: Extract<NotificationTarget, { kind: 'remote_agent' }>): Promise<RemoteResult<boolean>>
  open(generation: string, deviceId: string, deviceName: string): Promise<RemoteResult<boolean>>
  devices(generation: string): Promise<RemoteResult<RemoteDevice[]>>
  policy(generation: string): Promise<RemoteResult<RemotePolicy>>
  configure(generation: string, revision: number, enabled: boolean, hostIds: string[] | undefined, accessMode: RemoteAccessMode): Promise<RemoteResult<RemotePolicy>>
  configureAgent(generation: string, revision: number, enabled: boolean): Promise<RemoteResult<RemotePolicy>>
	configureHostDesktop?(generation: string, revision: number, observe: boolean, control: boolean, secureCapture: boolean, secureControl: boolean): Promise<RemoteResult<RemotePolicy>>
  configureDesktops?(generation: string, revision: number, profiles: string[], exchangeProfiles?: string[]): Promise<RemoteResult<RemotePolicy>>
  desktopProfiles?(): Promise<RemoteResult<{ id: string; host_id: string; name: string; protocol: string }[]>>
  hosts(): Promise<RemoteResult<{ id: string; name: string }[]>>
  addDirectory(generation: string, revision: number, write: boolean): Promise<RemoteResult<RemotePolicy | null>>
  removeDirectory(generation: string, revision: number, id: string): Promise<RemoteResult<RemotePolicy>>
}

export type RemotePolicyChange =
  | { kind: 'enabled' | 'agent'; enabled: boolean }
  | { kind: 'mode'; mode: RemoteAccessMode }
  | { kind: 'hosts' | 'desktops' | 'exchange'; add?: string[]; remove?: string[]; reauthorize?: string[] }
  | { kind: 'host_desktop'; host_desktop: Required<NonNullable<RemotePolicy['host_desktop']>> }
  | { kind: 'directory_add'; selection: string; write: boolean }
  | { kind: 'directory_remove'; directory_id: string }

export interface RemotePolicyResource {
  id: string; name: string; host_id?: string; protocol?: string
  status: 'available' | 'changed' | 'unavailable'
}
export interface RemotePolicyEditor {
  policy: RemotePolicy; hosts: RemotePolicyResource[]; desktops: RemotePolicyResource[]
}
export interface RemotePolicyReceipt {
  policy: RemotePolicy; cleanup_pending: boolean; reconnect_desktop: boolean
}
export interface RemoteWindowBridge {
  desktopReceiverPolicy?: 'native' | 'prefer_level_51'
  desktopQualityDefaults?(connectionId: string): Promise<RemoteResult<SettingsSnapshot>>
  debugMode?: boolean
  desktopICE?(connectionId: string): Promise<RemoteResult<ICEConfiguration>>
  desktopDiagnostic?(connectionId: string, value: DesktopConnectionDiagnostic): void
  windowControls?: {
    minimize(): Promise<RemoteResult<boolean>>
    toggleMaximize(): Promise<RemoteResult<boolean>>
    isMaximized(): Promise<RemoteResult<boolean>>
    onMaximizeState(callback: (maximized: boolean) => void): () => void
  }
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
