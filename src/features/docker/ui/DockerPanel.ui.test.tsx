import { App } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DockerActionResult, DockerContainerSummary, DockerContainerDetail } from '#entities/docker'
import type { DockerGateway, DockerSessionContext } from '../model/contracts'
import { DockerPanel } from './DockerPanel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const session: DockerSessionContext = { id: 'session-a', kind: 'ssh', status: 'connected' }
const container: DockerContainerSummary = {
  id: 'a1'.repeat(32), short_id: 'a1'.repeat(6), name: 'web; this-is-not-a-command', image: 'nginx:latest', state: 'running',
}

async function setup(item = container) {
  const onOpenShell = vi.fn()
  const api: DockerGateway = {
    sessionDockerResources: vi.fn(),
    sessionDockerResourceDetail: vi.fn(),
    sessionDockerResourceCreate: vi.fn(),
    sessionDockerResourceAction: vi.fn(),
    sessionDockerCapability: vi.fn<DockerGateway['sessionDockerCapability']>(async () => ({ available: true, status: 'available', collected_at: '' })),
    sessionDockerContainers: vi.fn(async () => ({ items: [item], total: 1, filtered: 1, collected_at: '' })),
    sessionDockerContainerDetail: vi.fn(async () => ({ summary: item, collected_at: '' })),
    sessionDockerContainerStats: vi.fn(async () => ({})),
    sessionDockerContainerLogs: vi.fn(async () => ({ lines: [], tail: 200, timestamps: true, collected_at: '' })),
    sessionDockerContainerAction: vi.fn(),
  }
  const tree = (enabled = true, current = session) => <App><DockerPanel api={api} session={current} enabled={enabled} onOpenShell={onOpenShell} /></App>
  const view = render(tree())
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(item.name) }))
  const button = await screen.findByRole('button', { name: 'workbench.docker.openShell' })
  return { ...view, tree, button, api, onOpenShell }
}

test('运行中的容器通过当前会话发送 Shell 意图，不调用容器生命周期操作', async () => {
  const view = await setup()
  expect(view.button).toBeEnabled()
  fireEvent.click(view.button)
  expect(view.onOpenShell).toHaveBeenCalledExactlyOnceWith('session-a', expect.stringContaining(`docker exec -it '${container.id}'`))
  expect(view.onOpenShell.mock.calls[0][1]).not.toContain(container.name)
  expect(view.api.sessionDockerContainerAction).not.toHaveBeenCalled()
  view.rerender(view.tree(false))
  expect(view.button).toBeDisabled()
  fireEvent.click(view.button)
  expect(view.onOpenShell).toHaveBeenCalledOnce()
})

test.each(['paused', 'exited', 'restarting'])('容器状态为 %s 时禁用 Shell 入口', async (state) => {
  const view = await setup({ ...container, state })
  expect(view.button).toBeDisabled()
  fireEvent.click(view.button)
  expect(view.onOpenShell).not.toHaveBeenCalled()
})

test('详情刷新期间禁用入口，刷新为停止状态后保持禁用', async () => {
  const view = await setup()
  let finish!: (detail: DockerContainerDetail) => void
  vi.mocked(view.api.sessionDockerContainerDetail).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'workbench.docker.refresh' }))
  await waitFor(() => {
    expect(view.button).toBeDisabled()
    expect(finish).toBeTypeOf('function')
  })
  await act(async () => { finish({ summary: { ...container, state: 'exited' }, collected_at: '' }) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'workbench.docker.start' })).toBeVisible())
  fireEvent.click(view.button)
  expect(view.onOpenShell).not.toHaveBeenCalled()
})

test('切换 SSH 会话后不能从旧容器详情发送命令', async () => {
  const view = await setup()
  view.rerender(view.tree(true, { ...session, id: 'session-b' }))
  expect(screen.queryByRole('button', { name: 'workbench.docker.openShell' })).not.toBeInTheDocument()
  fireEvent.click(view.button)
  expect(view.onOpenShell).not.toHaveBeenCalled()
})

test('容器暂停请求和后续详情刷新结束前不能进入终端，恢复运行后可再次进入', async () => {
  const view = await setup()
  let finish!: (result: DockerActionResult) => void
  vi.mocked(view.api.sessionDockerContainerAction).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'workbench.docker.pause' }))
  expect(view.button).toBeDisabled()
  fireEvent.click(view.button)
  expect(view.onOpenShell).not.toHaveBeenCalled()

  let refresh!: (detail: DockerContainerDetail) => void
  vi.mocked(view.api.sessionDockerContainerDetail).mockImplementationOnce(() => new Promise((resolve) => { refresh = resolve }))
  await act(async () => { finish({ action: 'pause', attempted: true, message: '', completed_at: '' }) })
  await waitFor(() => expect(refresh).toBeTypeOf('function'))
  expect(view.button).toBeDisabled()
  fireEvent.click(view.button)
  expect(view.onOpenShell).not.toHaveBeenCalled()
  await act(async () => { refresh({ summary: { ...container, state: 'paused' }, collected_at: '' }) })
  expect(view.button).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'workbench.docker.refresh' }))
  await waitFor(() => expect(view.button).toBeEnabled())
  fireEvent.click(view.button)
  expect(view.onOpenShell).toHaveBeenCalledOnce()
})
