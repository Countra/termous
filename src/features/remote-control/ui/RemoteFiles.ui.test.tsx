import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { App } from 'antd'
import { ResponseSchema, SessionSchema, TransferSchema, type Response } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { RemoteClient } from '#entities/remote-control'
import type { RemoteConnection, RemoteLocalTask } from '#common/contracts'
import { remoteCopy } from '../model/copy'
import { RemoteFiles } from './RemoteFiles'

test('同会话上传完成后刷新目录，写入中和其他会话完成不触发刷新', async () => {
  const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], {} as RemoteConnection)
  const request = vi.spyOn(client, 'request').mockResolvedValue(create(ResponseSchema, { result: { case: 'directory', value: { entries: [] } } }))
  const session = create(SessionSchema, { id: 'files', generation: 1n, capabilities: ['browse'] })
  const task: RemoteLocalTask = { id: 'upload', remote_id: 'remote-upload', name: 'report.txt', state: 'running', direction: 'upload', confirmed_bytes: 100, total_bytes: 100, target_bytes: 100, stage: 'publishing', session_id: 'files', resumable: false }
  const props = { client, session, copy: remoteCopy('zh-CN'), roots: [], operations: [], changed: vi.fn() }
  const display = (localTasks: RemoteLocalTask[], completeRemote = false) => <App><RemoteFiles {...props} localTasks={localTasks} transfers={completeRemote ? [create(TransferSchema, { id: 'remote', state: 'completed', target: { kind: 'files', resourceId: 'files' } })] : []} /></App>
  const view = render(display([task]))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  await act(async () => { view.rerender(display([{ ...task, state: 'completed', session_id: 'other' }])) })
  expect(request).toHaveBeenCalledTimes(1)
  await act(async () => { view.rerender(display([{ ...task, state: 'completed' }])) })
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await act(async () => { view.rerender(display([{ ...task, state: 'completed' }])) })
  expect(request).toHaveBeenCalledTimes(2)
  await act(async () => { view.rerender(display([{ ...task, state: 'completed' }], true)) })
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
})

test('上传完成时正在切换目录，刷新等待导航结束且不会退回旧目录', async () => {
  const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], {} as RemoteConnection)
  let complete!: (response: Response) => void
  const navigation = new Promise<Response>(resolve => { complete = resolve })
  const directories: string[] = []
  vi.spyOn(client, 'request').mockImplementation(async input => {
    const path = input.operation?.case === 'file' ? input.operation.value.location?.path ?? '' : ''
    directories.push(path)
    if (directories.length === 2) return navigation
    return create(ResponseSchema, { result: { case: 'directory', value: { entries: path === '/' ? [{ name: 'src', path: '/src', kind: 'directory' }] : [] } } })
  })
  const props = { client, session: create(SessionSchema, { id: 'files', generation: 1n, capabilities: ['browse'] }), copy: remoteCopy('zh-CN'), roots: [], operations: [], changed: vi.fn() }
  const view = render(<App><RemoteFiles {...props} /></App>)
  fireEvent.click(await screen.findByRole('button', { name: 'src' }))
  await act(async () => { view.rerender(<App><RemoteFiles {...props} transfers={[create(TransferSchema, { id: 'transfer', state: 'completed', target: { kind: 'files', resourceId: 'files' } })]} /></App>) })
  expect(directories).toEqual(['/', '/src'])
  await act(async () => { complete(create(ResponseSchema, { result: { case: 'directory', value: { entries: [] } } })) })
  await waitFor(() => expect(directories).toEqual(['/', '/src', '/src']))
})

test('留存交换区脱离桌面会话浏览，只提供领取并保留资源代次', async () => {
  const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], {} as RemoteConnection)
  const request = vi.spyOn(client, 'request').mockResolvedValue(create(ResponseSchema, { result: { case: 'directory', value: { entries: [{ name: '完成.txt', path: '/完成.txt', kind: 'file' }] } } }))
  const copy = remoteCopy('zh-CN')
  render(<App><RemoteFiles client={client} exchange={{ id: 'retained', resourceGeneration: 8n, state: 'retained' }} copy={copy} roots={[]} operations={[]} changed={vi.fn()} /></App>)
  await screen.findByRole('button', { name: '完成.txt' })
  expect(request).toHaveBeenCalledWith({ operation: { case: 'file', value: { action: 'list', location: { kind: 'desktop_exchange', resourceId: 'retained', generation: 8n, path: '/', retained: true }, cursor: '' } } })
  expect(screen.getByRole('button', { name: copy.newFolder })).toBeDisabled()
  expect(screen.getByRole('button', { name: copy.rename })).toBeDisabled()
  expect(screen.getByRole('button', { name: copy.remove })).toBeDisabled()
})

test('交换区重新绑定后，忽略旧代次目录结果', async () => {
  const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], {} as RemoteConnection)
  let finish!: (value: Response) => void
  vi.spyOn(client, 'request').mockImplementation(async input => {
    const generation = input.operation?.case === 'file' ? input.operation.value.location?.generation : 0n
    if (generation === 1n) return new Promise<Response>(resolve => { finish = resolve })
    return create(ResponseSchema, { result: { case: 'directory', value: { entries: [{ name: '当前.txt', path: '/当前.txt', kind: 'file' }] } } })
  })
  const props = { client, copy: remoteCopy('zh-CN'), roots: [], operations: [], changed: vi.fn() }
  const view = render(<App><RemoteFiles {...props} exchange={{ id: 'exchange', resourceGeneration: 1n }} /></App>)
  await act(async () => { view.rerender(<App><RemoteFiles {...props} exchange={{ id: 'exchange', resourceGeneration: 2n }} /></App>) })
  await screen.findByRole('button', { name: '当前.txt' })
  await act(async () => { finish(create(ResponseSchema, { result: { case: 'directory', value: { entries: [{ name: '过期.txt', path: '/过期.txt', kind: 'file' }] } } })) })
  expect(screen.queryByRole('button', { name: '过期.txt' })).not.toBeInTheDocument()
})
