import { TermousApiError } from '#shared/api'
import type { ForwardRuntimeGateway } from '../api/runtimeGatewayContracts'
import type { ForwardEvent, ForwardInstance, ForwardProfile } from '#entities/forward'
import {
  isForwardStartSettledStatus,
  shouldApplyForwardPollResponse,
} from '#features/forwards'

export const FORWARD_START_MISSING_GRACE_MS = 2_000
export const FORWARD_START_COMPLETION_TIMEOUT_MS = 30 * 60 * 1_000

export interface ForwardStartCompletionWaiter {
  resolve: (forward: ForwardInstance | null) => void
  registeredAt: number
  cleanupTimer: number
}

export function upsertForwardProfile(profiles: ForwardProfile[], next: ForwardProfile) {
  const exists = profiles.some((profile) => profile.id === next.id)
  const merged = exists ? profiles.map((profile) => (profile.id === next.id ? next : profile)) : [next, ...profiles]
  return [...merged].sort(sortForwardProfiles)
}

function sortForwardProfiles(left: ForwardProfile, right: ForwardProfile) {
  if (left.mode !== right.mode) {
    return left.mode.localeCompare(right.mode)
  }
  if (left.name !== right.name) {
    return left.name.localeCompare(right.name)
  }
  return left.id.localeCompare(right.id)
}

export function upsertForward(forwards: ForwardInstance[], next: ForwardInstance) {
  const exists = forwards.some((forward) => forward.id === next.id)
  const merged = exists ? forwards.map((forward) => (forward.id === next.id ? next : forward)) : [next, ...forwards]
  return [...merged].sort(sortForwards)
}

export function visibleForwards(forwards: ForwardInstance[]) {
  return forwards.filter((forward) => !shouldRemoveForward(forward))
}

export function reconcileForwardReloadSnapshot(
  currentForwards: ForwardInstance[],
  authoritativeForwards: ForwardInstance[],
  changedForwardIds: ReadonlySet<string>,
) {
  const merged = new Map(
    visibleForwards(authoritativeForwards).map((forward) => [forward.id, forward]),
  )
  if (changedForwardIds.size === 0) {
    return [...merged.values()].sort(sortForwards)
  }
  const currentById = new Map(currentForwards.map((forward) => [forward.id, forward]))
  for (const forwardId of changedForwardIds) {
    const current = currentById.get(forwardId)
    if (current && !shouldRemoveForward(current)) {
      merged.set(forwardId, current)
    } else {
      merged.delete(forwardId)
    }
  }
  return [...merged.values()].sort(sortForwards)
}

export function settleForwardStartCompletion(
  waiters: Map<string, ForwardStartCompletionWaiter>,
  snapshots: Map<string, ForwardInstance>,
  revisions: Map<string, number>,
  forwardId: string,
  forward: ForwardInstance | null,
) {
  if (forward && !isForwardStartSettledStatus(forward.status)) {
    return false
  }
  const waiter = waiters.get(forwardId)
  if (!waiter) {
    return false
  }
  waiters.delete(forwardId)
  snapshots.delete(forwardId)
  revisions.delete(forwardId)
  window.clearTimeout(waiter.cleanupTimer)
  waiter.resolve(forward)
  return true
}

export function reconcileForwardStartCompletions(
  waiters: Map<string, ForwardStartCompletionWaiter>,
  snapshots: Map<string, ForwardInstance>,
  revisions: Map<string, number>,
  authoritativeForwards: ForwardInstance[],
) {
  const byId = new Map(authoritativeForwards.map((forward) => [forward.id, forward]))
  const now = performance.now()
  for (const [forwardId, waiter] of waiters) {
    const forward = byId.get(forwardId)
    if (forward) {
      settleForwardStartCompletion(
        waiters,
        snapshots,
        revisions,
        forwardId,
        forward,
      )
      continue
    }
    if (now - waiter.registeredAt >= FORWARD_START_MISSING_GRACE_MS) {
      settleForwardStartCompletion(
        waiters,
        snapshots,
        revisions,
        forwardId,
        null,
      )
    }
  }
}

export function rememberForwardEventSnapshot(
  snapshots: Map<string, ForwardInstance>,
  forward: ForwardInstance,
) {
  snapshots.delete(forward.id)
  snapshots.set(forward.id, forward)
  if (snapshots.size <= 256) {
    return
  }
  const oldestForwardId = snapshots.keys().next().value
  if (oldestForwardId) {
    snapshots.delete(oldestForwardId)
  }
}

export function shouldRemoveForward(forward: ForwardInstance) {
  return forward.status === 'stopped' || forward.status === 'failed'
}

export function shouldEmitForwardError(event: ForwardEvent) {
  if (event.type === 'snapshot') {
    return false
  }
  if (event.forward.status === 'reconnecting') {
    return false
  }
  if (event.type === 'error' || event.forward.status === 'failed') {
    return true
  }
  return event.type === 'update' && event.forward.status === 'running' && Boolean(event.forward.last_error)
}

function sortForwards(left: ForwardInstance, right: ForwardInstance) {
  const leftTime = new Date(left.started_at).getTime()
  const rightTime = new Date(right.started_at).getTime()
  if (leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return left.id.localeCompare(right.id)
}

export async function syncForwardAfterStart(
  api: ForwardRuntimeGateway,
  id: string,
  onForward: (forward: ForwardInstance) => void,
  currentEventRevision: () => number,
  isCompletionPending: () => boolean,
): Promise<ForwardInstance | null | undefined> {
  const intervals = [240, 420, 700, 1100, 1700, 2600, 4000]
  for (const interval of intervals) {
    await delay(interval)
    if (!isCompletionPending()) {
      return undefined
    }
    const eventRevision = currentEventRevision()
    try {
      const forward = await api.getForward(id)
      if (!isCompletionPending()) {
        return undefined
      }
      if (!shouldApplyForwardPollResponse(eventRevision, currentEventRevision())) {
        continue
      }
      onForward(forward)
      if (isForwardStartSettledStatus(forward.status)) {
        return forward
      }
    } catch (syncError) {
      if (!isCompletionPending()) {
        return undefined
      }
      if (!shouldApplyForwardPollResponse(eventRevision, currentEventRevision())) {
        continue
      }
      if (syncError instanceof TermousApiError && syncError.status === 404) {
        return syncForwardFromList(
          api,
          id,
          onForward,
          currentEventRevision,
          isCompletionPending,
        )
      }
    }
  }
  return syncForwardFromList(
    api,
    id,
    onForward,
    currentEventRevision,
    isCompletionPending,
  )
}

async function syncForwardFromList(
  api: ForwardRuntimeGateway,
  id: string,
  onForward: (forward: ForwardInstance) => void,
  currentEventRevision: () => number,
  isCompletionPending: () => boolean,
): Promise<ForwardInstance | null | undefined> {
  const eventRevision = currentEventRevision()
  try {
    const forwards = await api.forwards()
    if (
      !isCompletionPending()
      || !shouldApplyForwardPollResponse(eventRevision, currentEventRevision())
    ) {
      return undefined
    }
    const forward = (forwards ?? []).find((item) => item.id === id)
    if (!forward) {
      return null
    }
    onForward(forward)
    return isForwardStartSettledStatus(forward.status) ? forward : undefined
  } catch {
    return undefined
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
