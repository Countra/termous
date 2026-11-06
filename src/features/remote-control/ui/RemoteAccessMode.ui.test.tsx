import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeAll, expect, test, vi } from 'vitest'
import type { RemoteLauncher, RemotePolicy, RemoteResult } from '#common/contracts'
import { changeLanguage } from '#shared/i18n'
import { RemoteAccountAccess } from './RemoteAccountAccess'

const bridge = vi.hoisted(() => ({ current: undefined as RemoteLauncher | undefined }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ remoteControl: bridge.current }) }))
beforeAll(async () => { await changeLanguage('zh-CN') })
const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value })
const custom: RemotePolicy = {
  access_mode: 'custom', revision: 8, enabled: true, agent_enabled: false,
  hosts: [{ id: 'saved', connections: [{ id: 'rdp', kind: 'desktop' }] }],
  host_desktop: { observe: true, control: false },
  directories: [{ id: 'root', name: '报告', path: 'D:\\Reports', read: true, write: false }],
}

function gateway(initial: RemotePolicy, overrides: Partial<RemoteLauncher> = {}) {
  let current = initial
  const api: RemoteLauncher = {
    openAgent: vi.fn(async () => ok(true)), open: vi.fn(async () => ok(true)), devices: vi.fn(async () => ok([])),
    policy: vi.fn(async () => ok(current)),
    hosts: vi.fn(async () => ok([{ id: 'saved', name: '已选主机' }, { id: 'new', name: '新增主机' }])),
    desktopProfiles: vi.fn(async () => ok([{ id: 'rdp', host_id: 'saved', name: '原桌面', protocol: 'rdp' }])),
    configure: vi.fn<RemoteLauncher['configure']>(async (_generation, revision, enabled, ids, mode) => {
      current = { ...current, revision: revision + 1, enabled, access_mode: mode, hosts: ids === undefined ? current.hosts : ids.map(id => ({ id })) }
      return ok(current)
    }),
    configureAgent: vi.fn(async () => ok(current)),
    configureHostDesktop: vi.fn(async () => ok(current)),
    configureDesktops: vi.fn(async () => ok(current)),
    addDirectory: vi.fn(async () => ok(null)), removeDirectory: vi.fn(async () => ok(current)),
    ...overrides,
  }
  bridge.current = api
  return api
}

function view() {
  return <ConfigProvider theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}>
    <RemoteAccountAccess generation="account" currentDevice="current" trusted>{() => null}</RemoteAccountAccess>
  </ConfigProvider>
}

async function open() {
  fireEvent.click(screen.getByRole('button', { name: '管理访问范围' }))
  await screen.findByRole('radio', { name: '完全控制' })
}

test('首次配置展示完全控制但不自动开启，保存不固化主机清单', async () => {
  const api = gateway({ access_mode: 'full', revision: 0, enabled: false, hosts: null, directories: null })
  render(view())
  await open()
  expect(screen.getByRole('radio', { name: '完全控制' })).toBeChecked()
  expect(screen.getByRole('switch', { name: '允许远程控制' })).not.toBeChecked()
  expect(screen.queryByRole('checkbox', { name: '已选主机' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /AI 助手/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '添加只读目录' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '添加读写目录' }))
  await waitFor(() => expect(api.addDirectory).toHaveBeenCalledWith('account', 0, true))
  expect(api.configure).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('switch', { name: '允许远程控制' })).toBeEnabled())
  fireEvent.click(screen.getByRole('switch', { name: '允许远程控制' }))
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('account', 0, true, undefined, 'full'))
})

test('模式往返保留细分设置，未保存时禁止细项操作', async () => {
  const api = gateway(custom)
  render(view())
  await open()
  fireEvent.click(screen.getByRole('radio', { name: '完全控制' }))
  expect(api.configure).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '添加读写目录' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('account', 8, true, undefined, 'full'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await open()
  expect(screen.getByText('读写')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: '自定义' }))
  fireEvent.click(screen.getByRole('tab', { name: /主机连接/ }))
  expect(screen.getByRole('checkbox', { name: '已选主机' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '已选主机' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: '新增主机' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('tab', { name: /AI 助手/ }))
  expect(screen.getByRole('switch', { name: '允许远程使用 AI 助手' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenLastCalledWith('account', 9, true, undefined, 'custom'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await open()
  expect(screen.getByRole('checkbox', { name: '已选主机' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '新增主机' })).not.toBeChecked()
  fireEvent.click(screen.getByRole('tab', { name: /此电脑的目录/ }))
  expect(screen.getByText('只读')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /桌面访问/ }))
  expect(screen.getByRole('checkbox', { name: /原桌面/ })).toBeChecked()
  expect(api.configureAgent).not.toHaveBeenCalled()
  expect(api.configureHostDesktop).not.toHaveBeenCalled()
  expect(api.configureDesktops).not.toHaveBeenCalled()
})

test('取消模式草稿不保存，未确认写入要求重读且不能重放', async () => {
  let resolve!: (value: RemoteResult<RemotePolicy>) => void
  const pending = new Promise<RemoteResult<RemotePolicy>>(done => { resolve = done })
  const api = gateway(custom, { configure: vi.fn(() => pending) })
  render(view())
  await open()
  fireEvent.click(screen.getByRole('radio', { name: '完全控制' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.configure).not.toHaveBeenCalled()
  await open()
  expect(screen.getByRole('radio', { name: '自定义' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: '完全控制' }))
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  expect(screen.getByRole('radio', { name: '自定义' })).toBeDisabled()
  await act(async () => { resolve({ ok: false, code: 'remote_request_failed', uncertain: true }) })
  expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  expect(api.configure).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(screen.getByRole('radio', { name: '自定义' })).toBeChecked())
  expect(api.configure).toHaveBeenCalledTimes(1)
})

test('桌面配置清单读取失败时不开放只加载了一部分的权限编辑器', async () => {
  const api = gateway(custom, { desktopProfiles: vi.fn(async () => ({ ok: false as const, code: 'remote_request_failed' })) })
  render(view())
  fireEvent.click(screen.getByRole('button', { name: '管理访问范围' }))
  await screen.findByText('访问设置加载失败')
  expect(screen.queryByRole('radio', { name: '完全控制' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  expect(api.configure).not.toHaveBeenCalled()
  vi.mocked(api.desktopProfiles!).mockResolvedValue(ok([]))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByRole('radio', { name: '自定义' })
  expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled()
})
