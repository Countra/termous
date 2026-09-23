import { Popover } from 'antd'
import { AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MountFailure as Failure } from '#entities/mount'
import styles from './Mounts.module.scss'

export function MountFailure({ failure, startup = false }: { failure: Failure; startup?: boolean }) {
  const { t, i18n } = useTranslation()
  const date = new Date(failure.at)
  return <Popover trigger={['click']} placement="bottomLeft" title={t(startup ? 'mounts.autoStartFailed' : 'mounts.failure')}
    content={<div className={styles.failure}><time dateTime={failure.at}>{Number.isNaN(date.getTime()) ? failure.at : date.toLocaleString(i18n.language, { hour12: false })}</time><p>{failure.message}</p></div>}>
    <ButtonLabel label={t(startup ? 'mounts.autoStartBadge' : 'mounts.failure')} />
  </Popover>
}

function ButtonLabel({ label, ...props }: React.ComponentProps<'button'> & { label: string }) {
  return <button {...props} type="button" className={styles['failure-badge']}><AlertCircle size={14} aria-hidden="true" />{label}</button>
}
