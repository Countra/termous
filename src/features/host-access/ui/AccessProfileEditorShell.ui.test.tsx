import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccessProfileEditorShell } from './AccessProfileEditorShell.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function callbacks() {
  return {
    onBack: vi.fn(),
    onDiscard: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
  }
}

describe('AccessProfileEditorShell', () => {
  it('新增模式只呈现统一新增语义，不伪造已同步状态或说明行', () => {
    const actions = callbacks()
    const view = render(
      <AccessProfileEditorShell
        mode="create"
        title="Primary SSH"
        icon={<span>SSH</span>}
        dirty={false}
        busy={false}
        saveDisabled
        {...actions}
      >
        <div>editor-content</div>
      </AccessProfileEditorShell>,
    )

    const modeContext = view.container.querySelector('[data-editor-mode="create"]')
    expect(modeContext).toHaveTextContent('Primary SSH')
    expect(modeContext).toHaveTextContent('app.add')
    expect(screen.getByRole('heading', { name: 'Primary SSH' })).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(view.container.querySelector('.management-panel-header p')).not.toBeInTheDocument()
    expect(screen.getByText('editor-content')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'app.delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'hosts.discard' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.create' })).toBeDisabled()
  })

  it('编辑模式保留可选说明、同步状态和完整操作回调', () => {
    const actions = callbacks()
    render(
      <AccessProfileEditorShell
        mode="edit"
        title="Primary SSH"
        subtitle="Reusable profile description"
        icon={<span>SSH</span>}
        dirty
        busy={false}
        saveDisabled={false}
        canDelete
        {...actions}
      >
        <div>editor-content</div>
      </AccessProfileEditorShell>,
    )

    const modeContext = document.querySelector('[data-editor-mode="edit"]') as HTMLElement
    expect(modeContext).toHaveTextContent('app.edit')
    expect(within(modeContext).getByRole('status')).toHaveTextContent('hosts.unsaved')
    expect(screen.getByText('Reusable profile description')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'hosts.access.backToProfiles' }))
    fireEvent.click(screen.getByRole('button', { name: 'hosts.discard' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.delete' }))

    expect(actions.onBack).toHaveBeenCalledTimes(1)
    expect(actions.onDiscard).toHaveBeenCalledTimes(1)
    expect(actions.onSave).toHaveBeenCalledTimes(1)
    expect(actions.onDelete).toHaveBeenCalledTimes(1)
  })

  it('忙碌状态禁用全部写入和导航操作，并保留错误反馈', () => {
    const actions = callbacks()
    render(
      <AccessProfileEditorShell
        mode="edit"
        title="Primary SSH"
        icon={<span>SSH</span>}
        dirty
        busy
        saveDisabled={false}
        error="save-failed"
        canDelete
        deleteDisabled
        {...actions}
      >
        <div>editor-content</div>
      </AccessProfileEditorShell>,
    )

    expect(screen.getByText('save-failed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'hosts.access.backToProfiles' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'hosts.discard' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /app\.save/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'app.delete' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'hosts.access.backToProfiles' }))
    fireEvent.click(screen.getByRole('button', { name: 'hosts.discard' }))
    fireEvent.click(screen.getByRole('button', { name: /app\.save/ }))
    fireEvent.click(screen.getByRole('button', { name: 'app.delete' }))
    expect(actions.onBack).not.toHaveBeenCalled()
    expect(actions.onDiscard).not.toHaveBeenCalled()
    expect(actions.onSave).not.toHaveBeenCalled()
    expect(actions.onDelete).not.toHaveBeenCalled()
  })
})
