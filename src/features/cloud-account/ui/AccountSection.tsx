import type { ReactNode } from 'react'
import { Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import styles from './CloudAccount.module.scss'

interface Props {
  title: string
  icon: ReactNode
  description?: string
  extra?: ReactNode
  children: ReactNode
}

export function AccountSection({ title, icon, description, extra, children }: Props) {
  return <section className={styles.surface} aria-label={title}>
    <header className={styles['section-header']}>
      <div className={styles['section-heading']}>
        <span className={styles['section-icon']} aria-hidden="true">{icon}</span>
        <div><h2>{title}</h2>{description ? <p className={styles.hint}>{description}</p> : null}</div>
      </div>
      {extra ? <div className={styles.actions}>{extra}</div> : null}
    </header>
    <div className={styles['section-body']}>{children}</div>
  </section>
}

export function AccountLoading({ label }: { label?: string } = {}) {
  const { t } = useTranslation()
  return <div className={styles.loading} role="status" aria-label={label ?? t('cloud.loading')}>
    <Skeleton active title={false} paragraph={{ rows: 2 }} />
  </div>
}
