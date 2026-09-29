import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, expect, test, vi } from 'vitest'
import { changeLanguage } from '#shared/i18n'
import { SidebarAccountMenu } from './SidebarAccountMenu'

beforeAll(async () => { await changeLanguage('zh-CN') })

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
  fireEvent.click(screen.getByRole('menuitem', { name: '云同步' }))
  expect(onAccount).toHaveBeenCalledWith('sync')
  view.rerender(<SidebarAccountMenu {...props} identity={{ ...identity, name: 'Updated' }} />)
  expect(screen.getByRole('button', { name: 'Updated · 账号与设置' })).toBeInTheDocument()
  view.rerender(<SidebarAccountMenu {...props} identity={{ authenticated: false }} />)
  expect(screen.getByRole('button', { name: '本地 · 账号与设置' })).toBeInTheDocument()
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
