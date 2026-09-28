import type { ReactNode } from 'react'
import styles from './SessionTabs.module.scss'

export function SessionTabMenuItem({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <span className={styles['terminal-tab-menu-item']}>
      <span className={styles['terminal-tab-menu-icon']}>{icon}</span>
      <span className={styles['terminal-tab-menu-label']}>{title}</span>
    </span>
  )
}
