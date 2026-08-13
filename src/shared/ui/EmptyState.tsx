import { Inbox } from 'lucide-react'
import styles from './EmptyState.module.scss'

interface EmptyStateProps {
  title: string
  description?: string
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className={`${styles['empty-state']} empty-state`}>
      <Inbox size={22} aria-hidden="true" />
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  )
}
