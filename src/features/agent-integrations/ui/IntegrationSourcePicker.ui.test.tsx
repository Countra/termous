import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { IntegrationSelection } from '#entities/agent-integrations'
import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { IntegrationSourcePicker } from './IntegrationSourcePicker'

const translate = (key: string) => key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
afterEach(() => vi.useRealTimers())
const data: IntegrationSelection = { sources: [
  { id: 'docs', name: 'Documentation', kind: 'mcp', enabled: true, connection: 'connected' },
  { id: 'disabled', name: 'Disabled MCP', kind: 'mcp', enabled: false },
  { id: 'review', name: 'Design review', description: 'Inspect keyboard access', kind: 'skill', enabled: true, version: 'v1' },
], policies: [] }

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'extensions.title' }))
  return screen.findByRole('switch', { name: 'extensions.sessionEnabled Documentation' })
}

it('打开与搜索只读取声明，不更新策略；未全局启用的来源不可开启', async () => {
  const read = vi.fn(async () => data)
  const change = vi.fn()
  render(<IntegrationSourcePicker sessionKey="one" read={read} change={change} />)
  expect(read).not.toHaveBeenCalled()
  await open()
  expect(screen.getByRole('switch', { name: 'extensions.sessionEnabled Disabled MCP' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'extensions.filter' }), { target: { value: 'documentation' } })
  expect(screen.queryByRole('switch', { name: 'extensions.sessionEnabled Disabled MCP' })).not.toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'extensions.sessionEnabled Documentation' })).toBeChecked()
  expect(change).not.toHaveBeenCalled()
})

it('Skill 可用开关保留原固定版本，主动选择新任务单独更新版本', async () => {
  const change = vi.fn(async () => {})
  render(<IntegrationSourcePicker sessionKey="one" read={async () => ({ ...data, policies: [{ source_id: 'review', disabled: false, skill_version: 'v1' }] })} change={change} />)
  await open()
  fireEvent.click(screen.getByRole('tab', { name: /extensions.skillTab/u }))
  const checkbox = screen.getByRole('checkbox', { name: 'extensions.selectSkill' })
  expect(checkbox).toBeChecked()
  fireEvent.click(checkbox)
  await waitFor(() => expect(checkbox).not.toBeChecked())
  expect(change).toHaveBeenLastCalledWith({ source_id: 'review', disabled: false, skill_version: '' })
  fireEvent.click(checkbox)
  await waitFor(() => expect(checkbox).toBeChecked())
  fireEvent.click(screen.getByRole('switch', { name: 'extensions.sessionEnabled Design review' }))
  await waitFor(() => expect(change).toHaveBeenLastCalledWith({ source_id: 'review', disabled: true, skill_version: 'v1' }))
  expect(checkbox).toBeDisabled()
})

it('保存失败保留原开关状态，错误使用浮动消息，重复点击不重复提交', async () => {
  let fail!: (cause: Error) => void
  const change = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject }))
  render(<IntegrationSourcePicker sessionKey="one" read={async () => data} change={change} />)
  const toggle = await open()
  fireEvent.click(toggle); fireEvent.click(toggle)
  expect(change).toHaveBeenCalledOnce()
  expect(toggle).toBeChecked()
  expect(toggle).toBeDisabled()
  await act(async () => fail(new Error('合成策略保存失败')))
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('合成策略保存失败')
  expect(screen.getByRole('region', { name: 'extensions.picker.title' })).not.toContainElement(notice)
  expect(toggle).toBeChecked()
  expect(toggle).toBeEnabled()
})

it('保存前发起的轮询回执不能覆盖已经更新的策略，关闭后停止轮询', async () => {
  vi.useFakeTimers()
  let complete!: (value: IntegrationSelection) => void
  const read = vi.fn().mockResolvedValueOnce(data).mockImplementationOnce(() => new Promise<IntegrationSelection>(resolve => { complete = resolve }))
  render(<IntegrationSourcePicker sessionKey="one" read={read} change={async () => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.title' }))
  await act(async () => vi.advanceTimersByTimeAsync(100))
  const toggle = screen.getByRole('switch', { name: 'extensions.sessionEnabled Documentation' })
  await act(async () => vi.advanceTimersByTimeAsync(2000))
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => fireEvent.click(toggle))
  expect(toggle).not.toBeChecked()
  await act(async () => complete(data))
  expect(toggle).not.toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
  await act(async () => vi.advanceTimersByTime(4000))
  expect(read).toHaveBeenCalledTimes(2)
})

it('切换会话后忽略旧读取结果，空列表也可以用键盘切换分类', async () => {
  let complete!: (value: IntegrationSelection) => void
  const read = vi.fn().mockImplementationOnce(() => new Promise<IntegrationSelection>(resolve => { complete = resolve }))
    .mockResolvedValue({ sources: [], policies: [] })
  const change = vi.fn()
  const view = render(<IntegrationSourcePicker sessionKey="one" read={read} change={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.title' }))
  view.rerender(<IntegrationSourcePicker sessionKey="two" read={read} change={change} />)
  await waitFor(() => expect(screen.getByText('extensions.emptyMCP')).toBeVisible())
  await act(async () => complete(data))
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('tab', { name: /extensions.mcpTab/u }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: /extensions.skillTab/u })).toHaveFocus()
  expect(screen.getByText('extensions.emptySkills')).toBeVisible()
  fireEvent.keyDown(screen.getByRole('tab', { name: /extensions.skillTab/u }), { key: 'Escape' })
  expect(screen.getByRole('button', { name: 'extensions.title' })).toHaveAttribute('aria-expanded', 'false')
})

it('首次加载失败可重试，重试不改变会话策略', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('合成目录读取失败')).mockResolvedValue(data)
  const change = vi.fn()
  render(<IntegrationSourcePicker sessionKey="one" read={read} change={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.title' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('合成目录读取失败')
  fireEvent.click(screen.getByRole('button', { name: 'extensions.preferences.retry' }))
  expect(await screen.findByRole('switch', { name: 'extensions.sessionEnabled Documentation' })).toBeChecked()
  expect(change).not.toHaveBeenCalled()
})

it('关闭再打开时等待原保存收敛，不允许并发覆盖同一会话策略', async () => {
  let complete!: () => void
  let snapshot = data
  const read = vi.fn(async () => snapshot)
  const change = vi.fn(() => new Promise<void>(resolve => { complete = resolve }))
  render(<IntegrationSourcePicker sessionKey="one" read={read} change={change} />)
  fireEvent.click(await open())
  fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
  fireEvent.click(screen.getByRole('button', { name: 'extensions.title' }))
  await act(async () => {})
  expect(read).toHaveBeenCalledOnce()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  snapshot = { ...data, policies: [{ source_id: 'docs', disabled: true }] }
  await act(async () => complete())
  expect(await screen.findByRole('switch', { name: 'extensions.sessionEnabled Documentation' })).not.toBeChecked()
  expect(read).toHaveBeenCalledTimes(2)
  expect(change).toHaveBeenCalledOnce()
})

it('隐藏助手页后关闭弹层和通知，返回页面不恢复旧弹层', async () => {
  const read = vi.fn(async () => data)
  const change = vi.fn(async () => {})
  const view = render(<IntegrationSourcePicker sessionKey="one" read={read} change={change} />)
  await open()
  view.rerender(<IntegrationSourcePicker sessionKey="one" read={read} change={change} active={false} />)
  await waitFor(() => expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument())
  view.rerender(<IntegrationSourcePicker sessionKey="one" read={read} change={change} />)
  expect(screen.getByRole('button', { name: 'extensions.title' })).toHaveAttribute('aria-expanded', 'false')
  expect(read).toHaveBeenCalledOnce()
})

it('会话切换后独立保存，旧保存结束不解除当前会话的提交限制', async () => {
  const complete: Array<() => void> = []
  const read = vi.fn(async () => data)
  const change = vi.fn(() => new Promise<void>(resolve => { complete.push(resolve) }))
  const view = render(<IntegrationSourcePicker sessionKey="one" read={read} change={change} />)
  fireEvent.click(await open())
  view.rerender(<IntegrationSourcePicker sessionKey="two" read={read} change={change} />)
  const toggle = await screen.findByRole('switch', { name: 'extensions.sessionEnabled Documentation' })
  fireEvent.click(toggle)
  expect(change).toHaveBeenCalledTimes(2)
  await act(async () => complete[0]())
  expect(toggle).toBeDisabled()
  expect(toggle).toBeChecked()
  await act(async () => complete[1]())
  expect(toggle).toBeEnabled()
  expect(toggle).not.toBeChecked()
})
