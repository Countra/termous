import type { ReactNode } from 'react'

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
  return (
    <div className={['workbench-empty-state', `is-${tone}`, className].filter(Boolean).join(' ')}>
      <span className="workbench-empty-state-icon">{icon}</span>
      <strong>{title}</strong>
      {description ? <span className="workbench-empty-state-description">{description}</span> : null}
      {action ? <span className="workbench-empty-state-action">{action}</span> : null}
    </div>
  )
}
