import { Popover } from 'antd'
import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MountFailure as Failure, MountInstance } from '#entities/mount'
import styles from './Mounts.module.scss'

export function MountFailure({ failure, uploads, startup = false }: { failure?: Failure; uploads?: MountInstance['uploads']; startup?: boolean }) {
  const { t, i18n } = useTranslation()
  const hasUploadFailure = Boolean(uploads?.failed_files || uploads?.cleanup_failed_files || uploads?.error)
  if (!failure && !hasUploadFailure) return null
  const messages = [...new Set([failure?.message, uploads?.error].filter((message): message is string => Boolean(message)))]
  const date = failure?.at ? new Date(failure.at) : undefined
  return <Popover trigger="click" placement="bottom" arrow={false}
    classNames={{ root: styles['failure-popover'], container: styles['failure-popover-surface'] }}
    content={<div className={styles['failure-panel']}>
      <div className={styles['failure-heading']}>
        <span className={styles['failure-icon']}><AlertCircle size={17} aria-hidden="true" /></span>
        <strong>{t(startup ? 'mounts.autoStartFailed' : 'mounts.failureDetails')}</strong>
      </div>
      <div className={styles['failure-body']}>
        {uploads?.cleanup_failed_files || uploads?.failed_files ? <div className={styles['failure-summary']}>
          {(uploads?.cleanup_failed_files ?? 0) > 0 ? <strong>{t('mounts.upload.cleanupFailed', { count: uploads?.cleanup_failed_files })}</strong> : null}
          {(uploads?.failed_files ?? 0) > 0 ? <strong>{t('mounts.upload.failed', { count: uploads?.failed_files })}</strong> : null}
        </div> : null}
        {messages.length > 0 ? <span>{t('mounts.failureMessage')}</span> : null}
        {messages.map((message) => <p key={message}>{message}</p>)}
      </div>
      {failure?.at && date ? <div className={styles['failure-time']}>
        <span>{t('mounts.failureAt')}</span>
        <time dateTime={failure.at}>{Number.isNaN(date.getTime()) ? failure.at : date.toLocaleString(i18n.language, { hour12: false })}</time>
      </div> : null}
    </div>}>
    <ButtonLabel label={t(startup ? 'mounts.autoStartFailed' : 'mounts.failure')} />
  </Popover>
}

function ButtonLabel({ label, ...props }: React.ComponentProps<'button'> & { label: string }) {
  return <button {...props} type="button" className={styles['failure-badge']}><AlertCircle size={14} aria-hidden="true" />{label}</button>
}
