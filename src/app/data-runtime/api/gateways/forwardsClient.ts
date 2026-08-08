import type { AppConfig } from '#common/contracts';
import type { ForwardInstance, ForwardProfile, ForwardProfileInput, ForwardStartRequest } from '#entities/forward';
import { TermousApiTransport } from '#shared/api';

export class ForwardClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

forwardProfiles() {
    return this.request<ForwardProfile[]>('/api/v1/forward-profiles')
  }

createForwardProfile(input: ForwardProfileInput) {
    return this.request<ForwardProfile>('/api/v1/forward-profiles', {
      method: 'POST',
      body: input,
    })
  }

updateForwardProfile(id: string, input: ForwardProfileInput) {
    return this.request<ForwardProfile>(`/api/v1/forward-profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

deleteForwardProfile(id: string) {
    return this.request<void>(`/api/v1/forward-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

forwards() {
    return this.request<ForwardInstance[]>('/api/v1/forwards')
  }

getForward(id: string) {
    return this.request<ForwardInstance>(`/api/v1/forwards/${encodeURIComponent(id)}`)
  }

startForward(input: ForwardStartRequest) {
    return this.request<ForwardInstance>('/api/v1/forwards', {
      method: 'POST',
      body: input,
    })
  }

stopForward(id: string) {
    return this.request<void>(`/api/v1/forwards/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

forwardEventsUrl() {
    return this.websocketUrl('/api/v1/forwards/events')
  }
}
