import type { ReactNode } from 'react'

interface WorkbenchEmptyStateProps {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  tone?: 'neutral' | 'warning' | 'danger'
  className?: string
}

export function WorkbenchEmptyState({
  icon,
  title,
  description,
  tone = 'neutral',
  className,
}: WorkbenchEmptyStateProps) {
  return (
    <div className={['workbench-empty-state', `is-${tone}`, className].filter(Boolean).join(' ')}>
      <span className="workbench-empty-state-icon">{icon}</span>
      <strong>{title}</strong>
      {description ? <span className="workbench-empty-state-description">{description}</span> : null}
    </div>
  )
}
