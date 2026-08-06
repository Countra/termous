import type { ReactNode } from 'react'
import styles from './TransferQueueDock.module.scss'
import rowStyles from './TransferQueueRows.module.scss'

interface TransferQueueDockProps {
  children: ReactNode
  className?: string
}

export function TransferQueueDock({ children, className }: TransferQueueDockProps) {
  return (
    <div className={[styles.root, rowStyles.root, className ?? ''].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
