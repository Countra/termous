import type { AppConfig } from '#common/contracts'
import type { MountEnvironment, MountInput, MountInstance, MountProfile, MountStartRequest } from '#entities/mount'
import { TermousApiTransport } from '#shared/api'

export class MountClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) { super(config) }
  environment() { return this.request<MountEnvironment>('/api/v1/mounts/environment') }
  profiles() { return this.request<MountProfile[]>('/api/v1/mounts/profiles') }
  save(id: string | undefined, input: MountInput) {
    return this.request<MountProfile>(`/api/v1/mounts/profiles${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', body: input })
  }
  remove(profile: MountProfile) {
    return this.request<void>(`/api/v1/mounts/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE', body: { expected_updated_at: profile.updated_at } })
  }
  start(input: MountStartRequest) { return this.request<MountInstance>('/api/v1/mounts/instances', { method: 'POST', body: input }) }
  action(id: string, action: 'sync' | 'reconnect' | 'stop', force = false) {
    return this.request<MountInstance>(`/api/v1/mounts/instances/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { force } })
  }
  eventsUrl() { return this.websocketUrl('/api/v1/mounts/events') }
}
