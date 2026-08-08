import type { AppConfig } from '#common/contracts';
import type { HostKeyChallengeSnapshot, HostKeyDecisionAction, HostKeyResolution, HostKeyTrustRecord } from '#entities/host-key';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

export class HostKeyClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

hostKeyChallenges(signal?: AbortSignal) {
    return this.request<HostKeyChallengeSnapshot>('/api/v1/host-key-challenges?status=pending', { signal })
      .then(normalizeHostKeyChallengeSnapshot)
  }

decideHostKeyChallenge(id: string, action: HostKeyDecisionAction) {
    return this.request<HostKeyResolution>(`/api/v1/host-key-challenges/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: { action },
    })
  }

hostKeyTrust() {
    return this.request<HostKeyTrustRecord[]>('/api/v1/host-key-trust').then(normalizeArray)
  }

deleteHostKeyTrust(id: string) {
    return this.request<void>(`/api/v1/host-key-trust/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

hostKeyEventsUrl() {
    return this.websocketUrl('/api/v1/host-key-events')
  }
}

function normalizeHostKeyChallengeSnapshot(snapshot: HostKeyChallengeSnapshot): HostKeyChallengeSnapshot {
  return {
    ...snapshot,
    challenges: normalizeArray(snapshot.challenges).map((challenge) => ({
      ...challenge,
      contexts: normalizeArray(challenge.contexts),
    })),
  }
}
