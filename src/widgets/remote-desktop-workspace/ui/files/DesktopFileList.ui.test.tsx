import { fireEvent, render, screen } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { expect, test, vi } from 'vitest'
import { DesktopFileList } from './DesktopFileList'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { name?: string }) => args?.name ? `${key}:${args.name}` : key, i18n: { language: 'zh-CN' } }) }))

const entries = [
  { path: '/资料', name: '资料', kind: 'directory', size: 0 },
  { path: '/说明.txt', name: '说明.txt', kind: 'file', size: 2048 },
  { path: '/归档.zip', name: '归档.zip', kind: 'file', size: 4096 },
]

test('文件名可以打开详情，目录有独立导航行为', async () => {
  const navigate = vi.fn()
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><DesktopFileList entries={entries} selected={[]} onSelect={vi.fn()} onOpenDirectory={navigate} /></App></ConfigProvider>)
  fireEvent.click(screen.getByRole('button', { name: '资料' }))
  expect(navigate).toHaveBeenCalledWith('/资料')
  const filename = screen.getByRole('button', { name: '说明.txt' })
  expect(filename).toBeEnabled()
  fireEvent.click(filename)
  expect(await screen.findByRole('dialog')).toHaveTextContent('/说明.txt')
})

test('搜索仅过滤当前列表，不清除已经选择的文件', () => {
  const select = vi.fn()
  render(<DesktopFileList entries={entries} selected={['/说明.txt']} onSelect={select} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'remoteDesktop.files.search' }), { target: { value: '归档' } })
  expect(screen.queryByRole('button', { name: '说明.txt' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '归档.zip' })).toBeVisible()
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.clearSelection' }))
  expect(select).toHaveBeenCalledWith([])
})
