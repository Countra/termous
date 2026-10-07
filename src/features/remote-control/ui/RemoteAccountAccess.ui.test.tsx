import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeAll, expect, test, vi } from 'vitest'
import type { RemoteDevice, RemoteLauncher, RemotePolicy, RemoteResult } from '#common/contracts'
import { changeLanguage } from '#shared/i18n'
import { RemoteAccountAccess } from './RemoteAccountAccess'

const bridge = vi.hoisted(() => ({ current: undefined as RemoteLauncher | undefined }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ remoteControl: bridge.current }) }))
beforeAll(async () => { await changeLanguage('zh-CN') })

const initial: RemotePolicy = {
  revision: 4, enabled: true, agent_enabled: false, hosts: [{ id: 'build' }],
  directories: [{ id: 'folder', name: '报告', path: 'D:\\Reports', read: true, write: false }],
}
const ok = <T,>(value: T): RemoteResult<T> => ({ ok: true, value })
function gateway(overrides: Partial<RemoteLauncher> = {}): RemoteLauncher {
  const api: RemoteLauncher = {
    openAgent: vi.fn(async () => ok(true)), open: vi.fn(async () => ok(true)), devices: vi.fn(async () => ok([])),
    policy: vi.fn(async () => ok(initial)),
    hosts: vi.fn(async () => ok([{ id: 'build', name: '构建主机' }, { id: 'prod', name: '生产主机' }])),
    configure: vi.fn<RemoteLauncher['configure']>(async (_generation, revision, enabled, ids) => ok({ ...initial, revision: revision + 1, enabled, hosts: ids.map(id => ({ id })) })),
    configureAgent: vi.fn<RemoteLauncher['configureAgent']>(async (_generation, revision, enabled) => ok({ ...initial, revision: revision + 1, agent_enabled: enabled })),
    addDirectory: vi.fn(async () => ok(null)), removeDirectory: vi.fn<RemoteLauncher['removeDirectory']>(async (_generation, revision) => ok({ ...initial, revision: revision + 1, directories: [] })),
    ...overrides,
  }
  bridge.current = api
  return api
}
const remoteDevice: RemoteDevice = { id: 'remote', name: '合成远控设备', trust: 'active', online: 'online', advertisement: { protocol: 'termous-remote-v1', host_enabled: true, platform: 'Windows', policy_revision: '4' } }
const view = (generation = 'account', trusted = true, showDevice = false) => <ConfigProvider theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}><RemoteAccountAccess generation={generation} currentDevice="current" trusted={trusted}>{renderDevice => showDevice ? renderDevice(remoteDevice) : null}</RemoteAccountAccess></ConfigProvider>
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '管理访问范围' }))
  await screen.findByRole('switch', { name: '允许远程控制' })
}
function tab(name: RegExp) { fireEvent.click(screen.getByRole('tab', { name })) }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('搜索保留隐藏的主机选择，远控开关和主机草稿仅在保存时提交', async () => {
  const api = gateway()
  render(view())
  await open()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索主机' }), { target: { value: '生产' } })
  expect(screen.queryByRole('checkbox', { name: '构建主机' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '生产主机' }))
  fireEvent.click(screen.getByRole('switch', { name: '允许远程控制' }))
  expect(api.configure).not.toHaveBeenCalled()
  expect(screen.getByText('有未保存的设置')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('account', 4, false, ['build', 'prod']))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('助手权限立即更新修订号，保留待保存的主机草稿', async () => {
  const api = gateway()
  render(view())
  await open()
  fireEvent.click(screen.getByRole('checkbox', { name: '生产主机' }))
  tab(/AI 助手/)
  fireEvent.click(screen.getByRole('switch', { name: '允许远程使用 AI 助手' }))
  await screen.findByText('访问权限已更新')
  expect(api.configureAgent).toHaveBeenCalledWith('account', 4, true)
  expect(screen.getByRole('switch', { name: '允许远程使用 AI 助手' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('account', 5, true, ['build', 'prod']))
})

test('单个全选复选框支持半选、全选与取消，保存前不写入授权', async () => {
  const api = gateway()
  render(view())
  await open()
  const selectAll = screen.getByRole('checkbox', { name: '全选' })
  expect(selectAll).toBePartiallyChecked()
  fireEvent.click(selectAll)
  expect(screen.getByRole('checkbox', { name: '构建主机' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: '生产主机' })).toBeChecked()
  expect(selectAll).toBeChecked()
  expect(selectAll).not.toBePartiallyChecked()
  fireEvent.click(selectAll)
  expect(screen.getByRole('checkbox', { name: '构建主机' })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: '生产主机' })).not.toBeChecked()
  expect(selectAll).not.toBeChecked()
  expect(selectAll).not.toBePartiallyChecked()
  expect(api.configure).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('account', 4, true, []))
})

test('筛选结果批量选择不清除隐藏的选择，空结果不允许批量操作', async () => {
  const api = gateway()
  render(view())
  await open()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索主机' }), { target: { value: '生产' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '全选结果' }))
  expect(screen.getByRole('checkbox', { name: '生产主机' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '全选结果' }))
  expect(screen.getByRole('checkbox', { name: '生产主机' })).not.toBeChecked()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索主机' }), { target: { value: '不存在的主机' } })
  expect(screen.getByRole('checkbox', { name: '全选结果' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('account', 4, true, ['build']))
})

test('移除目录必须确认，取消保留授权，确认后只撤销该目录权限', async () => {
  const api = gateway()
  render(view())
  await open()
  tab(/此电脑的目录/)
  fireEvent.click(screen.getByRole('button', { name: '移除授权 · 报告' }))
  await screen.findByText('远端将无法访问，电脑中的目录和文件会保留。')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(api.removeDirectory).not.toHaveBeenCalled()
  expect(screen.getByText('D:\\Reports')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '移除授权 · 报告' }))
  fireEvent.click(await screen.findByRole('button', { name: '移除授权' }))
  await screen.findByText('暂无授权目录')
  expect(api.removeDirectory).toHaveBeenCalledWith('account', 4, 'folder')
  expect(api.configure).not.toHaveBeenCalled()
})

test('原生目录选择期间阻止重复写入与关闭，取消选择不修改策略', async () => {
  const selection = deferred<RemoteResult<RemotePolicy | null>>()
  const api = gateway({ addDirectory: vi.fn(() => selection.promise) })
  render(view())
  await open()
  tab(/此电脑的目录/)
  fireEvent.click(screen.getByRole('button', { name: '添加只读目录' }))
  fireEvent.click(screen.getByRole('button', { name: '添加读写目录' }))
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(api.addDirectory).toHaveBeenCalledTimes(1)
  expect(api.addDirectory).toHaveBeenCalledWith('account', 4, false)
  await act(async () => { selection.resolve(ok(null)) })
  expect(screen.queryByText('访问权限已更新')).not.toBeInTheDocument()
  expect(screen.getByText('D:\\Reports')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('account', 4, true, ['build']))
})

test('再次读取失败不沿用旧授权，刷新成功后才允许保存', async () => {
  const api = gateway()
  render(view())
  await open()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  vi.mocked(api.hosts).mockRejectedValueOnce(new Error('private response'))
  fireEvent.click(screen.getByRole('button', { name: '管理访问范围' }))
  await screen.findByText('访问设置加载失败')
  expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  expect(screen.queryByText('private response')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: '构建主机' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByRole('checkbox', { name: '构建主机' })
  expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled()
})

test('修订冲突和未确认写入要求刷新，不能重复提交过期策略', async () => {
  const api = gateway({ configureAgent: vi.fn<RemoteLauncher['configureAgent']>(async () => ({ ok: false, code: 'REMOTE_POLICY_CHANGED' })) })
  render(view())
  await open()
  tab(/AI 助手/)
  fireEvent.click(screen.getByRole('switch', { name: '允许远程使用 AI 助手' }))
  await screen.findByText('访问设置已变化，请刷新后再保存。')
  expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  expect(screen.getByRole('switch', { name: '允许远程使用 AI 助手' })).toBeDisabled()
  vi.mocked(api.policy).mockResolvedValue(ok({ ...initial, revision: 8, agent_enabled: true }))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await screen.findByRole('switch', { name: '允许远程控制' })
  tab(/AI 助手/)
  expect(screen.getByRole('switch', { name: '允许远程使用 AI 助手' })).toBeChecked()
  vi.mocked(api.configureAgent).mockResolvedValueOnce({ ok: false, code: 'timeout', uncertain: true })
  fireEvent.click(screen.getByRole('switch', { name: '允许远程使用 AI 助手' }))
  await screen.findByText('操作结果尚未确认，请先刷新状态。')
  expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled()
  expect(api.configureAgent).toHaveBeenLastCalledWith('account', 8, false)
})

test('关闭后重新打开不接受旧读取结果，信任撤销后丢弃目录数据与迟到响应', async () => {
  const oldRead = deferred<RemoteResult<RemotePolicy>>()
  const api = gateway({ policy: vi.fn().mockReturnValueOnce(oldRead.promise).mockResolvedValue(ok({ ...initial, revision: 7 })) })
  const display = render(view())
  fireEvent.click(screen.getByRole('button', { name: '管理访问范围' }))
  expect(screen.getByRole('status', { name: '正在加载访问设置' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await open()
  await act(async () => { oldRead.resolve(ok({ ...initial, enabled: false })) })
  expect(screen.getByRole('switch', { name: '允许远程控制' })).toBeChecked()
  const writing = deferred<RemoteResult<RemotePolicy>>()
  vi.mocked(api.configureAgent).mockReturnValue(writing.promise)
  tab(/AI 助手/)
  fireEvent.click(screen.getByRole('switch', { name: '允许远程使用 AI 助手' }))
  display.rerender(view('account', false))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await act(async () => { writing.resolve(ok({ ...initial, agent_enabled: true })) })
  expect(screen.queryByText('D:\\Reports')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '管理访问范围' })).not.toBeInTheDocument()
  display.rerender(view('new-account'))
  await open()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await waitFor(() => expect(api.configure).toHaveBeenCalledWith('new-account', 7, true, ['build']))
})

test.each([false, true])('保存后的在线状态不被较早轮询的结果或失败覆盖：%s', async (failed) => {
  const oldRead = deferred<RemoteResult<RemoteDevice[]>>()
  const api = gateway({ devices: vi.fn().mockReturnValueOnce(oldRead.promise).mockResolvedValue(ok([remoteDevice])) })
  render(view('account', true, true))
  await open()
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
  await screen.findByText('在线')
  await act(async () => { oldRead.resolve(failed ? { ok: false, code: 'remote_signaling_unavailable' } : ok([{ ...remoteDevice, online: 'offline' }])) })
  expect(screen.getByText('在线')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '远程连接' })).toBeEnabled()
  expect(api.devices).toHaveBeenCalledTimes(2)
})

test('切换账号后，旧连接的失败不能进入新账号反馈', async () => {
  const opening = deferred<RemoteResult<boolean>>()
  gateway({ devices: vi.fn(async () => ok([remoteDevice])), open: vi.fn(() => opening.promise) })
  const display = render(view('account', true, true))
  await waitFor(() => expect(screen.getByRole('button', { name: '远程连接' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '远程连接' }))
  display.rerender(view('new-account', true, true))
  await act(async () => { opening.resolve({ ok: false, code: 'remote_signaling_unavailable' }) })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('连接失败在设备列表反馈，不能污染授权弹窗或随关闭弹窗消失', async () => {
  const opening = deferred<RemoteResult<boolean>>()
  gateway({ devices: vi.fn(async () => ok([remoteDevice])), open: vi.fn(() => opening.promise) })
  render(view('account', true, true))
  await waitFor(() => expect(screen.getByRole('button', { name: '远程连接' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '远程连接' }))
  await open()
  await act(async () => { opening.resolve({ ok: false, code: 'remote_signaling_unavailable' }) })
  expect(screen.getByRole('alert')).toHaveTextContent('远控服务不可达')
  expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('alert')).toHaveTextContent('远控服务不可达')
})

test('主机与目录达到现有限额时仍可取消选择和移除授权', async () => {
  gateway({
    hosts: async () => ok(Array.from({ length: 257 }, (_, index) => ({ id: String(index), name: `主机 ${index}` }))),
    policy: async () => ok({ ...initial, hosts: Array.from({ length: 256 }, (_, index) => ({ id: String(index) })), directories: Array.from({ length: 32 }, (_, index) => ({ ...initial.directories[0], id: String(index), name: `目录 ${index}` })) }),
  })
  render(view())
  await open()
  expect(screen.getByLabelText('主机 256')).toBeDisabled()
  fireEvent.click(screen.getByLabelText('主机 0'))
  expect(screen.getByLabelText('主机 256')).toBeEnabled()
  const clearSelection = screen.getByLabelText('取消选择')
  expect(clearSelection).toBePartiallyChecked()
  fireEvent.click(clearSelection)
  expect(screen.getByLabelText('主机 1')).not.toBeChecked()
  expect(screen.getByLabelText('全选')).toBeDisabled()
  tab(/此电脑的目录/)
  const region = within(screen.getByRole('region', { name: '此电脑的目录' }))
  expect(region.getByRole('button', { name: '添加只读目录' })).toBeDisabled()
  expect(region.getByRole('button', { name: '移除授权 · 目录 0' })).toBeEnabled()
}, 15000)
