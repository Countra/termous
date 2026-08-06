import type {
  HostKeyChallengeSnapshot,
  HostKeyDecisionAction,
  HostKeyResolution,
} from '#entities/host-key'

export interface HostKeyGateway {
  hostKeyChallenges: (signal?: AbortSignal) => Promise<HostKeyChallengeSnapshot>
  decideHostKeyChallenge: (
    id: string,
    action: HostKeyDecisionAction,
  ) => Promise<HostKeyResolution>
  hostKeyEventsUrl: () => string
}
