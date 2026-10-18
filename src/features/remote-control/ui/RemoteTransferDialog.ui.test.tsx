import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { App, ConfigProvider } from 'antd'
import { LocalRootSchema, ResponseSchema, SessionSchema } from '@termous/remote-protocol'
import { expect, test, vi } from 'vitest'
import { RemoteClient } from '#entities/remote-control'
import type { RemoteConnection } from '#common/contracts'
import { remoteCopy } from '../model/copy'
import { RemoteTransferDialog } from './RemoteTransferDialog'

const copy = remoteCopy('zh-CN')
const directory = (name: string) => create(ResponseSchema, { result: { case: 'directory', value: {
  entries: [{ name, path: name, kind: 'file', size: 1024n }],
} } })

function fixture(initial = directory('旧文件.txt')) {
  const client = new RemoteClient({} as ConstructorParameters<typeof RemoteClient>[0], {} as RemoteConnection)
  const request = vi.spyOn(client, 'request').mockResolvedValueOnce(initial)
  const close = vi.fn(), changed = vi.fn()
  const roots = ['一', '二'].map((name, index) => create(LocalRootSchema, { id: `root-${index + 1}`, name: `目录${name}`, readable: true, writable: true }))
  const display = (available = roots) => <ConfigProvider theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}><App>
    <RemoteTransferDialog client={client} session={create(SessionSchema, { id: 'files', generation: 3n })}
      roots={available}
      copy={copy} upload paths={[]} directory="/target" close={close} changed={changed} />
  </App></ConfigProvider>
  const view = render(display())
  return { request, close, changed, roots, rerenderRoots: (available: typeof roots) => view.rerender(display(available)) }
}

test('切换授权目录失败后清空旧文件和选择，重试仅提交新目录内选中的文件', async () => {
  const { request, close, changed } = fixture()
  request.mockRejectedValueOnce({ code: 'remote_invalid' })
    .mockResolvedValueOnce(directory('新文件.txt')).mockResolvedValue(create(ResponseSchema))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(await within(dialog).findByRole('row', { name: /旧文件.txt/ })).getByRole('checkbox'))
  const submit = within(dialog).getByRole('button', { name: copy.startTransfer })
  expect(submit).toBeEnabled()
  fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: copy.chooseFolder }))
  fireEvent.click(await screen.findByText('目录二'))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.error)
  expect(screen.queryByText('旧文件.txt')).not.toBeInTheDocument()
  expect(submit).toBeDisabled()
  fireEvent.click(within(dialog).getByRole('button', { name: copy.retry }))
  const row = await within(dialog).findByRole('row', { name: /新文件.txt/ })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(submit).toBeDisabled()
  fireEvent.click(within(row).getByRole('checkbox'))
  fireEvent.click(submit)
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(changed).toHaveBeenCalledOnce()
  expect(request).toHaveBeenLastCalledWith({ operation: { case: 'transfer', value: {
    action: 'create', operationId: expect.any(String), overwrite: 'rename',
    sources: [{ kind: 'host_local', resourceId: 'root-2', path: '新文件.txt' }],
    target: { kind: 'files', resourceId: 'files', generation: 3n, path: '/target' },
  } } })
})

test('目录响应类型异常提供重试，重试成功后恢复文件列表', async () => {
  const { request } = fixture(create(ResponseSchema))
  request.mockResolvedValue(directory('恢复.txt'))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.error)
  fireEvent.click(screen.getByRole('button', { name: copy.retry }))
  expect(await screen.findByText('恢复.txt')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(2)
})

test('目录授权变更后切换到可用目录，全部撤销时清空选择并禁用传输', async () => {
  const { request, roots, rerenderRoots } = fixture()
  request.mockResolvedValue(directory('可用文件.txt'))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(await within(dialog).findByRole('row', { name: /旧文件.txt/ })).getByRole('checkbox'))
  rerenderRoots([roots[1]!])
  const row = await within(dialog).findByRole('row', { name: /可用文件.txt/ })
  expect(request).toHaveBeenLastCalledWith({ operation: { case: 'file', value: {
    action: 'list', location: { kind: 'host_local', resourceId: 'root-2', path: '.' }, cursor: '',
  } } })
  expect(within(dialog).getByRole('button', { name: copy.startTransfer })).toBeDisabled()
  fireEvent.click(within(row).getByRole('checkbox'))
  rerenderRoots([])
  expect(within(dialog).getByText(copy.noRoots)).toBeVisible()
  expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: copy.startTransfer })).toBeDisabled()
  expect(request).toHaveBeenCalledTimes(2)
})
