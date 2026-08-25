import type {
  RemoteDesktopAttachTicket,
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
  RemoteDesktopSession,
} from '#entities/remote-desktop'

export interface RemoteDesktopGateway {
  remoteDesktopProfiles: () => Promise<RemoteDesktopProfile[]>
  createRemoteDesktopProfile: (input: RemoteDesktopProfileInput) => Promise<RemoteDesktopProfile>
  updateRemoteDesktopProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: RemoteDesktopProfileInput,
  ) => Promise<RemoteDesktopProfile>
  deleteRemoteDesktopProfile: (id: string, expectedUpdatedAt: string) => Promise<void>
  remoteDesktopSessions: () => Promise<RemoteDesktopSession[]>
  createRemoteDesktopSession: (profileId: string) => Promise<RemoteDesktopSession>
  deleteRemoteDesktopSession: (id: string) => Promise<void>
  reconnectRemoteDesktopSession: (
    id: string,
    expectedConnectionGeneration: number,
  ) => Promise<RemoteDesktopSession>
  createRemoteDesktopAttachTicket: (
    id: string,
    expectedConnectionGeneration: number,
  ) => Promise<RemoteDesktopAttachTicket>
  remoteDesktopSessionEventsUrl: () => string
  remoteDesktopStreamUrl: (ticket: RemoteDesktopAttachTicket) => string
}
