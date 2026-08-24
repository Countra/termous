import type { AppConfig } from '#common/contracts'
import type {
  RemoteDesktopAttachTicket,
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import { TermousApiTransport } from '#shared/api'
import type { RemoteDesktopGateway } from './remoteDesktopGateway.ts'

export class RemoteDesktopClient extends TermousApiTransport implements RemoteDesktopGateway {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  remoteDesktopProfiles() {
    return this.request<RemoteDesktopProfile[]>('/api/v1/remote-desktop-profiles')
  }

  createRemoteDesktopProfile(input: RemoteDesktopProfileInput) {
    return this.request<RemoteDesktopProfile>('/api/v1/remote-desktop-profiles', {
      method: 'POST',
      body: input,
    })
  }

  updateRemoteDesktopProfile(id: string, input: RemoteDesktopProfileInput) {
    return this.request<RemoteDesktopProfile>(
      `/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: input },
    )
  }

  deleteRemoteDesktopProfile(id: string) {
    return this.request<void>(`/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  remoteDesktopSessions() {
    return this.request<RemoteDesktopSession[]>('/api/v1/remote-desktop-sessions')
  }

  createRemoteDesktopSession(profileId: string) {
    return this.request<RemoteDesktopSession>('/api/v1/remote-desktop-sessions', {
      method: 'POST',
      body: { profile_id: profileId },
    })
  }

  deleteRemoteDesktopSession(id: string) {
    return this.request<void>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  reconnectRemoteDesktopSession(id: string, expectedConnectionGeneration: number) {
    return this.request<RemoteDesktopSession>(
      `/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/reconnect`,
      {
        method: 'POST',
        body: { expected_connection_generation: expectedConnectionGeneration },
      },
    )
  }

  createRemoteDesktopAttachTicket(id: string, expectedConnectionGeneration: number) {
    return this.request<RemoteDesktopAttachTicket>(
      `/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/attach-tickets`,
      {
        method: 'POST',
        body: { expected_connection_generation: expectedConnectionGeneration },
      },
    )
  }

  remoteDesktopSessionEventsUrl() {
    return this.websocketUrl('/api/v1/remote-desktop-sessions/events')
  }

  remoteDesktopStreamUrl(ticket: RemoteDesktopAttachTicket) {
    const url = new URL(ticket.stream_path, this.config.apiBaseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.search = ''
    url.searchParams.set('ticket', ticket.ticket)
    return url.toString()
  }
}
