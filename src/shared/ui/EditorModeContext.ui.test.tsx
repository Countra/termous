import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EditorModeContext } from './EditorModeContext'
import styles from './EditorModeContext.module.scss'

describe('EditorModeContext', () => {
  it('使用标题、图标和短文案呈现新增上下文', () => {
    const { container } = render(
      <EditorModeContext
        mode="create"
        label="新增"
        title={<h2>生产主机</h2>}
        className="custom-context"
      />,
    )

    const context = container.querySelector('[data-editor-mode="create"]')

    expect(context).toHaveClass(
      styles['editor-mode-context'],
      styles['is-create'],
      'custom-context',
    )
    expect(context).not.toHaveClass(styles['is-compact'], styles['is-mode-only'])
    expect(context).toHaveAttribute('data-editor-size', 'default')
    expect(screen.getByRole('heading', { name: '生产主机' })).toBeVisible()
    expect(screen.getByText('新增')).toHaveClass(styles['editor-mode-context-label'])
    expect(context?.querySelector('svg')).toHaveClass(
      styles['editor-mode-context-icon'],
      'lucide-plus',
    )
  })

  it('支持紧凑模式行并在重渲染后切换为编辑状态', () => {
    const view = render(
      <EditorModeContext mode="create" label="新增" size="compact" />,
    )

    const createContext = view.container.querySelector('[data-editor-mode="create"]')

    expect(createContext).toHaveClass(styles['is-create'], styles['is-compact'], styles['is-mode-only'])
    expect(createContext).toHaveAttribute('data-editor-size', 'compact')

    view.rerender(<EditorModeContext mode="edit" label="编辑" size="compact" />)

    const editContext = view.container.querySelector('[data-editor-mode="edit"]')

    expect(editContext).toHaveClass(styles['is-edit'], styles['is-compact'], styles['is-mode-only'])
    expect(editContext).not.toHaveClass(styles['is-create'])
    expect(editContext?.querySelector('svg')).toHaveClass('lucide-pencil')
    expect(screen.getByText('编辑')).toBeVisible()
    expect(screen.queryByText('新增')).not.toBeInTheDocument()
  })
})
