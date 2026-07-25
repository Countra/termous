import { CircleAlert, CircleCheck, Clock3, Download, LoaderCircle } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import type {
  UpdateErrorCode,
  UpdatePhase,
  UpdatePreferences,
  UpdateSnapshot,
} from '../../../electron/updateTypes'
import type { AppBuildInfo } from '../../types/domain'

export const RELEASES_URL = 'https://github.com/Countra/termous/releases'

export type UpdatePreferenceKey = 'automatic_check' | 'check_interval' | 'automatic_download'
export type PendingPreferenceValues = Partial<Pick<UpdatePreferences, UpdatePreferenceKey>>
export type UpdateWindowIntent = 'inspect' | 'start_download'

export interface UpdateStatusPresentation {
  label: string
  tone: 'muted' | 'progress' | 'success' | 'available' | 'error'
  icon: ReactNode
}

export function resolveUpdatePhase(
  snapshot: UpdateSnapshot | null,
  runtimeAvailable: boolean,
  buildInfo: AppBuildInfo | null,
): UpdatePhase {
  if (!runtimeAvailable || buildInfo?.update_supported === false) {
    return 'unsupported'
  }
  return snapshot?.phase ?? 'idle'
}

export function updateStatusPresentation(
  phase: UpdatePhase,
  t: TFunction,
): UpdateStatusPresentation {
  switch (phase) {
    case 'unsupported':
      return {
        label: t('settings.about.statusUnsupported'),
        tone: 'muted',
        icon: <CircleAlert size={14} aria-hidden="true" />,
      }
    case 'checking':
      return {
        label: t('settings.about.statusChecking'),
        tone: 'progress',
        icon: <LoaderCircle className="about-update-spin" size={14} aria-hidden="true" />,
      }
    case 'up_to_date':
      return {
        label: t('settings.about.statusUpToDate'),
        tone: 'success',
        icon: <CircleCheck size={14} aria-hidden="true" />,
      }
    case 'available':
      return {
        label: t('settings.about.statusAvailable'),
        tone: 'available',
        icon: <Download size={14} aria-hidden="true" />,
      }
    case 'downloading':
      return {
        label: t('settings.about.statusDownloading'),
        tone: 'progress',
        icon: <LoaderCircle className="about-update-spin" size={14} aria-hidden="true" />,
      }
    case 'downloaded':
      return {
        label: t('settings.about.statusDownloaded'),
        tone: 'success',
        icon: <CircleCheck size={14} aria-hidden="true" />,
      }
    case 'preparing_install':
      return {
        label: t('settings.about.statusPreparingInstall'),
        tone: 'progress',
        icon: <LoaderCircle className="about-update-spin" size={14} aria-hidden="true" />,
      }
    case 'installing':
      return {
        label: t('settings.about.statusInstalling'),
        tone: 'progress',
        icon: <LoaderCircle className="about-update-spin" size={14} aria-hidden="true" />,
      }
    case 'error':
      return {
        label: t('settings.about.statusError'),
        tone: 'error',
        icon: <CircleAlert size={14} aria-hidden="true" />,
      }
    default:
      return {
        label: t('settings.about.statusIdle'),
        tone: 'muted',
        icon: <Clock3 size={14} aria-hidden="true" />,
      }
  }
}

export function updateErrorLabel(errorCode: UpdateErrorCode | null, t: TFunction) {
  switch (errorCode) {
    case 'UPDATE_UNSUPPORTED':
      return t('settings.about.updateErrorUnsupported')
    case 'UPDATE_CHECK_FAILED':
      return t('settings.about.updateErrorCheckFailed')
    case 'UPDATE_METADATA_INVALID':
      return t('settings.about.updateErrorMetadataInvalid')
    case 'UPDATE_ASSET_NOT_FOUND':
      return t('settings.about.updateErrorAssetNotFound')
    case 'UPDATE_DOWNLOAD_FAILED':
      return t('settings.about.updateErrorDownloadFailed')
    case 'UPDATE_DOWNLOAD_CANCELED':
      return t('settings.about.updateErrorDownloadCanceled')
    case 'UPDATE_CANCEL_FAILED':
      return t('settings.about.updateErrorCancelFailed')
    case 'UPDATE_HASH_MISMATCH':
      return t('settings.about.updateErrorHashMismatch')
    case 'UPDATE_SIGNATURE_INVALID':
      return t('settings.about.updateErrorSignatureInvalid')
    case 'UPDATE_CORE_SHUTDOWN_FAILED':
      return t('settings.about.updateErrorCoreShutdownFailed')
    case 'UPDATE_INSTALL_START_FAILED':
      return t('settings.about.updateErrorInstallStartFailed')
    default:
      return t('settings.about.updateErrorUnknown')
  }
}

export function isPreferencePending(
  values: PendingPreferenceValues,
  key: UpdatePreferenceKey,
) {
  return Object.prototype.hasOwnProperty.call(values, key)
}

export function formatVersion(version: string) {
  const normalized = version.trim()
  return normalized.startsWith('v') ? normalized : `v${normalized}`
}

export function formatPlatform(platform: string) {
  switch (platform) {
    case 'win32':
      return 'Windows'
    case 'darwin':
      return 'macOS'
    case 'linux':
      return 'Linux'
    default:
      return platform
  }
}

export function formatDateTime(
  value: string | null,
  locale: string,
  fallback: string,
) {
  if (!value) {
    return fallback
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return fallback
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}
