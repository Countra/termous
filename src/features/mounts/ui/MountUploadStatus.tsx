import { useTranslation } from 'react-i18next'
import type { MountInstance } from '#entities/mount'
import { formatBytes } from '#shared/format'
import styles from './Mounts.module.scss'

export function MountUploadStatus({ uploads }: Pick<MountInstance, 'uploads'>) {
  const { t } = useTranslation()
  if (!uploads || !(uploads.active_files || uploads.finalizing_files || uploads.buffered_files || uploads.failed_files)) return null
  const reason = uploads.reason ?? 'unsupported'
  return <div className={styles['upload-status']} aria-label={t('mounts.upload.label')}>
    <div className={styles['upload-phases']}>
      {uploads.active_files > 0 ? <span>{t('mounts.upload.active', { count: uploads.active_files })}</span> : null}
      {uploads.finalizing_files > 0 ? <span>{t('mounts.upload.finalizing', { count: uploads.finalizing_files })}</span> : null}
      {uploads.failed_files > 0 ? <span>{t('mounts.upload.failed', { count: uploads.failed_files })}</span> : null}
      {uploads.buffered_files > 0 ? <span>{t('mounts.upload.buffered', { count: uploads.buffered_files })}</span> : null}
    </div>
    <span>{t('mounts.upload.bytes', { transferred: formatBytes(uploads.transferred_bytes), pending: formatBytes(uploads.pending_bytes) })}</span>
    {uploads.progress_kind ? <small>{t(`mounts.upload.basis.${uploads.progress_kind}`)}</small> : null}
    {uploads.buffered_files > 0 ? <small>{t(`mounts.upload.reasons.${reason}`, { defaultValue: t('mounts.upload.reasons.unsupported') })}</small> : null}
  </div>
}
