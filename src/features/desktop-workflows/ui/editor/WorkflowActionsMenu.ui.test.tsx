import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import { WorkflowActionsMenu } from './WorkflowActionsMenu'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function actions() {
  return { revision: 2, dirty: false, busy: false, onValidate: vi.fn(), onRun: vi.fn(), onParameters: vi.fn(),
    onHistory: vi.fn(), onImport: vi.fn(), onExport: vi.fn(), onCopy: vi.fn(), onRemove: vi.fn() }
}

it('菜单打开不执行文件操作，选择导入后只委托原导入入口', async () => {
  const props = actions()
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowActionsMenu {...props} /></ConfigProvider>)
  const trigger = screen.getByRole('button', { name: 'desktopWorkflow.moreActions' })
  fireEvent.click(trigger)
  await waitFor(() => expect(screen.getByRole('menu')).toBeVisible())
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(props.onImport).not.toHaveBeenCalled()
  expect(props.onExport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('menuitem', { name: /desktopWorkflow.exchange.import/ }))
  expect(props.onImport).toHaveBeenCalledOnce()
  expect(props.onExport).not.toHaveBeenCalled()
})

it('草稿不能导出或调试，文件交换忙碌时禁用文件入口并保留其他功能', async () => {
  const props = actions()
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowActionsMenu {...props} revision={undefined} dirty exchangeBusy /></ConfigProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.moreActions' }))
  expect(await screen.findByRole('menuitem', { name: /desktopWorkflow.exchange.export/ })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: /desktopWorkflow.exchange.import/ })).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: /desktopWorkflow.debug/ })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(screen.getByRole('menuitem', { name: /desktopWorkflow.validate/ }))
  expect(props.onValidate).toHaveBeenCalledOnce()
})

it('功能入口支持键盘打开并执行校验', async () => {
  const user = userEvent.setup()
  const props = actions()
  render(<ConfigProvider theme={{ token: { motion: false } }}><WorkflowActionsMenu {...props} /></ConfigProvider>)
  screen.getByRole('button', { name: 'desktopWorkflow.moreActions' }).focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getByRole('menu')).toBeVisible())
  // jsdom 不提供菜单几何信息；真实浏览器验收自动聚焦，组件测试验证已聚焦项的键盘派发。
  const validate = screen.getByRole('menuitem', { name: /desktopWorkflow.validate/ })
  validate.focus()
  fireEvent.keyDown(validate, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
  expect(props.onValidate).toHaveBeenCalledOnce()
})
