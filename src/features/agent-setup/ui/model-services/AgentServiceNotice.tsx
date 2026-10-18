import type { ReactNode } from 'react'
import { Alert } from 'antd'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import styles from './AgentServiceNotice.module.scss'

export function AgentServiceNotice({ type = 'info', title, description, action, closable, showIcon = true }: {
  type?: 'info' | 'warning' | 'error'
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  closable?: boolean
  showIcon?: boolean
}) {
  const Icon = type === 'error' ? CircleAlert : type === 'warning' ? TriangleAlert : Info
  return (
    <Alert className={`${styles.notice} ${styles[type]}`} type={type}
      role={type === 'error' ? 'alert' : 'status'} showIcon={showIcon}
      icon={<Icon size={16} aria-hidden="true" />} closable={closable}
      title={title} description={description} action={action}
      classNames={{ icon: styles.icon, section: styles.copy, title: styles.title,
        description: styles.description, actions: styles.action }} />
  )
}
