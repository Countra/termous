import type { AppConfig } from '#common/contracts'
import type {
  RemoteDesktopAttachTicket,
  RemoteDesktopAccessProfile,
  RemoteDesktopAccessProfileInput,
  RemoteDesktopSession,
} from '#entities/remote-desktop'
import { TermousApiTransport } from '#shared/api'
import type { RemoteDesktopGateway } from './remoteDesktopGateway.ts'
import { DesktopFilesClient } from './DesktopFilesClient.ts'

export class RemoteDesktopClient extends TermousApiTransport implements RemoteDesktopGateway {
  readonly automation = {
    show: (id: string, generation: number, host: string) => this.request<void>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/automation/show`, { method: 'POST', body: { expected_connection_generation: generation, host_id: host } }),
    reclaim: (id: string, generation: number) => this.request<void>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/automation/reclaim`, { method: 'POST', body: { expected_connection_generation: generation } }),
  }
  readonly desktopFiles: DesktopFilesClient
  readonly execution = {
    connect: async (id: string, generation: number, readOnly: boolean) => {
      const value = await this.request<{ path: string; ticket: string }>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/executor-ticket`, {
        method: 'POST', body: { expected_connection_generation: generation, read_only: readOnly, ...(window.location.protocol === 'file:' ? { viewer_origin: 'null' } : {}) },
      })
      const url = new URL(value.path, this.config.apiBaseUrl)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.search = ''
      return { url: url.toString(), ticket: value.ticket }
    },
    reclaim: (id: string, generation: number, readOnly: boolean) => this.request<void>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/reclaim`, {
      method: 'POST', body: { expected_connection_generation: generation, read_only: readOnly },
    }),
  }
  supplyRemoteDesktopCredentials(id: string, generation: number, password: string) {
    return this.request<void>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/credentials`, {
      method: 'POST', body: { expected_connection_generation: generation, password },
    })
  }
  resolveRemoteDesktopCertificate(id: string, generation: number, challengeId: string, accept: boolean, remember: boolean) {
    return this.request<void>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/certificate`, {
      method: 'POST', body: { expected_connection_generation: generation, challenge_id: challengeId, accept, remember },
    })
  }

  takeRemoteDesktopControl(id: string, generation: number, subscriptionId: string) {
    return this.request<void>(`/api/v1/remote-desktop-sessions/${encodeURIComponent(id)}/control`, {
      method: 'POST', body: { expected_connection_generation: generation, subscription_id: subscriptionId },
    })
  }
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
    this.desktopFiles = new DesktopFilesClient(config)
  }

  override updateConfig(config: Partial<AppConfig>) {
    super.updateConfig(config)
    this.desktopFiles.updateConfig(config)
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
        body: {
          expected_connection_generation: expectedConnectionGeneration,
          ...(window.location.protocol === 'file:' ? { viewer_origin: 'null' } : {}),
        },
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
