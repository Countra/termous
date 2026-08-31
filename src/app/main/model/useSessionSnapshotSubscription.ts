import {
  decodeSessionSnapshotEvent,
  type SessionSnapshotEvent,
} from '#entities/session'
import { useAuthoritativeSnapshotSubscription } from './useAuthoritativeSnapshotSubscription'

interface UseSessionSnapshotSubscriptionOptions {
  enabled: boolean
  eventsUrl: () => string
  onSnapshot: (event: SessionSnapshotEvent, generation: number) => void
  onAwaitingSnapshot?: () => void
}

export function useSessionSnapshotSubscription({
  enabled,
  eventsUrl,
  onSnapshot,
  onAwaitingSnapshot,
}: UseSessionSnapshotSubscriptionOptions) {
  useAuthoritativeSnapshotSubscription({
    enabled,
    eventsUrl,
    decode: decodeSessionSnapshotEvent,
    onSnapshot,
    onAwaitingSnapshot,
  })
}
