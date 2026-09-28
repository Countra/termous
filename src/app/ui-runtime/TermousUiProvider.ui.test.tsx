import type { ReactNode } from 'react'
import { App, Button, ConfigProvider, Popconfirm, Popover } from 'antd'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { termousPopconfirmProps } from '#shared/ui'
import { TermousUiProvider } from './TermousUiProvider'

function WithoutMotion({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>
}

test.each(['dark', 'light'] as const)('%s 主题下二次确认自动使用公共 Portal 样式，并保留调用方样式和取消行为', async (theme) => {
  const user = userEvent.setup()
  const confirm = vi.fn()
  render(<TermousUiProvider theme={theme} language="zh-CN">
    <Popconfirm title="删除转发配置？" description="只删除保存的配置。" onConfirm={confirm}
      rootClassName="feature-confirm" classNames={{ container: 'feature-container' }}
      okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
      <Button>删除配置</Button>
    </Popconfirm>
  </TermousUiProvider>, { wrapper: WithoutMotion })
  await user.click(screen.getByRole('button', { name: '删除配置' }))
  const popup = await screen.findByRole('tooltip')
  expect(popup.closest('.ant-popover')).toHaveClass(termousPopconfirmProps.classNames.root, 'feature-confirm')
  expect(popup).toHaveClass(termousPopconfirmProps.classNames.container, 'feature-container')
  expect(within(popup).getByRole('button', { name: '删除' })).toHaveClass('ant-btn-dangerous')
  expect(confirm).not.toHaveBeenCalled()
  await user.click(within(popup).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  expect(confirm).not.toHaveBeenCalled()
})

test('显式公共样式与全局配置兼容，异步确认完成前保持等待状态', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  const confirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  render(<TermousUiProvider theme="dark" language="zh-CN">
    <Popconfirm {...termousPopconfirmProps} title="终止进程？" onConfirm={confirm} okText="终止" cancelText="取消">
      <Button>进程操作</Button>
    </Popconfirm>
  </TermousUiProvider>, { wrapper: WithoutMotion })
  await user.click(screen.getByRole('button', { name: '进程操作' }))
  const popup = await screen.findByRole('tooltip')
  const button = within(popup).getByRole('button', { name: '终止' })
  await user.click(button)
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(button).toHaveClass('ant-btn-loading')
  expect(popup).toBeVisible()
  await act(async () => finish())
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
})

test('二次确认的全局配置不附加到普通 Popover', async () => {
  const user = userEvent.setup()
  render(<TermousUiProvider theme="dark" language="zh-CN">
    <Popover trigger="click" content="普通内容"><Button>展开</Button></Popover>
  </TermousUiProvider>, { wrapper: WithoutMotion })
  await user.click(screen.getByRole('button', { name: '展开' }))
  const popup = await screen.findByRole('tooltip')
  expect(popup.closest('.ant-popover')).not.toHaveClass(termousPopconfirmProps.classNames.root)
  expect(popup).not.toHaveClass(termousPopconfirmProps.classNames.container)
})

test('受控确认保留禁用按钮状态，不触发确认或取消回调', async () => {
  const user = userEvent.setup()
  const confirm = vi.fn()
  const cancel = vi.fn()
  render(<TermousUiProvider theme="dark" language="zh-CN">
    <Popconfirm open title="删除书签？" onConfirm={confirm} onCancel={cancel}
      okText="删除" cancelText="取消" okButtonProps={{ danger: true, disabled: true }}
      cancelButtonProps={{ disabled: true }}>
      <Button>删除书签</Button>
    </Popconfirm>
  </TermousUiProvider>, { wrapper: WithoutMotion })
  const popup = await screen.findByRole('tooltip')
  const confirmButton = within(popup).getByRole('button', { name: '删除' })
  const cancelButton = within(popup).getByRole('button', { name: '取消' })
  expect(confirmButton).toBeDisabled()
  expect(cancelButton).toBeDisabled()
  await user.click(confirmButton)
  await user.click(cancelButton)
  expect(confirm).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
  expect(popup).toBeVisible()
})

function ModalAction({ onConfirm }: { onConfirm: () => void }) {
  const { modal } = App.useApp()
  return <Button onClick={() => modal.confirm({ title: '确认操作？', onOk: onConfirm })}>显示确认</Button>
}

test('上下文确认弹窗继承语言和主题，取消不触发操作', async () => {
  const user = userEvent.setup()
  const confirm = vi.fn()
  const view = render(<TermousUiProvider theme="dark" language="zh-CN"><ModalAction onConfirm={confirm} /></TermousUiProvider>, { wrapper: WithoutMotion })
  await user.click(screen.getByRole('button', { name: '显示确认' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('button', { name: '确定' })).toBeInTheDocument()
  view.rerender(<TermousUiProvider theme="light" language="en-US"><ModalAction onConfirm={confirm} /></TermousUiProvider>)
  await user.click(await within(dialog).findByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(confirm).not.toHaveBeenCalled()
})
