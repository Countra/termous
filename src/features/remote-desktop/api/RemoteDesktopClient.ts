import type { AppConfig } from '#common/contracts'
import type {
  RemoteDesktopAttachTicket,
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import { TermousApiTransport } from '#shared/api'
import type { RemoteDesktopGateway } from './remoteDesktopGateway.ts'

export class RemoteDesktopClient extends TermousApiTransport implements RemoteDesktopGateway {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  remoteDesktopProfiles() {
    return this.request<RemoteDesktopAccessProfile[]>('/api/v1/remote-desktop-profiles')
  }

  createRemoteDesktopProfile(input: RemoteDesktopAccessProfileInput) {
    return this.request<RemoteDesktopAccessProfile>('/api/v1/remote-desktop-profiles', {
      method: 'POST',
      body: input,
    })
  }

  updateRemoteDesktopProfile(
    id: string,
    expectedUpdatedAt: string,
    input: RemoteDesktopAccessProfileInput,
  ) {
    return this.request<RemoteDesktopAccessProfile>(
      `/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: { ...input, expected_updated_at: expectedUpdatedAt } },
    )
  }

  deleteRemoteDesktopProfile(id: string, expectedUpdatedAt: string) {
    return this.request<void>(`/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: { expected_updated_at: expectedUpdatedAt },
    })
  }

  saveRemoteDesktopTargetAuth(id: string, expectedUpdatedAt: string, password: string) {
    return this.request<RemoteDesktopAccessProfile>(
      `/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}/credentials/target-auth`,
      {
        method: 'PUT',
        body: { expected_updated_at: expectedUpdatedAt, password },
      },
    )
  }

  deleteRemoteDesktopTargetAuth(id: string, expectedUpdatedAt: string) {
    return this.request<RemoteDesktopAccessProfile>(
      `/api/v1/remote-desktop-profiles/${encodeURIComponent(id)}/credentials/target-auth`,
      {
        method: 'DELETE',
        body: { expected_updated_at: expectedUpdatedAt },
      },
    )
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

  consumeRemoteDesktopTargetAuth(
    id: string,
    expectedConnectionGeneration: number,
    credentialTicket: string,
  ) {
    return this.request<{ password: string }>(
      `/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/credentials/target-auth`,
      {
        method: 'POST',
        body: {
          expected_connection_generation: expectedConnectionGeneration,
          credential_ticket: credentialTicket,
        },
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
