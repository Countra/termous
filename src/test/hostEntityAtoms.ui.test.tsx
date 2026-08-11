import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthMethodBadge } from '../entities/host/ui/AuthMethodBadge'
import authStyles from '../entities/host/ui/AuthMethodBadge.module.scss'
import { HostAvatar } from '../entities/host/ui/HostAvatar'
import avatarStyles from '../entities/host/ui/HostAvatar.module.scss'

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

  it('主机头像保留尺寸变量和自定义图标的 Module 状态类', () => {
    const view = render(<HostAvatar host={{ icon_id: '', name: '测试主机' }} size={36} />)
    const defaultAvatar = view.container.firstElementChild

    expect(defaultAvatar).toHaveClass(avatarStyles['host-avatar'], 'host-avatar', 'is-default-icon')
    expect(defaultAvatar).toHaveStyle({ '--host-avatar-size': '36px' })

    view.rerender(
      <HostAvatar
        host={{ icon_id: 'host-icon-1', name: '测试主机' }}
        getIconUrl={(iconId) => `/icons/${iconId}`}
        decorative={false}
      />,
    )

    const customImage = screen.getByRole('img', { name: '测试主机' })
    const customAvatar = customImage.parentElement
    expect(customAvatar).toHaveClass(
      avatarStyles['host-avatar'],
      avatarStyles['has-custom-icon'],
      'host-avatar',
      'has-custom-icon',
    )

    fireEvent.error(customImage)

    expect(customAvatar).toHaveClass(avatarStyles['host-avatar'], 'host-avatar', 'is-default-icon')
    expect(customAvatar).not.toHaveClass(avatarStyles['has-custom-icon'], 'has-custom-icon')
    expect(screen.queryByRole('img', { name: '测试主机' })).not.toBeInTheDocument()

    view.rerender(
      <HostAvatar
        host={{ icon_id: 'host-icon-1', name: '测试主机' }}
        getIconUrl={(iconId) => `/icons/${iconId}?sha256=next`}
        decorative={false}
        loading="lazy"
      />,
    )

    expect(screen.getByRole('img', { name: '测试主机' })).toHaveAttribute('loading', 'lazy')
    expect(screen.getByRole('img', { name: '测试主机' })).toHaveAttribute(
      'src',
      '/icons/host-icon-1?sha256=next',
    )
  })
})
