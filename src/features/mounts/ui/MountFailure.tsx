import { Popover } from 'antd'
import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MountFailure as Failure } from '#entities/mount'
import styles from './Mounts.module.scss'

export function MountFailure({ failure, startup = false }: { failure: Failure; startup?: boolean }) {
  const { t, i18n } = useTranslation()
  const date = new Date(failure.at)
  return <Popover trigger="click" placement="bottom" arrow={false}
    classNames={{ root: styles['failure-popover'], container: styles['failure-popover-surface'] }}
    content={<div className={styles['failure-panel']}>
      <div className={styles['failure-heading']}>
        <span className={styles['failure-icon']}><AlertCircle size={17} aria-hidden="true" /></span>
        <strong>{t(startup ? 'mounts.autoStartFailed' : 'mounts.failureDetails')}</strong>
      </div>
      <div className={styles['failure-body']}>
        <span>{t('mounts.failureMessage')}</span>
        <p>{failure.message}</p>
      </div>
      {failure.at ? <div className={styles['failure-time']}>
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
