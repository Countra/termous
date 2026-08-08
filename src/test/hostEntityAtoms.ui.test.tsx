import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthMethodBadge } from '../entities/host/ui/AuthMethodBadge'
import authStyles from '../entities/host/ui/AuthMethodBadge.module.scss'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('antd', () => ({
  Tooltip: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <span data-tooltip-title={String(title)}>{children}</span>
  ),
}))

describe('主机实体原子组件样式合同', () => {
  it('认证方式保留完整与紧凑模式的 Module 和兼容类', () => {
    const view = render(<AuthMethodBadge method="password" />)
    const fullBadge = screen.getByLabelText('hosts.authMethod：hosts.auth.password')

    expect(fullBadge).toHaveClass(authStyles['host-auth-badge'], 'host-auth-badge')
    expect(screen.getByText('hosts.auth.password')).toHaveClass(
      authStyles['host-auth-badge-label'],
      'host-auth-badge-label',
    )
    expect(fullBadge.firstElementChild).toHaveClass(authStyles['host-auth-badge-icon'], 'host-auth-badge-icon')

    view.rerender(<AuthMethodBadge method="private_key" compact />)
    const compactBadge = screen.getByLabelText('hosts.authMethod：hosts.auth.private_key')

    expect(compactBadge).toHaveClass(
      authStyles['host-auth-badge'],
      authStyles['is-compact'],
      'host-auth-badge',
      'is-compact',
    )
    expect(compactBadge.parentElement).toHaveAttribute('data-tooltip-title', 'hosts.auth.private_key')
    expect(screen.queryByText('hosts.auth.private_key')).not.toBeInTheDocument()
  })
})
