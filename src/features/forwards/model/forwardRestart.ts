import type {
  ForwardInstance,
  ForwardStartRequest,
  ForwardStatus,
} from '#entities/forward'

export type ForwardRuntimeAction = 'restart' | 'stop'

export function buildForwardRestartRequest(forward: ForwardInstance): ForwardStartRequest {
  if (forward.scope === 'background_profile' && forward.profile_id) {
    return {
      profile_id: forward.profile_id,
      scope: forward.scope,
    }
  }

  return {
    scope: forward.scope,
    session_id: forward.session_id,
    host_id: forward.host_id,
    name: forward.name,
    description: forward.description,
    mode: forward.mode,
    bind_host: forward.bind_host,
    bind_port: forward.bind_port,
    target_host: forward.mode === 'dynamic' ? '' : forward.target_host,
    target_port: forward.mode === 'dynamic' ? 0 : forward.target_port,
  }
}

export async function restartForwardInstance(
  forward: ForwardInstance,
  stop: (id: string) => Promise<void>,
  start: (input: ForwardStartRequest) => Promise<ForwardInstance>,
) {
  const request = buildForwardRestartRequest(forward)
  await stop(forward.id)
  return start(request)
}

export function reconcileForwardsAfterRestartFailure(
  currentForwards: ForwardInstance[],
  authoritativeForwards: ForwardInstance[] | null,
  replacedForwardId: string,
  stopConfirmed: boolean,
) {
  if (stopConfirmed) {
    return currentForwards.filter((forward) => forward.id !== replacedForwardId)
  }
  if (authoritativeForwards === null) {
    return currentForwards
  }
  const authoritativeForward = authoritativeForwards.find(
    (forward) => forward.id === replacedForwardId,
  )
  if (!authoritativeForward) {
    return currentForwards.filter((forward) => forward.id !== replacedForwardId)
  }
  const exists = currentForwards.some((forward) => forward.id === replacedForwardId)
  return exists
    ? currentForwards.map((forward) => (
        forward.id === replacedForwardId ? authoritativeForward : forward
      ))
    : [authoritativeForward, ...currentForwards]
}

export function selectForwardStartSnapshot(
  startResponse: ForwardInstance,
  latestEventSnapshot: ForwardInstance | null,
) {
  return latestEventSnapshot ?? startResponse
}

export function isForwardStartSettledStatus(status: ForwardStatus) {
  return status === 'running' || status === 'stopped' || status === 'failed'
}

export function isForwardRestartCompleted(forward: ForwardInstance | null) {
  return forward?.status === 'running'
}

export function shouldApplyForwardPollResponse(
  requestEventRevision: number,
  currentEventRevision: number,
) {
  return requestEventRevision === currentEventRevision
}

export function forwardRuntimeActionAvailability(status: ForwardStatus) {
  return {
    restart: status === 'running',
    stop: status === 'starting'
      || status === 'waiting_host_trust'
      || status === 'running'
      || status === 'reconnecting',
  }
}
