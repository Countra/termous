import type {
  RemoteDesktopAttachTicket,
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
  RemoteDesktopSession,
} from '#entities/remote-desktop'

export interface RemoteDesktopGateway {
  supplyRemoteDesktopCredentials: (id: string, generation: number, password: string) => Promise<void>
  resolveRemoteDesktopCertificate: (id: string, generation: number, challengeId: string, accept: boolean, remember: boolean) => Promise<void>
  takeRemoteDesktopControl: (id: string, generation: number, subscriptionId: string) => Promise<void>
  remoteDesktopProfiles: () => Promise<RemoteDesktopAccessProfile[]>
  createRemoteDesktopProfile: (
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  updateRemoteDesktopProfile: (
    id: string,
    expectedUpdatedAt: string,
    input: RemoteDesktopAccessProfileInput,
  ) => Promise<RemoteDesktopAccessProfile>
  deleteRemoteDesktopProfile: (id: string, expectedUpdatedAt: string) => Promise<void>
  saveRemoteDesktopTargetAuth: (
    id: string,
    expectedUpdatedAt: string,
    password: string,
  ) => Promise<RemoteDesktopAccessProfile>
  deleteRemoteDesktopTargetAuth: (
    id: string,
    expectedUpdatedAt: string,
  ) => Promise<RemoteDesktopAccessProfile>
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
  consumeRemoteDesktopTargetAuth: (
    id: string,
    expectedConnectionGeneration: number,
    credentialTicket: string,
  ) => Promise<{ password: string }>
  remoteDesktopSessionEventsUrl: () => string
  remoteDesktopStreamUrl: (ticket: RemoteDesktopAttachTicket) => string
}
