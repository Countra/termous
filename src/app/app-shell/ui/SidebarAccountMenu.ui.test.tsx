import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import { SidebarAccountMenu } from './SidebarAccountMenu'

beforeAll(async () => { await changeLanguage('zh-CN') })

test.each([false, true])('用户入口折叠状态 %s 使用统一用户名提示，打开菜单后收起提示', async (collapsed) => {
  const user = userEvent.setup()
  render(<SidebarAccountMenu identity={{ authenticated: true, name: 'Synthetic' }} collapsed={collapsed} active={false} onAccount={vi.fn()} onSettings={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: 'Synthetic · 账号与设置' })
  expect(trigger).not.toHaveAttribute('title')
  await user.hover(trigger)
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip).toHaveTextContent('Synthetic')
  expect(tooltip.closest('.ant-tooltip')).toHaveClass('termous-tooltip')
  await user.click(trigger)
  expect(await screen.findByRole('menu')).toBeInTheDocument()
  // jsdom 不派发动画结束事件，需要等待 Antd 的关闭动画兜底计时。
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(), { timeout: 1800 })
})

test('本地入口菜单使用底栏完整宽度，提供登录和设置', async () => {
  const onSettings = vi.fn()
  render(<SidebarAccountMenu collapsed={false} active={false} getPopupWidth={() => 214} onAccount={vi.fn()} onSettings={onSettings} />)
  const button = screen.getByRole('button', { name: '本地 · 账号与设置' })
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ width: 170 } as DOMRect)
  fireEvent.click(button)
  const menu = await screen.findByRole('menu')
  expect(menu.closest('.ant-dropdown')).toHaveStyle({ width: '214px' })
  expect(within(menu).getByRole('menuitem', { name: '登录账号' })).toBeInTheDocument()
  fireEvent.click(within(menu).getByRole('menuitem', { name: '设置' }))
  expect(onSettings).toHaveBeenCalledTimes(1)
  expect(button).toHaveAttribute('aria-expanded', 'false')
})

test('登录资料即时显示，菜单直接定位账号页签，退出后不保留旧身份', async () => {
  const onAccount = vi.fn()
  const props = { collapsed: false, active: false, onAccount, onSettings: vi.fn() }
  const identity = { authenticated: true, name: 'Synthetic', email: 'fixture@example.test', avatar: 'data:image/png;base64,c3ludGhldGlj' }
  const view = render(<SidebarAccountMenu {...props} identity={identity} />)
  fireEvent.click(screen.getByRole('button', { name: 'Synthetic · 账号与设置' }))
  expect(await screen.findByText('fixture@example.test')).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '个人资料' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Synthetic · 个人资料' }))
  expect(onAccount).toHaveBeenLastCalledWith('profile')
  const profileTrigger = screen.getByRole('button', { name: 'Synthetic · 账号与设置' })
  expect(profileTrigger).toHaveAttribute('aria-expanded', 'false')
  expect(document.activeElement).toBe(profileTrigger)
  fireEvent.click(profileTrigger)
  fireEvent.click(screen.getByRole('menuitem', { name: '云同步' }))
  expect(onAccount).toHaveBeenCalledWith('sync')
  const button = screen.getByRole('button', { name: 'Synthetic · 账号与设置' })
  fireEvent.click(button)
  fireEvent.click(await screen.findByRole('menuitem', { name: '安全' }))
  expect(onAccount).toHaveBeenLastCalledWith('security')
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(document.activeElement).toBe(button)
  view.rerender(<SidebarAccountMenu {...props} identity={{ ...identity, name: 'Updated' }} />)
  expect(screen.getByRole('button', { name: 'Updated · 账号与设置' })).toBeInTheDocument()
  view.rerender(<SidebarAccountMenu {...props} identity={{ authenticated: false }} />)
  expect(screen.getByRole('button', { name: '本地 · 账号与设置' })).toBeInTheDocument()
})

test('顶部用户入口通过 Enter 进入个人资料并阻止按键默认动作', async () => {
  const user = userEvent.setup()
  const onAccount = vi.fn()
  render(<SidebarAccountMenu identity={{ authenticated: true, name: 'Synthetic', email: 'fixture@example.test' }} collapsed={false} active={false} onAccount={onAccount} onSettings={vi.fn()} />)
  const button = screen.getByRole('button', { name: 'Synthetic · 账号与设置' })
  button.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true))
  const profile = screen.getByRole('menuitem', { name: 'Synthetic · 个人资料' })
  profile.focus()
  expect(fireEvent.keyDown(profile, { key: 'Enter', keyCode: 13, which: 13 })).toBe(false)
  await waitFor(() => expect(onAccount).toHaveBeenCalledExactlyOnceWith('profile'))
  await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'))
  expect(document.activeElement).toBe(button)
})

test('折叠入口可通过键盘打开菜单并用 Escape 返回焦点', async () => {
  const user = userEvent.setup()
  render(<SidebarAccountMenu collapsed active={false} onAccount={vi.fn()} onSettings={vi.fn()} />)
  const button = screen.getByRole('button', { name: '本地 · 账号与设置' })
  button.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true))
  expect(screen.getByRole('menu').closest('.ant-dropdown')).toHaveStyle({ width: '236px' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(button).toHaveAttribute('aria-expanded', 'false'))
  expect(document.activeElement).toBe(button)
})
