import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'
import { AssistantExtensions } from './AssistantExtensions'

const translate = (key: string) => key
const native = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => native.value }))
afterEach(() => { native.value = undefined })

const source: AgentIntegrationSource = { id: 'ext_fixture', revision: 1, name: 'Fixture MCP', kind: 'mcp', enabled: true,
  startup_confirmed: true, mcp: { transport: 'http', url: 'https://example.test/mcp' }, secret_configured: false, created_at: '', updated_at: '' }
const disabled = { ...source, revision: 2, enabled: false }
function wrapper({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={{ token: { motion: false } }}><App>{children}</App></ConfigProvider>
}
function gateway(overrides: Partial<AgentIntegrationsGateway> = {}): AgentIntegrationsGateway {
  return { sources: vi.fn(async () => [source]), enabled: vi.fn(async () => disabled), saveMCP: vi.fn(), previewMCP: vi.fn(), remove: vi.fn(),
    confirmLaunch: vi.fn(), repairDependency: vi.fn(), dependency: vi.fn(), previewDependency: vi.fn(), confirmDependency: vi.fn(), cancelDependency: vi.fn(), dependencyOutput: vi.fn(),
    previewSkill: vi.fn(), publishSkill: vi.fn(), skillFile: vi.fn(), skillDependencies: vi.fn(), tools: vi.fn(), permissions: vi.fn(), setPermission: vi.fn(), policies: vi.fn(), setPolicy: vi.fn(), ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

it('关闭时保留列表与筛选，不插入全局操作条，成功回执直接更新开关', async () => {
  const pending = deferred<AgentIntegrationSource>()
  const api = gateway({ enabled: vi.fn(() => pending.promise) })
  render(<AssistantExtensions gateway={api} />, { wrapper })
  const toggle = await screen.findByRole('switch', { name: 'extensions.enabled Fixture MCP' })
  const list = screen.getByRole('list', { name: 'extensions.mcpTab' })
  const filter = screen.getByRole('textbox', { name: 'extensions.filter' })
  fireEvent.change(filter, { target: { value: 'Fixture' } })
  fireEvent.click(toggle)
  fireEvent.click(toggle)
  expect(api.enabled).toHaveBeenCalledOnce()
  expect(toggle).toBeDisabled()
  expect(toggle).toBeChecked()
  expect(within(list).getByRole('listitem')).toHaveAttribute('aria-busy', 'true')
  expect(screen.queryByText('extensions.processing')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'extensions.cancel' })).not.toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'extensions.mcpTab' })).toBe(list)
  await act(async () => pending.resolve(disabled))
  expect(toggle).not.toBeChecked()
  expect(toggle).toBeEnabled()
  expect(filter).toHaveValue('Fixture')
  expect(within(list).getByRole('listitem')).toHaveAttribute('aria-busy', 'false')
  expect(api.sources).toHaveBeenCalledOnce()
})

it('关闭成功后旧列表查询晚到不会让开关回弹', async () => {
  const stale = deferred<AgentIntegrationSource[]>()
  const api = gateway({ sources: vi.fn().mockResolvedValueOnce([source]).mockImplementationOnce(() => stale.promise) })
  render(<AssistantExtensions gateway={api} />, { wrapper })
  const toggle = await screen.findByRole('switch', { name: 'extensions.enabled Fixture MCP' })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.refresh' }))
  await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2))
  const signal = vi.mocked(api.sources).mock.calls[1]?.[0]
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  expect(signal?.aborted).toBe(true)
  await act(async () => stale.resolve([source]))
  expect(toggle).not.toBeChecked()
  expect(toggle).toBeEnabled()
})

it('关闭期间从详情触发的查询不能覆盖随后确认的开关状态', async () => {
  const pending = deferred<AgentIntegrationSource>()
  const stale = deferred<AgentIntegrationSource[]>()
  const api = gateway({ sources: vi.fn().mockResolvedValueOnce([source]).mockImplementationOnce(() => stale.promise),
    enabled: vi.fn(() => pending.promise), tools: vi.fn(async () => []), permissions: vi.fn(async () => []) })
  render(<AssistantExtensions gateway={api} />, { wrapper })
  const toggle = await screen.findByRole('switch', { name: 'extensions.enabled Fixture MCP' })
  fireEvent.click(toggle)
  fireEvent.click(screen.getByRole('button', { name: source.name }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2))
  const signal = vi.mocked(api.sources).mock.calls[1]?.[0]
  await act(async () => pending.resolve(disabled))
  expect(toggle).not.toBeChecked()
  await act(async () => stale.resolve([source]))
  expect(toggle).not.toBeChecked()
  expect(signal?.aborted).toBe(true)
  expect(toggle).toBeEnabled()
})

it('关闭回执晚于其他客户端的新修订时保留已经读取的新配置', async () => {
  const pending = deferred<AgentIntegrationSource>()
  const latest = { ...source, revision: 3, name: 'Latest MCP' }
  const api = gateway({ sources: vi.fn().mockResolvedValueOnce([source]).mockResolvedValueOnce([latest]),
    enabled: vi.fn(() => pending.promise), tools: vi.fn(async () => []), permissions: vi.fn(async () => []) })
  render(<AssistantExtensions gateway={api} />, { wrapper })
  fireEvent.click(await screen.findByRole('switch', { name: 'extensions.enabled Fixture MCP' }))
  fireEvent.click(screen.getByRole('button', { name: source.name }))
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close' }))
  const toggle = await screen.findByRole('switch', { name: 'extensions.enabled Latest MCP' })
  await act(async () => pending.resolve(disabled))
  expect(toggle).toBeChecked()
  expect(toggle).toHaveAccessibleName('extensions.enabled Latest MCP')
  expect(toggle).toBeEnabled()
})

it('关闭请求响应丢失后重新核对实际状态，对账完成前不释放操作锁', async () => {
  const refreshed = deferred<AgentIntegrationSource[]>()
  const api = gateway({ sources: vi.fn().mockResolvedValueOnce([source]).mockImplementationOnce(() => refreshed.promise),
    enabled: vi.fn().mockRejectedValue(new Error('合成响应丢失')) })
  const { container } = render(<AssistantExtensions gateway={api} />, { wrapper })
  const toggle = await screen.findByRole('switch', { name: 'extensions.enabled Fixture MCP' })
  fireEvent.click(toggle)
  await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2))
  expect(toggle).toBeChecked()
  expect(toggle).toBeDisabled()
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('合成响应丢失')
  expect(container).not.toContainElement(notice)
  await act(async () => refreshed.resolve([disabled]))
  expect(toggle).not.toBeChecked()
  expect(toggle).toBeEnabled()
  expect(api.enabled).toHaveBeenCalledOnce()
})

it('请求与对账都失败时保留原状态并恢复操作，不虚报已关闭', async () => {
  const api = gateway({ sources: vi.fn().mockResolvedValueOnce([source]).mockRejectedValueOnce(new Error('合成对账失败')),
    enabled: vi.fn().mockRejectedValue(new Error('合成关闭失败')) })
  render(<AssistantExtensions gateway={api} />, { wrapper })
  const toggle = await screen.findByRole('switch', { name: 'extensions.enabled Fixture MCP' })
  fireEvent.click(toggle)
  await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(toggle).toBeChecked()
  expect(await screen.findByRole('alert')).toHaveTextContent('合成对账失败')
})

it('离开设置后晚到的关闭回执不覆盖重新进入时读取的新状态', async () => {
  const pending = deferred<AgentIntegrationSource>()
  const latest = { ...source, revision: 3 }
  const api = gateway({ sources: vi.fn().mockResolvedValueOnce([source]).mockResolvedValueOnce([latest]), enabled: vi.fn(() => pending.promise) })
  const view = render(<AssistantExtensions gateway={api} />, { wrapper })
  fireEvent.click(await screen.findByRole('switch', { name: 'extensions.enabled Fixture MCP' }))
  const signal = vi.mocked(api.enabled).mock.calls[0]?.[2]
  view.rerender(<AssistantExtensions gateway={api} active={false} />)
  expect(signal?.aborted).toBe(true)
  view.rerender(<AssistantExtensions gateway={api} active />)
  await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2))
  await act(async () => pending.resolve(disabled))
  expect(screen.getByRole('switch', { name: 'extensions.enabled Fixture MCP' })).toBeChecked()
  expect(screen.getByRole('switch', { name: 'extensions.enabled Fixture MCP' })).toBeEnabled()
})

it('连接测试以浮动消息显示进度，取消送达前保留等待并阻止重复取消', async () => {
  const test = vi.fn(() => new Promise<never>(() => {}))
  const cancellation = deferred<void>()
  const cancel = vi.fn(() => cancellation.promise)
  native.value = { agentIntegrations: { status: vi.fn(async () => []), test, cancel } }
  const api = gateway()
  const { container } = render(<AssistantExtensions gateway={api} />, { wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'extensions.moreActions Fixture MCP' }))
  const list = screen.getByRole('list', { name: 'extensions.mcpTab' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'extensions.test' }))
  const notice = await screen.findByRole('status')
  expect(notice).toHaveTextContent('extensions.operation.test')
  expect(notice).toHaveTextContent(source.name)
  expect(container).not.toContainElement(notice)
  expect(screen.queryByText('extensions.processing')).not.toBeInTheDocument()
  expect(screen.getByRole('list', { name: 'extensions.mcpTab' })).toBe(list)
  expect(test).toHaveBeenCalledOnce()
  const cancelButton = within(notice).getByRole('button', { name: 'extensions.cancel' })
  fireEvent.click(cancelButton);fireEvent.click(cancelButton)
  await waitFor(() => expect(cancel).toHaveBeenCalledOnce())
  const cancelling = await screen.findByRole('status')
  expect(cancelling).toHaveTextContent('extensions.cancelling')
  expect(within(cancelling).getByRole('button', { name: 'extensions.cancel' })).toBeDisabled()
  expect(api.sources).toHaveBeenCalledOnce()
  await act(async () => cancellation.resolve())
  await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByText('extensions.cancelling')).not.toBeInTheDocument())
  expect(screen.getByRole('switch', { name: 'extensions.enabled Fixture MCP' })).toBeEnabled()
})

it('测试成功后移除浮动进度，只显示成功提示，保留原列表与启用状态', async () => {
  const result = deferred<{ tools: never[]; generation: string }>()
  native.value = { agentIntegrations: { status: vi.fn(async () => []), test: vi.fn(() => result.promise), cancel: vi.fn() } }
  const api = gateway()
  render(<AssistantExtensions gateway={api} />, { wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'extensions.moreActions Fixture MCP' }))
  const list = screen.getByRole('list', { name: 'extensions.mcpTab' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'extensions.test' }))
  expect(await screen.findByText('extensions.operation.test')).toBeVisible()
  await act(async () => result.resolve({ tools: [], generation: 'fixture' }))
  expect(await screen.findByText('extensions.connected')).toBeVisible()
  await waitFor(() => expect(screen.queryByText('extensions.operation.test')).not.toBeInTheDocument())
  expect(screen.getByRole('list', { name: 'extensions.mcpTab' })).toBe(list)
  expect(screen.getByRole('switch', { name: 'extensions.enabled Fixture MCP' })).toBeChecked()
  expect(api.enabled).not.toHaveBeenCalled()
})

it('取消控制请求失败仍显示错误，不把已发送取消误当作已停止', async () => {
  const cancel = vi.fn().mockRejectedValue(new Error('合成取消失败'))
  native.value = { agentIntegrations: { status: vi.fn(async () => []), test: vi.fn(() => new Promise<never>(() => {})), cancel } }
  const api = gateway()
  render(<AssistantExtensions gateway={api} />, { wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'extensions.moreActions Fixture MCP' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'extensions.test' }))
  fireEvent.click(await screen.findByRole('button', { name: 'extensions.cancel' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('extensions.cancelFailed')
  await waitFor(() => expect(api.sources).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByText('extensions.cancelling')).not.toBeInTheDocument())
  expect(screen.queryByText('extensions.connected')).not.toBeInTheDocument()
})
