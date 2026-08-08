import { Skeleton } from 'antd'
import type { ReactNode } from 'react'
import styles from './WorkspaceDetectionLoading.module.scss'

interface WorkspaceDetectionLoadingProps {
  icon: ReactNode
  label: string
}

export function WorkspaceDetectionLoading({ icon, label }: WorkspaceDetectionLoadingProps) {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={styles.card}>
        <span>{icon}{label}</span>
        <Skeleton active title={false} paragraph={{ rows: 4 }} />
      </div>
    </div>
  )
}
