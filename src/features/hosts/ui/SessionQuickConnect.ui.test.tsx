import { ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { Host } from '#entities/host'
import { SessionQuickConnect } from './SessionQuickConnect'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const host: Host = {
  id: 'server', name: 'Production server', platform: 'linux', group_id: '',
  address: '2001:db8::10', port: 2202, username: 'deploy', auth_method: 'private_key',
  credential_id: 'credential', tags: [], favorite: true, fingerprint_policy: 'confirm_on_change',
  last_connected_at: '2026-10-16T00:00:00Z', note: 'Release server',
}

function renderMenu(options: { onConnect?: () => Promise<void>; actionBusy?: boolean } = {}) {
  const onConnect = vi.fn(options.onConnect ?? (async () => undefined))
  const onOpenLauncher = vi.fn()
  function Menu() {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    return <ConfigProvider theme={{ token: { motion: false, zIndexPopupBase: 3000 } }}>
      <SessionQuickConnect hosts={[host]} triggerLabel="new-ssh" open={open} query={query}
        actionBusy={options.actionBusy} onOpenLauncher={onOpenLauncher}
        onOpenChange={setOpen} onQueryChange={setQuery} onConnect={onConnect} getHostIconUrl={() => ''} />
    </ConfigProvider>
  }
  return { ...render(<Menu />), onConnect, onOpenLauncher }
}

async function detailsTooltip(trigger: HTMLElement) {
  let tooltip: HTMLElement | null = null
  await waitFor(() => {
    tooltip = document.getElementById(trigger.getAttribute('aria-describedby') ?? '')
    expect(tooltip).toBeVisible()
  })
  return tooltip!
}

test('SSH 更多连接收起快捷菜单并清空搜索，打开完整连接页而不发起连接', async () => {
  const user = userEvent.setup()
  const { onConnect, onOpenLauncher } = renderMenu()
  const trigger = screen.getByRole('button', { name: 'new-ssh' })
  await user.click(trigger)
  await user.type(await screen.findByRole('textbox'), 'no-match')
  await user.click(screen.getByRole('button', { name: 'workbench.quickConnect.moreConnections' }))
  expect(onOpenLauncher).toHaveBeenCalledTimes(1)
  expect(onConnect).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  await user.click(trigger)
  expect(await screen.findByRole('textbox')).toHaveValue('')
  expect(screen.getByRole('option', { name: /Production server/ })).toBeVisible()
})

test('SSH 连接进行中禁用更多连接，完成后恢复入口', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const { onOpenLauncher } = renderMenu({ onConnect: () => pending })
  await user.click(screen.getByRole('button', { name: 'new-ssh' }))
  await user.click(await screen.findByRole('option', { name: /Production server/ }))
  const more = screen.getByRole('button', { name: 'workbench.quickConnect.moreConnections' })
  expect(more).toBeDisabled()
  await user.click(more)
  expect(onOpenLauncher).not.toHaveBeenCalled()
  await act(async () => finish())
  expect(more).toBeEnabled()
})

test('工作站操作繁忙时禁用更多连接入口', async () => {
  const user = userEvent.setup()
  const { onOpenLauncher } = renderMenu({ actionBusy: true })
  await user.click(screen.getByRole('button', { name: 'new-ssh' }))
  const more = await screen.findByRole('button', { name: 'workbench.quickConnect.moreConnections' })
  expect(more).toBeDisabled()
  await user.click(more)
  expect(onOpenLauncher).not.toHaveBeenCalled()
})

test('SSH 悬停展示完整 IPv6 端点、认证与最近访问，查看详情不触发连接', async () => {
  const user = userEvent.setup()
  const { onConnect } = renderMenu()
  await user.click(screen.getByRole('button', { name: 'new-ssh' }))
  const row = await screen.findByRole('option', { name: /Production server/ })
  await user.hover(row)
  const tooltip = await detailsTooltip(row)
  expect(within(tooltip).getByText('deploy@[2001:db8::10]:2202')).toBeVisible()
  expect(within(tooltip).getByText('hosts.auth.private_key')).toBeVisible()
  expect(within(tooltip).getByText('Release server')).toBeVisible()
  expect(row).toHaveAttribute('aria-describedby', tooltip.id)
  expect(onConnect).not.toHaveBeenCalled()

  fireEvent.scroll(screen.getByRole('listbox'))
  await waitFor(() => expect(tooltip).not.toBeInTheDocument())
})

test('SSH 键盘聚焦可查看详情，关闭后重开不会残留浮卡', async () => {
  const user = userEvent.setup()
  renderMenu()
  const trigger = screen.getByRole('button', { name: 'new-ssh' })
  await user.click(trigger)
  const row = await screen.findByRole('option', { name: /Production server/ })
  await act(async () => row.focus())
  const tooltip = await detailsTooltip(row)
  await user.click(trigger)
  await waitFor(() => expect(tooltip).not.toBeInTheDocument())
  await user.click(trigger)
  await waitFor(() => expect(screen.getByRole('option', { name: /Production server/ })).toBeVisible())
  expect(screen.queryByText('Release server')).not.toBeInTheDocument()
})
