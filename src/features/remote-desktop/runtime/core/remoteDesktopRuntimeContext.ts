import { createContext, useContext } from 'react'
import type {
  RemoteDesktopDisplayMode,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import type {
  RemoteDesktopCredentials,
  RemoteDesktopViewerState,
} from './viewerContracts.ts'

export interface RemoteDesktopRuntimeValue {
  sessions: RemoteDesktopSession[]
  activeSessionId: string | null
  viewerStates: Record<string, RemoteDesktopViewerState>
  selectSession: (sessionId: string) => void
  createSession: (profileId: string) => Promise<RemoteDesktopSession>
  closeSession: (sessionId: string) => Promise<void>
  reconnectSession: (sessionId: string) => Promise<void>
  registerViewport: (sessionId: string, host: HTMLDivElement) => () => void
  setDisplayMode: (sessionId: string, mode: RemoteDesktopDisplayMode) => void
  setViewOnly: (sessionId: string, value: boolean) => void
  focusViewer: (sessionId: string) => void
  blurViewer: (sessionId: string) => void
  submitCredentials: (sessionId: string, credentials: RemoteDesktopCredentials) => void
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
