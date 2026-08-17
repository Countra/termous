import {
  decodeFileSessionSnapshotEvent,
  type FileSessionSnapshotEvent,
} from '#entities/file'
import { useAuthoritativeSnapshotSubscription } from './useAuthoritativeSnapshotSubscription'

interface UseFileSessionSnapshotSubscriptionOptions {
  enabled: boolean
  eventsUrl: () => string
  onSnapshot: (event: FileSessionSnapshotEvent, generation: number) => void
}

export function useFileSessionSnapshotSubscription({
  enabled,
  eventsUrl,
  onSnapshot,
}: UseFileSessionSnapshotSubscriptionOptions) {
  useAuthoritativeSnapshotSubscription({
    enabled,
    eventsUrl,
    decode: decodeFileSessionSnapshotEvent,
    onSnapshot,
  })
}
