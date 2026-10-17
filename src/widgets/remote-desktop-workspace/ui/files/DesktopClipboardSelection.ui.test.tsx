import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DesktopClipboardSelection } from './DesktopClipboardSelection'

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, values?: { size: string }) => values ? `${key}:${values.size}` : key }),
}))

test('支持键盘展开文件详情与 Escape 收起，一次仅展开一个条目', async () => {
  const user = userEvent.setup()
  render(<DesktopClipboardSelection items={[
    { name: '交付说明.txt', kind: 'file', size: 2048 }, { name: '项目文档', kind: 'directory' },
  ]} />)
  const file = screen.getByRole('button', { name: '交付说明.txt' })
  file.focus()
  await user.keyboard('{Enter}')
  expect(file).toHaveAttribute('aria-expanded', 'true')
  expect(document.getElementById(file.getAttribute('aria-controls')!)).toHaveTextContent('remoteDesktop.files.byteSize:2,048')
  const folder = screen.getByRole('button', { name: '项目文档' })
  await user.click(folder)
  expect(file).toHaveAttribute('aria-expanded', 'false')
  const details = document.getElementById(folder.getAttribute('aria-controls')!)!
  expect(within(details).getByText('remoteDesktop.files.folder')).toBeVisible()
  expect(within(details).getByText('—')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(folder).toHaveAttribute('aria-expanded', 'false')
  expect(details).not.toBeInTheDocument()
  expect(folder).toHaveFocus()
})

test('同名文件替换时清除详情，零字节文件和未知大小分别展示', async () => {
  const user = userEvent.setup()
  const view = render(<DesktopClipboardSelection items={[{ name: 'empty.txt', kind: 'file', size: 0 }]} />)
  const file = screen.getByRole('button', { name: 'empty.txt' })
  expect(file).toHaveTextContent('0 B')
  await user.click(file)
  expect(file).toHaveAttribute('aria-expanded', 'true')
  view.rerender(<DesktopClipboardSelection items={[{ name: 'empty.txt', kind: 'file' }]} />)
  expect(file).toHaveAttribute('aria-expanded', 'false')
  expect(file).toHaveTextContent('—')
})
