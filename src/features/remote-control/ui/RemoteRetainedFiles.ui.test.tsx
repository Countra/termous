import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { App, ConfigProvider } from 'antd'
import { ResponseSchema, type Response } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { RemoteClient } from '#entities/remote-control'
import type { RemoteConnection } from '#common/contracts'
import { remoteCopy } from '../model/copy'
import { RemoteRetainedFiles } from './RemoteRetainedFiles'

const copy = remoteCopy('zh-CN')
const page = (name: string, nextCursor = '') => create(ResponseSchema, { result: { case: 'desktop', value: {
  exchanges: [{ id: name, name, state: 'retained', resourceGeneration: 7n, expiresUnixMs: BigInt(Date.now() + 3600000) }], nextCursor,
} } })

function fixture() {
  const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], {} as RemoteConnection)
  const request = vi.spyOn(client, 'request')
  render(<ConfigProvider theme={{ token: { motion: false } }}><App><RemoteRetainedFiles client={client} copy={copy} changed={vi.fn()} getContainer={() => document.body} /></App></ConfigProvider>)
  return { client, request }
}

test('暂存记录先浏览文件，保持资源代次和只读下载边界', async () => {
  const { client, request } = fixture()
  const download = vi.spyOn(client, 'selectTransfer').mockResolvedValue(null)
  request.mockResolvedValueOnce(page('开发桌面')).mockResolvedValue(create(ResponseSchema, { result: { case: 'directory', value: {
    entries: [{ name: 'report.txt', path: '/report.txt', kind: 'file', size: 1024n }],
  } } }))
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: copy.retainedFiles }))
  fireEvent.click(await screen.findByRole('button', { name: `${copy.browseFiles} · 开发桌面` }))
  const dialog = screen.getByRole('dialog')
  expect(await within(dialog).findByRole('button', { name: 'report.txt' })).toBeVisible()
  expect(request).toHaveBeenLastCalledWith({ operation: { case: 'file', value: {
    action: 'list', cursor: '', location: { kind: 'desktop_exchange', resourceId: '开发桌面', generation: 7n, path: '/', retained: true },
  } } })
  expect(download).not.toHaveBeenCalled()
  expect(within(dialog).queryByRole('button', { name: copy.uploadDevice })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: copy.newFolder })).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: copy.downloadDevice })).toBeDisabled()
  expect(within(dialog).getByRole('combobox', { name: copy.overwrite })).toBeVisible()
  fireEvent.click(within(dialog).getAllByRole('checkbox')[1]!)
  fireEvent.click(within(dialog).getByRole('button', { name: copy.downloadDevice }))
  await waitFor(() => expect(download).toHaveBeenCalledWith({
    direction: 'download', directory: false, overwrite: 'rename', name: 'report.txt',
    location: { kind: 'desktop_exchange', resourceId: '开发桌面', generation: '7', path: '/report.txt', retained: true },
    locations: [{ kind: 'desktop_exchange', resourceId: '开发桌面', generation: '7', path: '/report.txt', retained: true }],
  }))
  fireEvent.click(within(dialog).getByRole('button', { name: copy.backToRetainedFiles }))
  expect(await screen.findByRole('button', { name: `${copy.browseFiles} · 开发桌面` })).toBeVisible()
})

test('读取失败不展示空状态，重试成功后恢复列表状态', async () => {
  const { request } = fixture()
  request.mockRejectedValueOnce({ code: 'desktop_files_unauthorized' })
    .mockResolvedValue(create(ResponseSchema, { result: { case: 'desktop', value: {} } }))
  fireEvent.click(screen.getByRole('button', { name: copy.retainedFiles }))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.desktopFilesDenied)
  expect(screen.queryByText(copy.retainedFilesEmpty)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
  expect(await screen.findByText(copy.retainedFilesEmpty)).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('关闭再打开时，旧分页回执不能混入新列表', async () => {
  const { request } = fixture()
  let finish!: (value: Response) => void
  request.mockResolvedValueOnce(page('旧列表', 'next')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValue(page('新列表'))
  const trigger = screen.getByRole('button', { name: copy.retainedFiles })
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('button', { name: copy.loadMore }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: copy.close }))
  fireEvent.click(trigger)
  expect(await screen.findByRole('button', { name: `${copy.browseFiles} · 新列表` })).toBeVisible()
  await act(async () => finish(page('过期分页')))
  expect(screen.queryByRole('button', { name: `${copy.browseFiles} · 过期分页` })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: `${copy.browseFiles} · 旧列表` })).not.toBeInTheDocument()
})
