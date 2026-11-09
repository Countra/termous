import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'
import { i18n } from '#shared/i18n'
import { DesktopBatchResult } from './DesktopBatchResult.tsx'

it('部分失败回执展示实际接受数量、停止位置和每步状态', async () => {
  await i18n.changeLanguage('zh-CN')
  render(<I18nextProvider i18n={i18n}><DesktopBatchResult receipt={{ id: 'desktop_execution_test', state: 'uncertain', accepted_actions: 1,
    steps: [{ index: 0, kind: 'pointer.click', state: 'accepted', wait_after_ms: 100 },
      { index: 1, kind: 'keyboard.text', state: 'uncertain', wait_after_ms: 0 },
      { index: 2, kind: 'keyboard.key', state: 'skipped', wait_after_ms: 100 }], capture_state: 'unavailable', cleanup_error: 'desktop_cleanup_uncertain',
  }} /></I18nextProvider>)
  expect(screen.getByText('已接受 1 / 3 步')).toBeVisible()
  expect(screen.getByText('从第 2 步停止继续执行')).toBeVisible()
  expect(screen.getByText('输入文本')).toBeVisible()
  expect(screen.getByText('未执行')).toBeVisible()
  expect(screen.getByText('本批次原截图不可用，可重新观察桌面。')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('输入清理未确认')
})

it('整批预检失败且没有失败步骤时仍显示停止原因', async () => {
  await i18n.changeLanguage('zh-CN')
  render(<I18nextProvider i18n={i18n}><DesktopBatchResult receipt={{ id: 'desktop_execution_preflight', state: 'stopped', accepted_actions: 0,
    steps: [{ index: 0, kind: 'keyboard.text', state: 'skipped', wait_after_ms: 100 }], capture_state: 'ready', error_code: 'desktop_capability_unsupported',
  }} /></I18nextProvider>)
  expect(screen.getByRole('alert')).toHaveTextContent('停止原因：')
  expect(screen.getByRole('alert')).toHaveTextContent('desktop_capability_unsupported')
})
