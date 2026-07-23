import { Skeleton } from 'antd'
import type { ReactNode } from 'react'

interface WorkbenchDetectionLoadingProps {
  icon: ReactNode
  label: string
}

export function WorkbenchDetectionLoading({ icon, label }: WorkbenchDetectionLoadingProps) {
  return (
    <div className="workbench-detection-loading" role="status" aria-live="polite">
      <div className="workbench-detection-loading-card">
        <span>{icon}{label}</span>
        <Skeleton active title={false} paragraph={{ rows: 4 }} />
      </div>
    </div>
  )
}
