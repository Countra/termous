import { Plus } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectionActionButton } from './ConnectionActionButton'
import styles from './ConnectionEmptyState.module.scss'

interface ConnectionEmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  onConnect?: () => void
  disabled?: boolean
}

export function ConnectionEmptyState({ icon, title, description, onConnect, disabled }: ConnectionEmptyStateProps) {
  const { t } = useTranslation()
  const titleId = useId()

  return (
    <div className={styles.root}>
      <div className={styles.viewport}>
        <section className={styles.content} aria-labelledby={titleId}>
          <span className={styles.icon} aria-hidden="true">{icon}</span>
          <h2 id={titleId} className={styles.title}>{title}</h2>
          <p className={styles.description}>{description}</p>
          {onConnect && (
            <ConnectionActionButton
              className={styles.action}
              icon={<Plus size={14} aria-hidden="true" />}
              disabled={disabled}
              onClick={onConnect}
            >
              {t('app.newConnection')}
            </ConnectionActionButton>
          )}
        </section>
      </div>
    </div>
  )
}
