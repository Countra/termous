import { App, ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DockerResource, DockerResourceActionResult, DockerResourceKind } from '#entities/docker'
import type { DockerGateway } from '../model/contracts'
import { DockerPanel } from './DockerPanel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const image: DockerResource = { kind: 'images', id: `sha256:${'a'.repeat(64)}`, name: 'app:latest', tags: ['app:latest'], size: '128MB' }
const volume: DockerResource = { kind: 'volumes', id: 'app-data', name: 'app-data', driver: 'local', scope: 'local' }
const network: DockerResource = { kind: 'networks', id: 'b'.repeat(64), name: 'app-net', driver: 'bridge', scope: 'local' }
const key = (name: string) => `workbench.docker.resources.${name}`

function setup() {
  const items: Record<DockerResourceKind, DockerResource[]> = { images: [image], volumes: [volume], networks: [network] }
  const api: DockerGateway = {
    sessionDockerCapability: vi.fn<DockerGateway['sessionDockerCapability']>(async () => ({ available: true, status: 'available', collected_at: '' })),
    sessionDockerContainers: vi.fn(async () => ({ items: [], total: 0, filtered: 0, collected_at: '' })),
    sessionDockerContainerDetail: vi.fn(), sessionDockerContainerStats: vi.fn(), sessionDockerContainerLogs: vi.fn(), sessionDockerContainerAction: vi.fn(),
    sessionDockerResources: vi.fn<DockerGateway['sessionDockerResources']>(async (_id, kind) => ({ items: items[kind], total: items[kind].length, filtered: items[kind].length, offset: 0, limit: 100, collected_at: '' })),
    sessionDockerResourceDetail: vi.fn<DockerGateway['sessionDockerResourceDetail']>(async (_id, kind, ref) => ({ resource: items[kind].find((item) => item.id === ref)!, internal: false, attachable: true, containers: [{ id: 'c'.repeat(64), name: 'app', ipv4: '10.0.0.2/16' }], collected_at: '' })),
    sessionDockerResourceCreate: vi.fn<DockerGateway['sessionDockerResourceCreate']>(async (_id, kind, input) => ({ id: input.name, kind, action: 'create', completed_at: '' })),
    sessionDockerResourceAction: vi.fn<DockerGateway['sessionDockerResourceAction']>(async (_id, kind, ref, input) => {
      if (input.action === 'remove') items[kind] = items[kind].filter((item) => item.id !== ref)
      return { id: ref, kind, action: input.action, completed_at: '' }
    }),
  }
  const tree = (sessionId = 'ssh-a', status = 'connected') => <ConfigProvider theme={{ token: { motion: false } }}><App><DockerPanel
    api={api} session={{ id: sessionId, kind: 'ssh', status }} enabled onOpenShell={vi.fn()} /></App></ConfigProvider>
  const view = render(tree())
  return { ...view, api, tree }
}

async function open(kind: DockerResourceKind, name: string) {
  fireEvent.click(screen.getByRole('tab', { name: key(kind) }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
  await screen.findByRole('heading', { name })
}

test('四种模式来回切换复用列表，搜索与当前资源详情恢复', async () => {
  const view = setup()
  await waitFor(() => expect(view.api.sessionDockerContainers).toHaveBeenCalledTimes(1))
  await open('images', image.name)
  await open('volumes', volume.name)
  fireEvent.click(screen.getByRole('tab', { name: key('networks') }))
  const search = await screen.findByRole('textbox', { name: key('search') })
  fireEvent.change(search, { target: { value: 'app-net' } })
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(4))
  for (const kind of ['containers', 'images', 'volumes', 'networks'] as const) {
    fireEvent.click(screen.getByRole('tab', { name: key(kind) }))
    if (kind === 'images' || kind === 'volumes') expect(screen.getByRole('heading', { name: kind === 'images' ? image.name : volume.name })).toBeVisible()
  }
  expect(screen.getByRole('textbox', { name: key('search') })).toHaveValue('app-net')
  expect(view.api.sessionDockerContainers).toHaveBeenCalledTimes(1)
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(4)
  expect(view.api.sessionDockerResourceDetail).toHaveBeenCalledTimes(2)
})

test('模式按需读取，镜像详情通过完整 ID 添加标签', async () => {
  const view = setup()
  expect(view.api.sessionDockerResources).not.toHaveBeenCalled()
  await open('images', image.name)
  expect(view.api.sessionDockerResourceDetail).toHaveBeenCalledWith('ssh-a', 'images', image.id, expect.anything())
  fireEvent.click(screen.getByRole('button', { name: key('tag') }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(key('tagName')), { target: { value: 'registry.local/app:v2' } })
  fireEvent.click(within(dialog).getByRole('button', { name: key('tag') }))
  await waitFor(() => expect(view.api.sessionDockerResourceAction).toHaveBeenCalledExactlyOnceWith('ssh-a', 'images', image.id, { action: 'tag', tag: 'registry.local/app:v2' }))
})

test('数据卷删除需要确认，失败保留详情和错误，不自动重试', async () => {
  const view = setup()
  await open('volumes', volume.name)
  fireEvent.click(screen.getByRole('button', { name: key('remove') }))
  await waitFor(() => expect(screen.getByText(key('removeVolumeHint'))).toBeVisible())
  expect(view.api.sessionDockerResourceAction).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'app.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(view.api.sessionDockerResourceAction).not.toHaveBeenCalled()
  vi.mocked(view.api.sessionDockerResourceAction).mockRejectedValueOnce(new Error('volume is in use'))
  fireEvent.click(screen.getByRole('button', { name: key('remove') }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: key('remove') }))
  await waitFor(() => expect(screen.getByText('volume is in use')).toBeVisible())
  expect(screen.getByRole('heading', { name: volume.name })).toBeVisible()
  expect(view.api.sessionDockerResourceAction).toHaveBeenCalledTimes(1)
})

test('删除等待期间阻止重复确认，成功后回列表并刷新', async () => {
  const view = setup()
  await open('volumes', volume.name)
  let resolve!: (result: DockerResourceActionResult) => void
  vi.mocked(view.api.sessionDockerResourceAction).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  fireEvent.click(screen.getByRole('button', { name: key('remove') }))
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: key('remove') })
  fireEvent.click(confirm)
  fireEvent.click(confirm)
  expect(confirm).toBeDisabled()
  expect(view.api.sessionDockerResourceAction).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ id: volume.id, kind: 'volumes', action: 'remove', completed_at: '' }) })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByRole('heading', { name: volume.name })).not.toBeInTheDocument()
  expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(2)
})

test('网络创建、连接和断开使用当前会话的受控接口', async () => {
  const view = setup()
  fireEvent.click(screen.getByRole('tab', { name: key('networks') }))
  fireEvent.click(await screen.findByRole('button', { name: key('create_networks') }))
  let dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(key('name')), { target: { value: 'isolated-net' } })
  fireEvent.click(within(dialog).getByRole('checkbox', { name: key('internal') }))
  fireEvent.click(within(dialog).getByRole('button', { name: key('create_networks') }))
  await waitFor(() => expect(view.api.sessionDockerResourceCreate).toHaveBeenCalledExactlyOnceWith('ssh-a', 'networks', { name: 'isolated-net', internal: true }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await open('networks', network.name)
  fireEvent.click(screen.getByRole('button', { name: key('connect') }))
  dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(key('containerName')), { target: { value: 'worker' } })
  fireEvent.click(within(dialog).getByRole('button', { name: key('connect') }))
  await waitFor(() => expect(view.api.sessionDockerResourceAction).toHaveBeenCalledWith('ssh-a', 'networks', network.id, { action: 'connect', container: 'worker' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(await screen.findByRole('button', { name: key('disconnect') }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: key('disconnect') }))
  await waitFor(() => expect(view.api.sessionDockerResourceAction).toHaveBeenLastCalledWith('ssh-a', 'networks', network.id, { action: 'disconnect', container: 'c'.repeat(64) }))
})

test('切换会话收起旧资源确认框，模式支持键盘切换', async () => {
  const view = setup()
  await open('volumes', volume.name)
  fireEvent.click(screen.getByRole('button', { name: key('remove') }))
  view.rerender(view.tree('ssh-b'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(view.api.sessionDockerResourceAction).not.toHaveBeenCalled()
  const tab = screen.getByRole('tab', { name: key('volumes') })
  fireEvent.keyDown(tab, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: key('networks') })).toHaveAttribute('aria-selected', 'true')
})

test('断连收起确认框，重新连接不复活旧删除意图', async () => {
  const view = setup()
  await open('volumes', volume.name)
  fireEvent.click(screen.getByRole('button', { name: key('remove') }))
  view.rerender(view.tree('ssh-a', 'disconnected'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(view.tree())
  await screen.findByRole('button', { name: new RegExp(volume.name) })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(view.api.sessionDockerResourceAction).not.toHaveBeenCalled()
})

test('写入期间切走再返回，完成后刷新当前列表且不重新打开旧确认框', async () => {
  const view = setup()
  let resolve!: (result: DockerResourceActionResult) => void
  vi.mocked(view.api.sessionDockerResourceCreate).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  fireEvent.click(screen.getByRole('tab', { name: key('volumes') }))
  fireEvent.click(await screen.findByRole('button', { name: key('create_volumes') }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText(key('name')), { target: { value: 'new-data' } })
  fireEvent.click(within(dialog).getByRole('button', { name: key('create_volumes') }))
  fireEvent.click(screen.getByRole('tab', { name: key('images') }))
  fireEvent.click(screen.getByRole('tab', { name: key('volumes') }))
  await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(volume.name) })).toBeDisabled())
  const reads = vi.mocked(view.api.sessionDockerResources).mock.calls.length
  await act(async () => { resolve({ id: 'new-data', kind: 'volumes', action: 'create', completed_at: '' }) })
  await waitFor(() => expect(view.api.sessionDockerResources).toHaveBeenCalledTimes(reads + 1))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(view.api.sessionDockerResourceCreate).toHaveBeenCalledTimes(1)
})
