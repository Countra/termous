import type {
  UpdateErrorCode,
  UpdatePreferences,
  UpdateProgress,
  UpdateSnapshot,
} from '../../../electron/updateTypes'

export type UpdateNotificationType = 'available' | 'downloaded'

export interface UpdateNotificationEvent {
  type: UpdateNotificationType
  version: string
}

export type GlobalUpdateStatusKind =
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface GlobalUpdateStatus {
  kind: GlobalUpdateStatusKind
  progressPercent: number | null
  version: string | null
}

const actionableErrorCodes = new Set<UpdateErrorCode>([
  'UPDATE_DOWNLOAD_FAILED',
  'UPDATE_CANCEL_FAILED',
  'UPDATE_HASH_MISMATCH',
  'UPDATE_SIGNATURE_INVALID',
  'UPDATE_CORE_SHUTDOWN_FAILED',
  'UPDATE_INSTALL_START_FAILED',
])

export function mergeUpdateRuntimeSnapshot(
  current: UpdateSnapshot | null,
  incoming: UpdateSnapshot,
): UpdateSnapshot {
  if (!current) {
    return cloneSnapshot(incoming)
  }

  const preferences = mergeUpdatePreferencesByRevision(
    current.preferences,
    incoming.preferences,
  )
  if (incoming.state_seq < current.state_seq) {
    if (preferences === current.preferences) {
      return current
    }
    return {
      ...current,
      preferences,
    }
  }

  const progress = shouldMergeProgress(current, incoming)
    ? mergeMonotonicProgress(current.progress!, incoming.progress!)
    : cloneProgress(incoming.progress)

  return {
    ...incoming,
    preferences,
    progress,
  }
}

export function mergeUpdatePreferencesByRevision(
  current: UpdatePreferences,
  incoming: UpdatePreferences,
) {
  return incoming.revision > current.revision
    ? { ...incoming }
    : current
}

export function selectUpdateNotification(
  snapshot: UpdateSnapshot | null,
): UpdateNotificationEvent | null {
  const version = snapshot?.available_version?.trim()
  if (!snapshot || !version) {
    return null
  }
  if (snapshot.phase === 'available' || snapshot.phase === 'downloaded') {
    return {
      type: snapshot.phase,
      version,
    }
  }
  return null
}

export function updateNotificationStorageKey(event: UpdateNotificationEvent) {
  return `termous.update.notification:${event.type}:${encodeURIComponent(event.version)}`
}

export function resolveGlobalUpdateStatus(
  snapshot: UpdateSnapshot | null,
): GlobalUpdateStatus | null {
  if (!snapshot) {
    return null
  }
  if (snapshot.phase === 'available' || snapshot.phase === 'downloaded') {
    return {
      kind: snapshot.phase,
      progressPercent: null,
      version: snapshot.available_version,
    }
  }
  if (snapshot.phase === 'downloading') {
    return {
      kind: 'downloading',
      progressPercent: normalizedPercent(snapshot.progress?.percent),
      version: snapshot.available_version,
    }
  }
  if (
    snapshot.phase === 'error'
    && snapshot.error_code
    && actionableErrorCodes.has(snapshot.error_code)
  ) {
    return {
      kind: 'error',
      progressPercent: null,
      version: snapshot.available_version,
    }
  }
  return null
}

function shouldMergeProgress(
  current: UpdateSnapshot,
  incoming: UpdateSnapshot,
) {
  return (
    current.operation_generation === incoming.operation_generation
    && Boolean(current.progress)
    && Boolean(incoming.progress)
    && (incoming.phase === 'downloading' || incoming.phase === 'downloaded')
  )
}

function mergeMonotonicProgress(
  current: UpdateProgress,
  incoming: UpdateProgress,
): UpdateProgress {
  const transferred = Math.max(
    finiteNonNegative(current.transferred),
    finiteNonNegative(incoming.transferred),
  )
  const total = Math.max(
    finiteNonNegative(current.total),
    finiteNonNegative(incoming.total),
    transferred,
  )
  const calculatedPercent = total > 0 ? (transferred / total) * 100 : 0
  return {
    percent: Math.min(100, Math.max(
      finiteNonNegative(current.percent),
      finiteNonNegative(incoming.percent),
      calculatedPercent,
    )),
    transferred,
    total,
    bytes_per_second: finiteNonNegative(incoming.bytes_per_second),
  }
}

function cloneSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  return {
    ...snapshot,
    preferences: { ...snapshot.preferences },
    progress: cloneProgress(snapshot.progress),
  }
}

function cloneProgress(progress: UpdateProgress | null) {
  return progress ? { ...progress } : null
}

function normalizedPercent(value: number | null | undefined) {
  return Math.min(100, Math.max(0, finiteNonNegative(value)))
}

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}
