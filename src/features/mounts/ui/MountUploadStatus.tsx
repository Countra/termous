import { useTranslation } from 'react-i18next'
import type { MountInstance } from '#entities/mount'
import { formatBytes } from '#shared/format'
import styles from './Mounts.module.scss'

export function MountUploadStatus({ uploads }: Pick<MountInstance, 'uploads'>) {
  const { t } = useTranslation()
  if (!uploads) return null
  const hasUploads = Boolean(uploads.active_files || uploads.finalizing_files || uploads.buffered_files || uploads.failed_files)
  const hasTermination = Boolean(uploads.stopping_files || uploads.cleaning_files || uploads.cleanup_failed_files)
  if (!hasUploads && !hasTermination) return null
  const reason = uploads.reason ?? 'unsupported'
  return <div className={styles['upload-status']} aria-label={t('mounts.upload.label')}>
    <div className={styles['upload-phases']}>
      {uploads.active_files > 0 ? <span>{t('mounts.upload.active', { count: uploads.active_files })}</span> : null}
      {uploads.finalizing_files > 0 ? <span>{t('mounts.upload.finalizing', { count: uploads.finalizing_files })}</span> : null}
      {(uploads.stopping_files ?? 0) > 0 ? <span>{t('mounts.upload.stopping', { count: uploads.stopping_files })}</span> : null}
      {(uploads.cleaning_files ?? 0) > 0 ? <span>{t('mounts.upload.cleaning', { count: uploads.cleaning_files })}</span> : null}
      {(uploads.cleanup_failed_files ?? 0) > 0 ? <span>{t('mounts.upload.cleanupFailed', { count: uploads.cleanup_failed_files })}</span> : null}
      {uploads.failed_files > 0 ? <span>{t('mounts.upload.failed', { count: uploads.failed_files })}</span> : null}
      {uploads.buffered_files > 0 ? <span>{t('mounts.upload.buffered', { count: uploads.buffered_files })}</span> : null}
    </div>
    {hasUploads ? <span>{t('mounts.upload.bytes', { transferred: formatBytes(uploads.transferred_bytes), pending: formatBytes(uploads.pending_bytes) })}</span> : null}
    {hasUploads && uploads.progress_kind ? <small>{t(`mounts.upload.basis.${uploads.progress_kind}`)}</small> : null}
    {uploads.buffered_files > 0 ? <small>{t(`mounts.upload.reasons.${reason}`, { defaultValue: t('mounts.upload.reasons.unsupported') })}</small> : null}
    {uploads.error ? <small>{uploads.error}</small> : null}
  </div>
}
