import { Tooltip } from 'antd'
import { ArrowUpFromLine, Clock3, Info, LoaderCircle, Pause, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MountInstance } from '#entities/mount'
import { formatBytes } from '#shared/format'
import styles from './Mounts.module.scss'

export function MountUploadStatus({ uploads }: Pick<MountInstance, 'uploads'>) {
  const { t } = useTranslation()
  if (!uploads) return null
  const hasUploads = Boolean(uploads.active_files || uploads.finalizing_files || uploads.buffered_files)
  const hasTermination = Boolean(uploads.stopping_files || uploads.cleaning_files)
  const hasBytes = uploads.accepted_bytes > 0 || uploads.transferred_bytes > 0 || uploads.pending_bytes > 0
  if (!hasUploads && !hasTermination && !hasBytes) return null
  const reason = uploads.reason ?? 'unsupported'
  const phases = [
    { key: 'active', count: uploads.active_files, icon: ArrowUpFromLine },
    { key: 'finalizing', count: uploads.finalizing_files, icon: LoaderCircle },
    { key: 'stopping', count: uploads.stopping_files, icon: Pause },
    { key: 'cleaning', count: uploads.cleaning_files, icon: RotateCw },
    { key: 'buffered', count: uploads.buffered_files, icon: Clock3 },
  ]
  const hasDetails = Boolean(uploads.progress_kind || uploads.buffered_files)
  return <div className={styles['upload-status']} aria-label={t('mounts.upload.label')}>
    {hasUploads || hasTermination ? <div className={styles['upload-phases']}>
      {phases.map(({ key, count, icon: Icon }) => (count ?? 0) > 0 ? <span key={key} className={styles['upload-phase']} data-phase={key}>
        <Icon size={13} aria-hidden="true" />{t(`mounts.upload.${key}`, { count })}
      </span> : null)}
    </div> : null}
    <div className={styles['upload-summary']}>
      <dl className={styles['upload-metrics']}>
        <div><dt>{t('mounts.upload.transferred')}</dt><dd>{formatBytes(uploads.transferred_bytes)}</dd></div>
        <div><dt>{t('mounts.upload.pending')}</dt><dd>{formatBytes(uploads.pending_bytes)}</dd></div>
      </dl>
      {hasDetails ? <Tooltip trigger={['hover', 'focus']} title={<div className={styles['upload-details']}>
        {uploads.progress_kind ? <p>{t(`mounts.upload.basis.${uploads.progress_kind}`)}</p> : null}
        {uploads.buffered_files > 0 ? <p>{t(`mounts.upload.reasons.${reason}`, { defaultValue: t('mounts.upload.reasons.unsupported') })}</p> : null}
      </div>}>
        <button type="button" className={styles['upload-info']} aria-label={t('mounts.upload.details')}><Info size={14} aria-hidden="true" /></button>
      </Tooltip> : null}
    </div>
  </div>
}
