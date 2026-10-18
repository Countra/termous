import { App, ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { DockerCapability } from '#entities/docker'
import type { DockerGateway } from '../model/contracts'
import { DockerPanel } from './DockerPanel'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const unavailable: DockerCapability = { available: false, status: 'missing_cli', message: 'Docker CLI not found', collected_at: '' }

function setup(capability = unavailable) {
  const api: DockerGateway = {
    sessionDockerCapability: vi.fn<DockerGateway['sessionDockerCapability']>(async () => capability),
    sessionDockerContainers: vi.fn(async () => ({ items: [], total: 0, filtered: 0, collected_at: '' })),
    sessionDockerContainerDetail: vi.fn(), sessionDockerContainerStats: vi.fn(),
    sessionDockerContainerLogs: vi.fn(), sessionDockerContainerAction: vi.fn(),
    sessionDockerResources: vi.fn(), sessionDockerResourceDetail: vi.fn(),
    sessionDockerResourceCreate: vi.fn(), sessionDockerResourceAction: vi.fn(),
  }
  const tree = (enabled = true) => <ConfigProvider theme={{ token: { motion: false } }}><App>
    <DockerPanel api={api} session={{ id: 'ssh-a', kind: 'ssh', status: 'connected' }} enabled={enabled} onOpenShell={vi.fn()} />
  </App></ConfigProvider>
  return { api, tree }
}

test.each(['containers', 'images', 'volumes', 'networks'])('%s 未就绪时只展示一份状态和重试入口，不展示搜索及创建操作', async (mode) => {
  const { api, tree } = setup()
  render(tree())
  await screen.findByRole('heading', { name: 'workbench.docker.missingCli' })
  if (mode !== 'containers') fireEvent.click(screen.getByRole('tab', { name: `workbench.docker.resources.${mode}` }))
  await screen.findByRole('heading', { name: 'workbench.docker.missingCli' })
  expect(within(screen.getByRole('tabpanel')).getAllByText('workbench.docker.missingCli')).toHaveLength(1)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /create_/ })).not.toBeInTheDocument()
  const previousChecks = vi.mocked(api.sessionDockerCapability).mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'workbench.docker.detectAgain' }))
  await waitFor(() => expect(api.sessionDockerCapability).toHaveBeenCalledTimes(previousChecks + 1))
  expect(api.sessionDockerContainers).not.toHaveBeenCalled()
  expect(api.sessionDockerResources).not.toHaveBeenCalled()
})

test.each(['containers', 'images'])('%s 首次检测失败后展示错误，等待手动重试后恢复列表', async (mode) => {
  const { api, tree } = setup({ available: true, status: 'available', collected_at: '' })
  vi.mocked(api.sessionDockerCapability).mockRejectedValue(new Error('connection lost'))
  render(tree())
  await screen.findByRole('heading', { name: 'workbench.docker.detectionFailed' })
  if (mode !== 'containers') fireEvent.click(screen.getByRole('tab', { name: `workbench.docker.resources.${mode}` }))
  await screen.findByRole('heading', { name: 'workbench.docker.detectionFailed' })
  const previousChecks = vi.mocked(api.sessionDockerCapability).mock.calls.length
  expect(previousChecks).toBe(mode === 'containers' ? 1 : 2)
  expect(within(screen.getByRole('tabpanel')).getByText('connection lost')).toBeInTheDocument()
  vi.mocked(api.sessionDockerCapability).mockResolvedValue({ available: true, status: 'available', collected_at: '' })
  vi.mocked(api.sessionDockerResources).mockResolvedValue({ items: [], total: 0, filtered: 0, offset: 0, limit: 100, collected_at: '' })
  fireEvent.click(screen.getByRole('button', { name: 'workbench.docker.detectAgain' }))
  await screen.findByRole('button', { name: 'workbench.docker.refresh' })
  expect(screen.getByRole('textbox')).toBeVisible()
  expect(api.sessionDockerCapability).toHaveBeenCalledTimes(previousChecks + 1)
  expect(screen.queryByRole('heading', { name: 'workbench.docker.detectionFailed' })).not.toBeInTheDocument()
})

test('重新检测期间阻止重复请求，停用面板时禁用重试', async () => {
  const { api, tree } = setup()
  const view = render(tree())
  const button = await screen.findByRole('button', { name: 'workbench.docker.detectAgain' })
  let finish!: (capability: DockerCapability) => void
  vi.mocked(api.sessionDockerCapability).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(button)
  expect(button).toHaveClass('ant-btn-loading')
  fireEvent.click(button)
  expect(api.sessionDockerCapability).toHaveBeenCalledTimes(2)
  await act(async () => finish(unavailable))
  view.rerender(tree(false))
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(api.sessionDockerCapability).toHaveBeenCalledTimes(2)
})

test.each(['containers', 'images'])('%s 检测异常没有错误文案时仍可重试，不停留在加载状态或连续请求', async (mode) => {
  const { api, tree } = setup()
  vi.mocked(api.sessionDockerCapability).mockRejectedValue(new Error())
  render(tree())
  await screen.findByRole('heading', { name: 'workbench.docker.detectionFailed' })
  if (mode !== 'containers') fireEvent.click(screen.getByRole('tab', { name: `workbench.docker.resources.${mode}` }))
  await screen.findByRole('heading', { name: 'workbench.docker.detectionFailed' })
  expect(api.sessionDockerCapability).toHaveBeenCalledTimes(mode === 'containers' ? 1 : 2)
  vi.mocked(api.sessionDockerCapability).mockResolvedValue(unavailable)
  fireEvent.click(screen.getByRole('button', { name: 'workbench.docker.detectAgain' }))
  await screen.findByRole('heading', { name: 'workbench.docker.missingCli' })
  expect(api.sessionDockerCapability).toHaveBeenCalledTimes(mode === 'containers' ? 2 : 3)
})

test.each(['SSH channel closed', unavailable.message!])('已有未安装结果时重新检测失败（%s），展示当前错误而不是过期结论', async (message) => {
  const { api, tree } = setup()
  render(tree())
  const button = await screen.findByRole('button', { name: 'workbench.docker.detectAgain' })
  vi.mocked(api.sessionDockerCapability).mockRejectedValueOnce(new Error(message))
  fireEvent.click(button)
  await screen.findByRole('heading', { name: 'workbench.docker.detectionFailed' })
  expect(screen.queryByRole('heading', { name: 'workbench.docker.missingCli' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('tabpanel')).getByText(message)).toBeInTheDocument()
  expect(api.sessionDockerCapability).toHaveBeenCalledTimes(2)
})
