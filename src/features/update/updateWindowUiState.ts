import type { UpdateInstallConfirmation, UpdateRuntimeSummary } from '../../../electron/updateRuntime'
import type { UpdateWindowBootstrap, UpdateWindowLanguage } from '../../../electron/updateWindow'
import type {
  UpdateErrorCode,
  UpdateProgress,
  UpdateSnapshot,
} from '../../../electron/updateTypes'

export type UpdateWindowPrimaryAction =
  | 'check'
  | 'download'
  | 'cancel'
  | 'install'
  | 'retry_download'
  | 'retry_install'
  | 'none'

export type UpdateWindowBusyAction =
  | UpdateWindowPrimaryAction
  | 'prepare'
  | 'close'
  | null

const installErrorCodes = new Set<UpdateErrorCode>([
  'UPDATE_CORE_SHUTDOWN_FAILED',
  'UPDATE_INSTALL_SUMMARY_STALE',
  'UPDATE_INSTALL_START_FAILED',
])

const retryableDownloadErrorCodes = new Set<UpdateErrorCode>([
  'UPDATE_DOWNLOAD_FAILED',
  'UPDATE_DOWNLOAD_CANCELED',
  'UPDATE_CANCEL_FAILED',
  'UPDATE_HASH_MISMATCH',
])

export function mergeUpdateWindowBootstrap(
  current: UpdateWindowBootstrap<UpdateSnapshot>,
  incoming: UpdateWindowBootstrap<UpdateSnapshot>,
): UpdateWindowBootstrap<UpdateSnapshot> {
  const useIncomingBootstrap = incoming.bootstrap_seq >= current.bootstrap_seq
  const incomingBootstrapIsNewer = incoming.bootstrap_seq > current.bootstrap_seq
  return {
    bootstrap_seq: useIncomingBootstrap
      ? incoming.bootstrap_seq
      : current.bootstrap_seq,
    language: useIncomingBootstrap ? incoming.language : current.language,
    snapshot: mergeUpdateWindowSnapshot(
      current.snapshot,
      incoming.snapshot,
      incomingBootstrapIsNewer,
    ),
    theme: useIncomingBootstrap ? incoming.theme : current.theme,
  }
}

export function mergeUpdateWindowSnapshot(
  current: UpdateSnapshot,
  incoming: UpdateSnapshot,
  allowEqualSequence = false,
): UpdateSnapshot {
  if (incoming.state_seq < current.state_seq) {
    return current
  }
  if (
    incoming.state_seq === current.state_seq
    && !allowEqualSequence
    && !(current.state_seq === 0 && current.current_version === '')
  ) {
    return current
  }
  if (
    incoming.operation_generation !== current.operation_generation
    || !incoming.progress
    || !current.progress
    || (incoming.phase !== 'downloading' && incoming.phase !== 'downloaded')
  ) {
    return cloneSnapshot(incoming)
  }
  return {
    ...incoming,
    progress: mergeMonotonicProgress(current.progress, incoming.progress),
    preferences: { ...incoming.preferences },
  }
}

export function resolveUpdateWindowPrimaryAction(
  snapshot: UpdateSnapshot,
): UpdateWindowPrimaryAction {
  switch (snapshot.phase) {
    case 'idle':
    case 'up_to_date':
      return 'check'
    case 'available':
      return 'download'
    case 'downloading':
      return 'cancel'
    case 'downloaded':
      return 'install'
    case 'error':
      if (snapshot.error_code && installErrorCodes.has(snapshot.error_code)) {
        return snapshot.retryable ? 'retry_install' : 'none'
      }
      if (
        snapshot.retryable
        && snapshot.available_version
        && snapshot.error_code
        && retryableDownloadErrorCodes.has(snapshot.error_code)
      ) {
        return 'retry_download'
      }
      return snapshot.retryable ? 'check' : 'none'
    case 'unsupported':
      return 'none'
    default:
      return 'none'
  }
}

export function resolveUpdateWindowVisiblePrimaryAction(
  snapshot: UpdateSnapshot,
  busyAction: UpdateWindowBusyAction,
): UpdateWindowPrimaryAction {
  const primaryAction = resolveUpdateWindowPrimaryAction(snapshot)
  if (
    busyAction
    && busyAction !== 'prepare'
    && busyAction !== 'close'
  ) {
    if (
      primaryAction === 'cancel'
      && (busyAction === 'download' || busyAction === 'retry_download')
    ) {
      return 'cancel'
    }
    return busyAction
  }
  if (primaryAction !== 'none') {
    return primaryAction
  }
  if (snapshot.phase === 'checking') {
    return 'check'
  }
  if (snapshot.phase === 'preparing_install' || snapshot.phase === 'installing') {
    return 'install'
  }
  return 'none'
}

export function isUpdateWindowPrimaryActionBlocked(
  action: UpdateWindowPrimaryAction,
  busyAction: UpdateWindowBusyAction,
) {
  return Boolean(
    busyAction
    && !(
      action === 'cancel'
      && (busyAction === 'download' || busyAction === 'retry_download')
    ),
  )
}

export function isInstallConfirmationCurrent(
  confirmation: UpdateInstallConfirmation | null,
  snapshot: UpdateSnapshot,
) {
  return Boolean(
    confirmation
    && confirmation.state_seq === snapshot.state_seq
    && confirmation.operation_generation === snapshot.operation_generation
    && canPrepareUpdateInstall(snapshot),
  )
}

export function canPrepareUpdateInstall(snapshot: UpdateSnapshot) {
  return (
    snapshot.phase === 'downloaded'
    || (
      snapshot.phase === 'error'
      && snapshot.retryable
      && Boolean(snapshot.error_code && installErrorCodes.has(snapshot.error_code))
    )
  )
}

export function summarizeRuntimeImpact(summary: UpdateRuntimeSummary) {
  return (
    summary.ssh_sessions
    + summary.file_sessions
    + summary.forwards
    + summary.transfers
  )
}

export function calculateUpdateEta(progress: UpdateProgress | null) {
  if (
    !progress
    || progress.bytes_per_second <= 0
    || progress.total <= 0
    || progress.transferred >= progress.total
  ) {
    return null
  }
  return Math.max(
    1,
    Math.ceil((progress.total - progress.transferred) / progress.bytes_per_second),
  )
}

export function formatUpdateBytes(
  value: number | null | undefined,
  language: UpdateWindowLanguage,
) {
  const bytes = finiteNonNegative(value)
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = bytes
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  const maximumFractionDigits = unitIndex === 0 || amount >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(language, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(amount)} ${units[unitIndex]}`
}

export function formatUpdateDuration(
  secondsInput: number | null,
  language: UpdateWindowLanguage,
) {
  if (secondsInput === null || !Number.isFinite(secondsInput) || secondsInput < 0) {
    return '-'
  }
  const seconds = Math.ceil(secondsInput)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  if (language === 'zh-CN') {
    return [
      hours > 0 ? `${hours} 小时` : '',
      minutes > 0 ? `${minutes} 分` : '',
      hours === 0 && remainder > 0 ? `${remainder} 秒` : '',
    ].filter(Boolean).join(' ') || '0 秒'
  }
  return [
    hours > 0 ? `${hours}h` : '',
    minutes > 0 ? `${minutes}m` : '',
    hours === 0 && remainder > 0 ? `${remainder}s` : '',
  ].filter(Boolean).join(' ') || '0s'
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
    progress: snapshot.progress ? { ...snapshot.progress } : null,
  }
}

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}
