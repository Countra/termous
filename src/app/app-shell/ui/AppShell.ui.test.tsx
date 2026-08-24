import { App as AntdApp } from 'antd'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#shared/bridge', () => ({
  getTermousBridge: () => null,
}))

vi.mock('#features/update', () => ({
  BrandVersionControl: () => null,
}))

test('远程桌面页主连接按钮与主机连接菜单共用主机入口', async () => {
  const user = userEvent.setup()
  const onOpenConnectionLauncher = vi.fn()
  render(
    <AntdApp>
      <AppShell
        page="remote-desktop"
        appVersion="1.0.0"
        windowCloseBehavior="exit"
        sidebarCollapsed={false}
        actionBusy={false}
        onNavigate={vi.fn()}
        onOpenConnectionLauncher={onOpenConnectionLauncher}
        onOpenLocalTerminal={vi.fn()}
        onToggleSidebar={vi.fn()}
      >
        <div />
      </AppShell>
    </AntdApp>,
  )

  const connectButtons = screen.getAllByRole('button', { name: 'app.connect' })
  await user.click(connectButtons[0])
  expect(onOpenConnectionLauncher).toHaveBeenCalledTimes(1)

  await user.click(connectButtons[1])
  await user.click(await screen.findByText('workbench.hostLauncher.kicker'))
  expect(onOpenConnectionLauncher).toHaveBeenCalledTimes(2)
})
