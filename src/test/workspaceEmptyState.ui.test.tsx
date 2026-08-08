import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkspaceEmptyState } from '../shared/ui/WorkspaceEmptyState'
import styles from '../shared/ui/WorkspaceEmptyState.module.scss'

describe('WorkspaceEmptyState 样式合同', () => {
  it.each([
    ['neutral', ''],
    ['warning', styles['is-warning']],
    ['danger', styles['is-danger']],
  ] as const)('保留 %s tone 的兼容类并应用共置 Module', (tone, toneClassName) => {
    const { container } = render(
      <WorkspaceEmptyState
        icon={<span>图标</span>}
        title="状态标题"
        description="状态说明"
        action={<button type="button">重试</button>}
        tone={tone}
      />,
    )
    const root = container.firstElementChild

    expect(root).toHaveClass(styles['workbench-empty-state'], 'workbench-empty-state', `is-${tone}`)
    if (toneClassName) {
      expect(root).toHaveClass(toneClassName)
    }
    expect(screen.getByText('图标').parentElement).toHaveClass(
      styles['workbench-empty-state-icon'],
      'workbench-empty-state-icon',
    )
    expect(screen.getByText('状态说明')).toHaveClass(
      styles['workbench-empty-state-description'],
      'workbench-empty-state-description',
    )
    expect(screen.getByRole('button', { name: '重试' }).parentElement).toHaveClass(
      styles['workbench-empty-state-action'],
      'workbench-empty-state-action',
    )
  })

  it('省略可选节点并将自定义类保留在根节点', () => {
    const { container } = render(
      <WorkspaceEmptyState icon={<span>图标</span>} title={<span>状态标题</span>} className="consumer-empty-state" />,
    )

    expect(container.firstElementChild).toHaveClass('consumer-empty-state')
    expect(screen.queryByText('状态说明')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
