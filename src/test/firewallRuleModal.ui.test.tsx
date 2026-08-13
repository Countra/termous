import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createFirewallRuleInput } from '../features/firewall/model/firewallUtils'
import { FirewallRuleModal } from '../features/firewall/ui/FirewallRuleModal'

const t = (key: string) => key

describe('防火墙规则弹窗模式合同', () => {
  it('由显式 mode 映射模式标识和主操作', () => {
    const commonProps = {
      open: true,
      value: createFirewallRuleInput(),
      busy: false,
      t,
      onChange: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: vi.fn(),
    }
    const view = render(
      <FirewallRuleModal
        {...commonProps}
        mode="create"
        title="workbench.firewall.editor.ruleTitle"
      />,
    )

    const createContext = document.querySelector('[data-editor-mode="create"]')
    expect(createContext).toHaveTextContent('workbench.firewall.editor.ruleTitle')
    expect(createContext).toHaveTextContent('app.add')
    expect(screen.getByRole('button', { name: 'app.create' })).toBeInTheDocument()

    view.rerender(
      <FirewallRuleModal
        {...commonProps}
        mode="edit"
        title="workbench.firewall.editor.ruleTitle"
      />,
    )

    const editContext = document.querySelector('[data-editor-mode="edit"]')
    expect(editContext).toHaveTextContent('workbench.firewall.editor.ruleTitle')
    expect(editContext).toHaveTextContent('app.edit')
    expect(screen.getByRole('button', { name: 'workbench.firewall.editor.save' })).toBeInTheDocument()
  })
})
