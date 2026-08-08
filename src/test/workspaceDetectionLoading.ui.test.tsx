import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkspaceDetectionLoading } from '../shared/ui/WorkspaceDetectionLoading'
import styles from '../shared/ui/WorkspaceDetectionLoading.module.scss'

describe('WorkspaceDetectionLoading 样式合同', () => {
  it('仅使用共置 Module 类并保留检测状态语义', () => {
    render(
      <WorkspaceDetectionLoading
        icon={<span aria-hidden="true">图标</span>}
        label="检测中"
      />,
    )

    const root = screen.getByRole('status')
    const card = root.firstElementChild

    expect(root).toHaveAttribute('aria-live', 'polite')
    expect(root).toHaveClass(styles.root)
    expect(root).not.toHaveClass('workbench-detection-loading')
    expect(card).toHaveClass(styles.card)
    expect(card).not.toHaveClass('workbench-detection-loading-card')
    expect(screen.getByText('检测中')).toBeInTheDocument()
  })
})
