import type { ReactNode } from 'react'
import styles from './WorkspaceEmptyState.module.scss'

interface WorkspaceEmptyStateProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  tone?: 'neutral' | 'warning' | 'danger'
  className?: string
}

export function WorkspaceEmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
  className,
}: WorkspaceEmptyStateProps) {
  const toneClassName = tone === 'neutral' ? '' : styles[`is-${tone}`]

  return (
    <div
      className={[
        styles['workbench-empty-state'],
        toneClassName,
        'workbench-empty-state',
        `is-${tone}`,
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className={`${styles['workbench-empty-state-icon']} workbench-empty-state-icon`}>{icon}</span>
      <strong>{title}</strong>
      {description ? (
        <span className={`${styles['workbench-empty-state-description']} workbench-empty-state-description`}>
          {description}
        </span>
      ) : null}
      {action ? (
        <span className={`${styles['workbench-empty-state-action']} workbench-empty-state-action`}>
          {action}
        </span>
      ) : null}
    </div>
  )
}
