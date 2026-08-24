import { createContext, useContext } from 'react'
import type {
  RemoteDesktopDisplayMode,
  RemoteDesktopSession,
  VncCredentials,
  VncCredentialType,
} from '#entities/remote-desktop'
import type {
  VncViewerCapabilities,
  VncViewerErrorCode,
} from '../model/viewerTypes.ts'

export type VncViewerConnectionState =
  | 'idle'
  | 'loading'
  | 'connecting'
  | 'credentials_required'
  | 'verifying_server'
  | 'connected'
  | 'disconnected'
  | 'security_failed'

export interface VncViewerState {
  connection: VncViewerConnectionState
  credentialTypes: VncCredentialType[]
  verification: { type: string; fingerprint: string } | null
  displayMode: RemoteDesktopDisplayMode
  viewOnly: boolean
  desktopName: string
  remoteClipboard: string
  capabilities: VncViewerCapabilities
  errorCode: VncViewerErrorCode | 'stream_disconnected' | 'attach_failed' | 'server_identity_rejected' | ''
}

export interface RemoteDesktopRuntimeValue {
  sessions: RemoteDesktopSession[]
  activeSessionId: string | null
  viewerStates: Record<string, VncViewerState>
  selectSession: (sessionId: string) => void
  createSession: (profileId: string) => Promise<RemoteDesktopSession>
  closeSession: (sessionId: string) => Promise<void>
  reconnectSession: (sessionId: string) => Promise<void>
  registerViewport: (sessionId: string, host: HTMLDivElement) => () => void
  setDisplayMode: (sessionId: string, mode: RemoteDesktopDisplayMode) => void
  setViewOnly: (sessionId: string, value: boolean) => void
  focusViewer: (sessionId: string) => void
  blurViewer: (sessionId: string) => void
  submitCredentials: (sessionId: string, credentials: VncCredentials) => void
  approveServer: (sessionId: string) => void
  rejectServer: (sessionId: string) => Promise<void>
  sendCtrlAltDel: (sessionId: string) => void
  sendClipboard: (sessionId: string, text: string) => void
}

export const RemoteDesktopRuntimeContext = createContext<RemoteDesktopRuntimeValue | null>(null)

export function useRemoteDesktopRuntime() {
  const value = useContext(RemoteDesktopRuntimeContext)
  if (!value) {
    throw new Error('RemoteDesktopRuntimeProvider is required')
  }
  return value
}
