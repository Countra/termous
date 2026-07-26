import type {
  UpdateErrorCode,
  UpdatePhase,
  UpdatePreferencesPatch,
  UpdateSnapshot,
} from '../../../electron/updateTypes'

const channelNamePrefix = 'termous-development-update-simulation'
const snapshotMessageKind = 'snapshot'
const snapshotRequestMessageKind = 'snapshot_request'
const actionRequestMessageKind = 'action_request'
const actionResultMessageKind = 'action_result'
const actionTimeoutMs = 10_000

const updatePhases = new Set<UpdatePhase>([
  'unsupported',
  'idle',
  'checking',
  'up_to_date',
  'available',
  'downloading',
  'downloaded',
  'preparing_install',
  'installing',
  'error',
])

const updateErrorCodes = new Set<UpdateErrorCode>([
  'UPDATE_UNSUPPORTED',
  'UPDATE_CHECK_FAILED',
  'UPDATE_METADATA_INVALID',
  'UPDATE_ASSET_NOT_FOUND',
  'UPDATE_DOWNLOAD_FAILED',
  'UPDATE_DOWNLOAD_CANCELED',
  'UPDATE_CANCEL_FAILED',
  'UPDATE_HASH_MISMATCH',
  'UPDATE_SIGNATURE_INVALID',
  'UPDATE_CORE_SHUTDOWN_FAILED',
  'UPDATE_INSTALL_SUMMARY_STALE',
  'UPDATE_INSTALL_START_FAILED',
])

interface SnapshotMessage {
  actor_id: string
  kind: typeof snapshotMessageKind
  simulation_id: string
  snapshot: UpdateSnapshot
}

interface SnapshotRequestMessage {
  actor_id: string
  kind: typeof snapshotRequestMessageKind
  simulation_id: string
}

export type DevelopmentUpdateSimulationAction =
  | { type: 'check' }
  | { type: 'set_preferences'; patch: UpdatePreferencesPatch }
  | { type: 'download' }
  | { type: 'cancel_download' }
  | { type: 'install_boundary' }

interface ActionRequestMessage {
  action: DevelopmentUpdateSimulationAction
  actor_id: string
  kind: typeof actionRequestMessageKind
  request_id: string
  simulation_id: string
  target_actor_id: string
}

interface ActionResultMessage {
  actor_id: string
  error: 'action_failed' | null
  kind: typeof actionResultMessageKind
  request_id: string
  simulation_id: string
  snapshot: UpdateSnapshot | null
  target_actor_id: string
}

export interface DevelopmentUpdateSimulationChannel {
  publish(snapshot: UpdateSnapshot): void
  requestAction(
    action: DevelopmentUpdateSimulationAction,
  ): Promise<UpdateSnapshot>
  requestSnapshot(): void
  close(): void
}

interface ChannelOptions {
  actorId: string
  getSnapshot(): UpdateSnapshot
  handleAction?(
    action: DevelopmentUpdateSimulationAction,
  ): Promise<UpdateSnapshot>
  onSnapshot(snapshot: UpdateSnapshot, actorId: string): void
  ownerActorId: string
  simulationId: string
}

export function connectDevelopmentUpdateSimulationChannel(
  options: ChannelOptions,
): DevelopmentUpdateSimulationChannel {
  if (
    typeof window === 'undefined'
    || typeof window.BroadcastChannel !== 'function'
    || !isDevelopmentUpdateSimulationIdentity(options.simulationId)
    || !isDevelopmentUpdateSimulationIdentity(options.actorId)
    || !isDevelopmentUpdateSimulationIdentity(options.ownerActorId)
  ) {
    return noOperationChannel()
  }

  const channel = new window.BroadcastChannel(
    `${channelNamePrefix}:${options.simulationId}`,
  )
  const pendingActions = new Map<string, {
    reject(error: Error): void
    resolve(snapshot: UpdateSnapshot): void
    timer: number
  }>()
  let closed = false
  let pageHideListener: ((event: PageTransitionEvent) => void) | null = null
  const publish = (snapshot: UpdateSnapshot) => {
    if (!closed) {
      channel.postMessage({
        actor_id: options.actorId,
        kind: snapshotMessageKind,
        simulation_id: options.simulationId,
        snapshot,
      } satisfies SnapshotMessage)
    }
  }
  const close = () => {
    if (closed) {
      return
    }
    closed = true
    for (const pending of pendingActions.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error('development_update_simulation_channel_closed'))
    }
    pendingActions.clear()
    if (pageHideListener) {
      window.removeEventListener('pagehide', pageHideListener)
      pageHideListener = null
    }
    channel.close()
  }

  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (closed || !isRecord(event.data)) {
      return
    }
    if (
      event.data.simulation_id !== options.simulationId
      || !isDevelopmentUpdateSimulationIdentity(event.data.actor_id)
    ) {
      return
    }
    if (event.data.kind === snapshotRequestMessageKind) {
      if (options.actorId === options.ownerActorId) {
        publish(options.getSnapshot())
      }
      return
    }
    if (
      event.data.kind === actionRequestMessageKind
      && options.handleAction
      && event.data.target_actor_id === options.actorId
    ) {
      const action = parseAction(event.data.action)
      if (
        !action
        || !isDevelopmentUpdateSimulationIdentity(event.data.request_id)
      ) {
        return
      }
      const requestId = event.data.request_id
      const requestingActor = event.data.actor_id
      void options.handleAction(action)
        .then((snapshot) => {
          channel.postMessage({
            actor_id: options.actorId,
            error: null,
            kind: actionResultMessageKind,
            request_id: requestId,
            simulation_id: options.simulationId,
            snapshot,
            target_actor_id: requestingActor,
          } satisfies ActionResultMessage)
        })
        .catch(() => {
          channel.postMessage({
            actor_id: options.actorId,
            error: 'action_failed',
            kind: actionResultMessageKind,
            request_id: requestId,
            simulation_id: options.simulationId,
            snapshot: null,
            target_actor_id: requestingActor,
          } satisfies ActionResultMessage)
        })
      return
    }
    if (
      event.data.kind === actionResultMessageKind
      && event.data.actor_id === options.ownerActorId
      && event.data.target_actor_id === options.actorId
      && isDevelopmentUpdateSimulationIdentity(event.data.request_id)
    ) {
      const pending = pendingActions.get(event.data.request_id)
      if (!pending) {
        return
      }
      pendingActions.delete(event.data.request_id)
      window.clearTimeout(pending.timer)
      if (
        event.data.error
        || !isUpdateSnapshot(event.data.snapshot)
      ) {
        pending.reject(new Error('development_update_simulation_action_failed'))
        return
      }
      const snapshot = cloneSnapshot(event.data.snapshot)
      options.onSnapshot(snapshot, event.data.actor_id)
      pending.resolve(snapshot)
      return
    }
    if (
      event.data.kind === snapshotMessageKind
      && event.data.actor_id === options.ownerActorId
      && isUpdateSnapshot(event.data.snapshot)
    ) {
      options.onSnapshot(
        cloneSnapshot(event.data.snapshot),
        event.data.actor_id,
      )
    }
  }
  pageHideListener = (event) => {
    // 页面进入 bfcache 时仍会恢复当前实例，只有真正卸载才释放通道。
    if (!event.persisted) {
      close()
    }
  }
  window.addEventListener('pagehide', pageHideListener)

  return {
    publish,
    requestAction: (action) => {
      if (closed) {
        return Promise.reject(
          new Error('development_update_simulation_channel_closed'),
        )
      }
      const requestId = crypto.randomUUID()
      return new Promise<UpdateSnapshot>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingActions.delete(requestId)
          reject(new Error('development_update_simulation_action_timeout'))
        }, actionTimeoutMs)
        pendingActions.set(requestId, { reject, resolve, timer })
        channel.postMessage({
          action,
          actor_id: options.actorId,
          kind: actionRequestMessageKind,
          request_id: requestId,
          simulation_id: options.simulationId,
          target_actor_id: options.ownerActorId,
        } satisfies ActionRequestMessage)
      })
    },
    requestSnapshot: () => {
      if (!closed) {
        channel.postMessage({
          actor_id: options.actorId,
          kind: snapshotRequestMessageKind,
          simulation_id: options.simulationId,
        } satisfies SnapshotRequestMessage)
      }
    },
    close,
  }
}

export function isDevelopmentUpdateSimulationSnapshot(
  value: unknown,
): value is UpdateSnapshot {
  return isUpdateSnapshot(value)
}

export function isDevelopmentUpdateSimulationIdentity(
  value: unknown,
): value is string {
  return (
    typeof value === 'string'
    && /^[a-z0-9][a-z0-9-]{7,63}$/.test(value)
  )
}

function isUpdateSnapshot(value: unknown): value is UpdateSnapshot {
  if (
    !isRecord(value)
    || !isSafeNonNegativeInteger(value.state_seq)
    || !isSafeNonNegativeInteger(value.operation_generation)
    || typeof value.phase !== 'string'
    || !updatePhases.has(value.phase as UpdatePhase)
    || typeof value.current_version !== 'string'
    || !isNullableString(value.available_version)
    || !isNullableString(value.release_name)
    || !isNullableString(value.release_date)
    || !isNullableString(value.release_notes)
    || !isNullableString(value.checked_at)
    || !isNullableString(value.error_message)
    || !isNullableString(value.support_reason)
    || !isNullableString(value.next_automatic_check_at)
    || typeof value.retryable !== 'boolean'
    || !isPreferences(value.preferences)
  ) {
    return false
  }
  if (
    value.error_code !== null
    && (
      typeof value.error_code !== 'string'
      || !updateErrorCodes.has(value.error_code as UpdateErrorCode)
    )
  ) {
    return false
  }
  return value.progress === null || isProgress(value.progress)
}

function parseAction(value: unknown): DevelopmentUpdateSimulationAction | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }
  if (
    value.type === 'check'
    || value.type === 'download'
    || value.type === 'cancel_download'
    || value.type === 'install_boundary'
  ) {
    return { type: value.type }
  }
  if (value.type !== 'set_preferences' || !isRecord(value.patch)) {
    return null
  }
  const patch: UpdatePreferencesPatch = {}
  if (typeof value.patch.automatic_check === 'boolean') {
    patch.automatic_check = value.patch.automatic_check
  }
  if (typeof value.patch.automatic_download === 'boolean') {
    patch.automatic_download = value.patch.automatic_download
  }
  if (
    value.patch.check_interval === 'startup'
    || value.patch.check_interval === 'daily'
    || value.patch.check_interval === 'weekly'
  ) {
    patch.check_interval = value.patch.check_interval
  }
  return { type: 'set_preferences', patch }
}

function isPreferences(value: unknown) {
  return (
    isRecord(value)
    && typeof value.automatic_check === 'boolean'
    && typeof value.automatic_download === 'boolean'
    && (
      value.check_interval === 'startup'
      || value.check_interval === 'daily'
      || value.check_interval === 'weekly'
    )
    && isNullableString(value.last_checked_at)
    && isSafeNonNegativeInteger(value.revision)
  )
}

function isProgress(value: unknown) {
  return (
    isRecord(value)
    && typeof value.percent === 'number'
    && isFiniteNonNegative(value.percent)
    && value.percent <= 100
    && isFiniteNonNegative(value.transferred)
    && isFiniteNonNegative(value.total)
    && isFiniteNonNegative(value.bytes_per_second)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNullableString(value: unknown) {
  return value === null || typeof value === 'string'
}

function isSafeNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isFiniteNonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function cloneSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  return {
    ...snapshot,
    preferences: { ...snapshot.preferences },
    progress: snapshot.progress ? { ...snapshot.progress } : null,
  }
}

function noOperationChannel(): DevelopmentUpdateSimulationChannel {
  return {
    publish: () => undefined,
    requestAction: () => Promise.reject(
      new Error('development_update_simulation_channel_unavailable'),
    ),
    requestSnapshot: () => undefined,
    close: () => undefined,
  }
}
