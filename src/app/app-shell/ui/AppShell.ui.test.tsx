import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        onOpenProductTour={vi.fn()}
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

test('帮助按钮通过向上菜单启动使用向导并保留可访问名称', async () => {
  const user = userEvent.setup()
  const onOpenProductTour = vi.fn()
  render(
    <AntdApp>
      <AppShell
        page="workbench"
        appVersion="1.0.0"
        windowCloseBehavior="exit"
        sidebarCollapsed={false}
        actionBusy={false}
        onNavigate={vi.fn()}
        onOpenConnectionLauncher={vi.fn()}
        onOpenLocalTerminal={vi.fn()}
        onOpenProductTour={onOpenProductTour}
        onToggleSidebar={vi.fn()}
      >
        <div />
      </AppShell>
    </AntdApp>,
  )

  const helpButtons = screen.getAllByRole('button', { name: 'productTour.helpButton' })
  expect(helpButtons).toHaveLength(2)
  helpButtons.forEach((button) => {
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('data-tour')
    expect(button.closest('[data-tour="product-tour-trigger"]')).not.toBeNull()
  })

  await user.click(helpButtons[0])
  expect(helpButtons[0]).toHaveAttribute('aria-expanded', 'true')
  expect(helpButtons[1]).toHaveAttribute('aria-expanded', 'false')
  const menuItem = await screen.findByRole('menuitem', { name: 'productTour.menuLabel' })
  await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true))
  expect(document.querySelector('.ant-dropdown-placement-topRight')).not.toBeNull()
  await user.click(menuItem)

  expect(onOpenProductTour).toHaveBeenCalledTimes(1)
  expect(helpButtons[0]).toHaveAttribute('aria-expanded', 'false')
})

test('折叠侧栏中的帮助按钮支持键盘开关菜单', async () => {
  const user = userEvent.setup()
  render(
    <AntdApp>
      <AppShell
        page="workbench"
        appVersion="1.0.0"
        windowCloseBehavior="exit"
        sidebarCollapsed
        actionBusy={false}
        onNavigate={vi.fn()}
        onOpenConnectionLauncher={vi.fn()}
        onOpenLocalTerminal={vi.fn()}
        onOpenProductTour={vi.fn()}
        onToggleSidebar={vi.fn()}
      >
        <div />
      </AppShell>
    </AntdApp>,
  )

  const [sidebarHelpButton] = screen.getAllByRole('button', {
    name: 'productTour.helpButton',
  })
  sidebarHelpButton.focus()
  await user.keyboard('{Enter}')

  expect(sidebarHelpButton).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() => expect(screen.getByRole('menu').contains(document.activeElement)).toBe(true))

  await user.keyboard('{Escape}')
  await waitFor(() => expect(sidebarHelpButton).toHaveAttribute('aria-expanded', 'false'))
  expect(document.activeElement).toBe(sidebarHelpButton)

  await user.keyboard(' ')
  expect(sidebarHelpButton).toHaveAttribute('aria-expanded', 'true')
})

test('窗口尺寸变化时关闭帮助菜单并同步可访问状态', async () => {
  const user = userEvent.setup()
  render(
    <AntdApp>
      <AppShell
        page="workbench"
        appVersion="1.0.0"
        windowCloseBehavior="exit"
        sidebarCollapsed={false}
        actionBusy={false}
        onNavigate={vi.fn()}
        onOpenConnectionLauncher={vi.fn()}
        onOpenLocalTerminal={vi.fn()}
        onOpenProductTour={vi.fn()}
        onToggleSidebar={vi.fn()}
      >
        <div />
      </AppShell>
    </AntdApp>,
  )

  const helpButtons = screen.getAllByRole('button', { name: 'productTour.helpButton' })
  await user.click(helpButtons[0])
  await screen.findByRole('menuitem', { name: 'productTour.menuLabel' })

  fireEvent(window, new Event('resize'))

  await waitFor(() => {
    expect(helpButtons[0]).toHaveAttribute('aria-expanded', 'false')
    expect(helpButtons[1]).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector<HTMLElement>('.ant-dropdown')).toHaveStyle({
      pointerEvents: 'none',
    })
  })
})
