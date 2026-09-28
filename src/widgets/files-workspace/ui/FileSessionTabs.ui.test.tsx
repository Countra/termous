import { App as AntdApp, ConfigProvider } from 'antd'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { FileSession } from '#entities/file'
import { FileSessionTabs } from './FileSessionTabs'
import { fileSessionTabPreferencesKey } from '../model/useFileSessionTabActions'
import { FilesWorkspaceRuntimeProvider } from '../model/FilesWorkspaceRuntimeProvider'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const first: FileSession = {
  id: 'files-a', host_id: 'host-a', file_access_profile_id: 'profile-a',
  origin: 'app', status: 'connected', current_path: '/a', started_at: '2026-09-28T00:00:00Z',
}
const second: FileSession = { ...first, id: 'files-b', host_id: 'host-b', file_access_profile_id: 'profile-b', current_path: '/b' }
const hosts = [{ id: 'host-a', name: 'Alpha' }, { id: 'host-b', name: 'Beta' }]
type Props = ComponentProps<typeof FileSessionTabs>

function createProps(overrides: Partial<Props> = {}): Props {
  return {
    sessions: [first, second], hosts, activeId: first.id, closingIds: new Set(),
    getHostIconUrl: () => '', getPath: (session) => session.current_path,
    onConnect: vi.fn(async () => ({ ...first, id: 'files-new' })), onClose: vi.fn(async () => true),
    onRestart: vi.fn(async () => ({ ...first, id: 'restarted' })),
    onSelect: vi.fn(), onAuxClose: vi.fn(), onOpenLauncher: vi.fn(), ...overrides,
  }
}

function renderTabs(props = createProps()) {
  const tree = (next: Props) => <ConfigProvider theme={{ token: { motion: false } }}><AntdApp>
    <FilesWorkspaceRuntimeProvider fileSessions={next.sessions}><FileSessionTabs {...next} /></FilesWorkspaceRuntimeProvider>
  </AntdApp></ConfigProvider>
  const view = render(tree(props))
  return { ...view, rerenderTabs: (next: Props) => view.rerender(tree(next)), props }
}

async function action(tab: string, key: string) {
  fireEvent.contextMenu(screen.getByRole('tab', { name: new RegExp(`^${tab}(?:[， ]|$)`) }))
  const item = await screen.findByRole('menuitem', { name: `terminal.tabMenu.${key}` })
  await waitFor(() => expect(item).toBeVisible())
  fireEvent.click(item)
}

let scrollToDescriptor: PropertyDescriptor | undefined
beforeEach(() => {
  scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  localStorage.removeItem(fileSessionTabPreferencesKey)
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

test('文件标签菜单保持六项操作及 AI 助手引用入口', async () => {
  renderTabs(createProps({
    getAgentConnectionReferenceSnapshot: () => ({ ready: true, enabled: true, targets: [] }),
    onReferenceAgentConnection: vi.fn(),
  }))
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^Alpha(?:[， ]|$)/ }))
  const menu = await screen.findByRole('menu')
  await waitFor(() => expect(menu).toBeVisible())
  for (const key of ['duplicate', 'restart', 'rename', 'pin', 'color', 'reset']) {
    expect(within(menu).getByRole('menuitem', { name: `terminal.tabMenu.${key}` })).toBeVisible()
  }
  expect(within(menu).getByRole('menuitem', { name: /agent.launch.action/ })).toBeVisible()
  expect(within(menu).getByRole('menuitem', { name: 'terminal.tabMenu.reset' })).toHaveAttribute('aria-disabled', 'true')
})

test('后台标签改名、固定、着色持久保存，重置只影响指定标签', async () => {
  const view = renderTabs()
  await action('Beta', 'rename')
  fireEvent.change(screen.getByRole('textbox', { name: 'terminal.tabMenu.renameTitle' }), { target: { value: '  Storage  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'app.confirm' }))
  await screen.findByRole('tab', { name: /^Storage(?:[， ]|$)/ })
  await action('Storage', 'pin')
  expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Storage')
  await action('Storage', 'color')
  const swatches = await screen.findAllByRole('button', { name: 'terminal.tabMenu.colorValue' })
  fireEvent.click(swatches[0])
  await waitFor(() => expect(JSON.parse(localStorage.getItem(fileSessionTabPreferencesKey)!)[second.id]).toMatchObject({
    title: 'Storage', pinned: true, color: '#e11d48',
  }))
  expect(view.props.onSelect).not.toHaveBeenCalled()
  view.unmount()
  const reopened = renderTabs()
  expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Storage')
  await action('Storage', 'reset')
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Alpha'), expect.stringContaining('Beta')]))
  expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Alpha')
  await waitFor(() => expect(JSON.parse(localStorage.getItem(fileSessionTabPreferencesKey)!)).toEqual({}))
  expect(reopened.props.onConnect).not.toHaveBeenCalled()
})

test('复制后台标签使用该标签的文件配置和目录，不携带来源以免复用原会话', async () => {
  const view = renderTabs(createProps({ sessions: [first, { ...second, source_session_id: 'ssh-b' }] }))
  await action('Beta', 'duplicate')
  await waitFor(() => expect(view.props.onConnect).toHaveBeenCalledWith({ fileAccessProfileId: 'profile-b', initialPath: '/b' }))
  expect(view.props.onClose).not.toHaveBeenCalled()
})

test('重启期间切换页面，后台完成后仍继承原标签外观', async () => {
  localStorage.setItem(fileSessionTabPreferencesKey, JSON.stringify({ [first.id]: { title: 'Archive', color: '#3b82f6', pinned: true, pinnedAt: 1 } }))
  const newSession = { ...first, id: 'restarted' }
  let resolve!: (value: FileSession) => void
  const request = new Promise<FileSession>((done) => { resolve = done })
  function Harness() {
    const [sessions, setSessions] = useState([first, second])
    const [visible, setVisible] = useState(true)
    return <FilesWorkspaceRuntimeProvider fileSessions={sessions}>
      <button onClick={() => setVisible((value) => !value)}>toggle-page</button>
      {visible && <FileSessionTabs {...createProps()} sessions={sessions}
        onRestart={async (session) => {
          setSessions((current) => current.filter((item) => item.id !== session.id))
          const result = await request
          setSessions((current) => [...current, result])
          return result
        }} />}
    </FilesWorkspaceRuntimeProvider>
  }
  render(<ConfigProvider theme={{ token: { motion: false } }}><AntdApp><Harness /></AntdApp></ConfigProvider>)
  await action('Archive', 'restart')
  fireEvent.click(screen.getByRole('button', { name: 'toggle-page' }))
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  await act(async () => { resolve(newSession); await request })
  fireEvent.click(screen.getByRole('button', { name: 'toggle-page' }))
  expect(screen.getByRole('tab', { name: /^Archive(?:[， ]|$)/ })).toHaveAttribute('data-session-tab-id', newSession.id)
  expect(JSON.parse(localStorage.getItem(fileSessionTabPreferencesKey)!)).toEqual({
    [newSession.id]: { title: 'Archive', color: '#3b82f6', pinned: true, pinnedAt: 1 },
  })
})

test('缺失配置或正在连接时禁用不适用操作，关闭时收起改名对话框', async () => {
  const view = renderTabs(createProps({ sessions: [{ ...first, file_access_profile_id: undefined }, { ...second, status: 'connecting' }] }))
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^Alpha(?:[， ]|$)/ }))
  expect(await screen.findByRole('menuitem', { name: 'terminal.tabMenu.duplicate' })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.mouseDown(document.body)
  await action('Alpha', 'rename')
  await waitFor(() => expect(screen.getByRole('dialog')).toBeVisible())
  view.rerenderTabs({ ...view.props, closingIds: new Set([first.id]) })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^Beta(?:[， ]|$)/ }))
  expect(await screen.findByRole('menuitem', { name: 'terminal.tabMenu.restart' })).toHaveAttribute('aria-disabled', 'true')
  await act(async () => undefined)
})

test.each(['menu', 'color', 'custom'] as const)('关闭时收起 %s 浮层，关闭失败恢复标签后不重新弹出', async (surface) => {
  const view = renderTabs()
  if (surface !== 'menu') {
    await action('Alpha', 'color')
    await screen.findAllByRole('button', { name: 'terminal.tabMenu.colorValue' })
    if (surface === 'custom') {
      fireEvent.click(screen.getByRole('button', { name: 'terminal.tabMenu.customColor' }))
      await screen.findByRole('textbox')
    }
  } else {
    fireEvent.contextMenu(screen.getByRole('tab', { name: /^Alpha(?:[， ]|$)/ }))
    await screen.findByRole('menu')
  }
  view.rerenderTabs({ ...view.props, closingIds: new Set([first.id]) })
  await waitFor(() => {
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'terminal.tabMenu.colorValue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  view.rerenderTabs(view.props)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'terminal.tabMenu.colorValue' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await action('Alpha', 'duplicate')
  expect(view.props.onConnect).toHaveBeenCalledTimes(1)
})

test('复制等待期间离开再返回页面，仍禁用同一标签的连接操作', async () => {
  let resolve!: (value: FileSession) => void
  const request = new Promise<FileSession>((done) => { resolve = done })
  const props = createProps({ onConnect: vi.fn(() => request) })
  function Harness() {
    const [visible, setVisible] = useState(true)
    return <FilesWorkspaceRuntimeProvider fileSessions={props.sessions}>
      <button onClick={() => setVisible((value) => !value)}>toggle-page</button>
      {visible && <FileSessionTabs {...props} />}
    </FilesWorkspaceRuntimeProvider>
  }
  render(<ConfigProvider theme={{ token: { motion: false } }}><AntdApp><Harness /></AntdApp></ConfigProvider>)
  await action('Alpha', 'duplicate')
  fireEvent.click(screen.getByRole('button', { name: 'toggle-page' }))
  fireEvent.click(screen.getByRole('button', { name: 'toggle-page' }))
  fireEvent.contextMenu(screen.getByRole('tab', { name: /^Alpha(?:[， ]|$)/ }))
  const duplicate = await screen.findByRole('menuitem', { name: 'terminal.tabMenu.duplicate' })
  expect(duplicate).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('menuitem', { name: 'terminal.tabMenu.restart' })).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(duplicate)
  expect(props.onConnect).toHaveBeenCalledTimes(1)
  await act(async () => { resolve({ ...first, id: 'copied' }); await request })
  await waitFor(() => expect(duplicate).not.toHaveAttribute('aria-disabled', 'true'))
})
