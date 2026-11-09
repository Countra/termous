import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentLocalDirectory } from '#entities/agent'
import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { LocalDirectoryPicker } from './LocalDirectoryPicker'

const translate = (key: string) => key
const native = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => native.value }))
afterEach(() => { native.value = undefined })
const directory: AgentLocalDirectory = { path: 'D:/workspace', revision: 3, managed: true }

async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'localTools.workspace' }))
  return screen.findByRole('textbox', { name: 'localTools.directory' })
}

it('按原修订号应用修改，合并重复提交；关闭后重新读取实际目录', async () => {
  let complete!: (value: AgentLocalDirectory) => void
  const read = vi.fn(async () => directory)
  const change = vi.fn(() => new Promise<AgentLocalDirectory>(resolve => { complete = resolve }))
  render(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  const input = await open()
  expect(screen.getByRole('button', { name: 'localTools.applyDirectory' })).toBeDisabled()
  fireEvent.change(input, { target: { value: '  E:/project  ' } })
  fireEvent.keyDown(input, { key: 'Enter' }); fireEvent.keyDown(input, { key: 'Enter' })
  expect(change).toHaveBeenCalledExactlyOnceWith('E:/project', 3)
  expect(input).toBeDisabled()
  await act(async () => complete({ path: 'E:/project', revision: 4, managed: false }))
  expect(screen.getByRole('button', { name: 'localTools.workspace' })).toHaveAttribute('aria-expanded', 'false')
  await open()
  expect(read).toHaveBeenCalledTimes(2)
})

it('加载失败提供重试，保存失败保留草稿且通过浮动消息反馈', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('合成读取失败')).mockResolvedValue(directory)
  const change = vi.fn().mockRejectedValue(new Error('合成保存失败'))
  render(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'localTools.workspace' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('合成读取失败')
  fireEvent.click(screen.getByRole('button', { name: 'extensions.preferences.retry' }))
  const input = await screen.findByRole('textbox', { name: 'localTools.directory' })
  fireEvent.change(input, { target: { value: 'E:/project' } })
  fireEvent.click(screen.getByRole('button', { name: 'localTools.applyDirectory' }))
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('合成保存失败')
  expect(screen.getByRole('region', { name: 'localTools.workspace' })).not.toContainElement(notice)
  expect(input).toHaveValue('E:/project')
  expect(input).toBeEnabled()
})

it('中文输入法确认路径不触发保存，普通回车仍可以应用', async () => {
  const change = vi.fn(async () => ({ path: 'E:/项目', revision: 4, managed: false }))
  render(<LocalDirectoryPicker sessionKey="one" read={async () => directory} change={change} />)
  const input = await open()
  fireEvent.change(input, { target: { value: 'E:/项目' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  expect(change).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith('E:/项目', 3))
})

it('任务运行时可查看目录，但不能输入、更换或提交', async () => {
  const pick = vi.fn()
  const change = vi.fn()
  native.value = { files: { pickDirectory: pick } }
  render(<LocalDirectoryPicker sessionKey="one" read={async () => directory} change={change} running />)
  const input = await open()
  expect(input).toBeDisabled()
  expect(screen.getByRole('button', { name: 'extensions.chooseDirectory' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'localTools.applyDirectory' })).not.toBeInTheDocument()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(change).not.toHaveBeenCalled()
  expect(pick).not.toHaveBeenCalled()
})

it.each(['close', 'session', 'running'] as const)('系统选择结果在 %s 后失效，不会覆盖当前目录', async action => {
  let complete!: (paths: string[]) => void
  const pick = vi.fn(() => new Promise<string[]>(resolve => { complete = resolve }))
  native.value = { files: { pickDirectory: pick } }
  const read = vi.fn(async () => directory)
  const change = vi.fn()
  const view = render(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  await open()
  const choose = screen.getByRole('button', { name: 'extensions.chooseDirectory' })
  fireEvent.click(choose); fireEvent.click(choose)
  expect(pick).toHaveBeenCalledOnce()
  if (action === 'close') {
    fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
    await open()
  } else {
    view.rerender(<LocalDirectoryPicker sessionKey={action === 'session' ? 'two' : 'one'} read={read} change={change} running={action === 'running'} />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'localTools.directory' })).toHaveValue(directory.path))
  }
  await act(async () => complete(['E:/late-choice']))
  expect(screen.getByRole('textbox', { name: 'localTools.directory' })).toHaveValue(directory.path)
  expect(change).not.toHaveBeenCalled()
})

it('目录选择只填写草稿，确认应用才更新会话', async () => {
  native.value = { files: { pickDirectory: vi.fn(async () => ['E:/selected']) } }
  const change = vi.fn(async () => ({ path: 'E:/selected', revision: 4, managed: false }))
  render(<LocalDirectoryPicker sessionKey="one" read={async () => directory} change={change} />)
  const input = await open()
  fireEvent.click(screen.getByRole('button', { name: 'extensions.chooseDirectory' }))
  await waitFor(() => expect(input).toHaveValue('E:/selected'))
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'localTools.applyDirectory' }))
  expect(change).toHaveBeenCalledExactlyOnceWith('E:/selected', 3)
})

it('会话切换后丢弃旧读取和保存结果；新会话不展示旧路径', async () => {
  let readComplete!: (value: AgentLocalDirectory) => void
  let saveComplete!: (value: AgentLocalDirectory) => void
  const read = vi.fn().mockResolvedValueOnce(directory).mockImplementationOnce(() => new Promise<AgentLocalDirectory>(resolve => { readComplete = resolve }))
  const change = vi.fn(() => new Promise<AgentLocalDirectory>(resolve => { saveComplete = resolve }))
  const view = render(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  const input = await open()
  fireEvent.change(input, { target: { value: 'E:/old-save' } })
  fireEvent.click(screen.getByRole('button', { name: 'localTools.applyDirectory' }))
  view.rerender(<LocalDirectoryPicker sessionKey="two" read={read} change={change} />)
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await act(async () => saveComplete({ path: 'E:/old-save', revision: 4, managed: false }))
  await act(async () => readComplete({ path: 'F:/new-session', revision: 1, managed: true }))
  expect(screen.getByRole('textbox', { name: 'localTools.directory' })).toHaveValue('F:/new-session')
  expect(screen.getByRole('button', { name: 'localTools.workspace' })).toHaveAttribute('aria-expanded', 'true')
})

it('不同会话分别保存，旧请求结束不能解除当前会话的保存状态', async () => {
  const complete: Array<(value: AgentLocalDirectory) => void> = []
  const read = vi.fn(async () => directory)
  const change = vi.fn(() => new Promise<AgentLocalDirectory>(resolve => { complete.push(resolve) }))
  const view = render(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  fireEvent.change(await open(), { target: { value: 'E:/one' } })
  fireEvent.click(screen.getByRole('button', { name: 'localTools.applyDirectory' }))
  view.rerender(<LocalDirectoryPicker sessionKey="two" read={read} change={change} />)
  const input = await screen.findByRole('textbox', { name: 'localTools.directory' })
  fireEvent.change(input, { target: { value: 'E:/two' } })
  fireEvent.click(screen.getByRole('button', { name: 'localTools.applyDirectory' }))
  expect(change).toHaveBeenCalledTimes(2)
  await act(async () => complete[0]({ path: 'E:/one', revision: 4, managed: false }))
  expect(input).toBeDisabled()
  await act(async () => complete[1]({ path: 'E:/two', revision: 4, managed: false }))
  expect(screen.getByRole('button', { name: 'localTools.workspace' })).toHaveAttribute('aria-expanded', 'false')
})

it('重新打开工作区后等原保存完成再读取，不显示过期目录或无响应的应用按钮', async () => {
  let complete!: (value: AgentLocalDirectory) => void
  let snapshot = directory
  const read = vi.fn(async () => snapshot)
  const change = vi.fn(() => new Promise<AgentLocalDirectory>(resolve => { complete = resolve }))
  render(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  fireEvent.change(await open(), { target: { value: 'E:/project' } })
  fireEvent.click(screen.getByRole('button', { name: 'localTools.applyDirectory' }))
  fireEvent.click(screen.getByRole('button', { name: 'app.close' }))
  fireEvent.click(screen.getByRole('button', { name: 'localTools.workspace' }))
  await act(async () => {})
  expect(read).toHaveBeenCalledOnce()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  snapshot = { path: 'E:/project', revision: 4, managed: false }
  await act(async () => complete(snapshot))
  expect(await screen.findByRole('textbox', { name: 'localTools.directory' })).toHaveValue('E:/project')
  expect(read).toHaveBeenCalledTimes(2)
})

it('页面隐藏时关闭工作区并丢弃系统选择窗口的晚到结果', async () => {
  let complete!: (paths: string[]) => void
  native.value = { files: { pickDirectory: vi.fn(() => new Promise<string[]>(resolve => { complete = resolve })) } }
  const read = vi.fn(async () => directory)
  const change = vi.fn()
  const view = render(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'extensions.chooseDirectory' }))
  view.rerender(<LocalDirectoryPicker sessionKey="one" read={read} change={change} active={false} />)
  await act(async () => complete(['E:/late']))
  view.rerender(<LocalDirectoryPicker sessionKey="one" read={read} change={change} />)
  expect(screen.getByRole('button', { name: 'localTools.workspace' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(change).not.toHaveBeenCalled()
})
