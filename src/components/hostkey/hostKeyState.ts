import type { HostKeyChallenge, HostKeyChallengeSnapshot, HostKeyEvent } from '../../types/domain'

export interface HostKeyCoordinatorState {
  instanceId: string
  revision: number
  challenges: HostKeyChallenge[]
  ready: boolean
}

export type HostKeyCoordinatorAction =
  | { type: 'snapshot'; snapshot: HostKeyChallengeSnapshot }
  | { type: 'event'; event: HostKeyEvent }
  | { type: 'resolved'; challengeId: string; revision?: number }
  | { type: 'clear' }

export const initialHostKeyCoordinatorState: HostKeyCoordinatorState = {
  instanceId: '',
  revision: 0,
  challenges: [],
  ready: false,
}

export function hostKeyCoordinatorReducer(
  state: HostKeyCoordinatorState,
  action: HostKeyCoordinatorAction,
): HostKeyCoordinatorState {
  if (action.type === 'clear') {
    return initialHostKeyCoordinatorState
  }
  if (action.type === 'snapshot') {
    const snapshot = normalizeSnapshot(action.snapshot)
    if (state.instanceId === snapshot.instance_id && snapshot.snapshot_revision < state.revision) {
      return state
    }
    return {
      instanceId: snapshot.instance_id,
      revision: snapshot.snapshot_revision,
      challenges: sortChallenges(snapshot.challenges),
      ready: true,
    }
  }
  if (action.type === 'resolved') {
    return {
      ...state,
      revision: Math.max(state.revision, action.revision ?? state.revision),
      challenges: state.challenges.filter((challenge) => challenge.id !== action.challengeId),
    }
  }

  const { event } = action
  if (event.instance_id !== state.instanceId || event.snapshot_revision !== state.revision + 1) {
    return state
  }
  if (event.type === 'challenge_upsert' && event.challenge?.state === 'pending') {
    return {
      ...state,
      revision: event.snapshot_revision,
      challenges: sortChallenges(upsertChallenge(state.challenges, normalizeChallenge(event.challenge))),
    }
  }
  const challengeId = event.resolution?.challenge_id ?? event.challenge?.id
  return {
    ...state,
    revision: event.snapshot_revision,
    challenges: challengeId
      ? state.challenges.filter((challenge) => challenge.id !== challengeId)
      : state.challenges,
  }
}

export function hostKeyEventNeedsReconciliation(state: HostKeyCoordinatorState, event: HostKeyEvent) {
  return !state.ready || event.instance_id !== state.instanceId || event.snapshot_revision !== state.revision + 1
}

function normalizeSnapshot(snapshot: HostKeyChallengeSnapshot): HostKeyChallengeSnapshot {
  return {
    instance_id: String(snapshot.instance_id ?? ''),
    snapshot_revision: normalizeRevision(snapshot.snapshot_revision),
    challenges: (Array.isArray(snapshot.challenges) ? snapshot.challenges : [])
      .filter((challenge) => challenge?.state === 'pending')
      .map(normalizeChallenge),
  }
}

function normalizeChallenge(challenge: HostKeyChallenge): HostKeyChallenge {
  return {
    ...challenge,
    contexts: Array.isArray(challenge.contexts) ? challenge.contexts : [],
    context_count: Math.max(challenge.context_count || 0, challenge.contexts?.length ?? 0),
  }
}

function normalizeRevision(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function upsertChallenge(challenges: HostKeyChallenge[], next: HostKeyChallenge) {
  const exists = challenges.some((challenge) => challenge.id === next.id)
  return exists
    ? challenges.map((challenge) => (challenge.id === next.id ? next : challenge))
    : [...challenges, next]
}

function sortChallenges(challenges: HostKeyChallenge[]) {
  return [...challenges].sort((left, right) => {
    const createdOrder = Date.parse(left.created_at) - Date.parse(right.created_at)
    if (Number.isFinite(createdOrder) && createdOrder !== 0) {
      return createdOrder
    }
    return left.id.localeCompare(right.id)
  })
}
