import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { beforeAll, expect, test, vi } from 'vitest'
import type { RemoteLauncher, RemotePolicyEditor, RemotePolicyReceipt, RemoteResult } from '#common/contracts'
import { changeLanguage } from '#shared/i18n'
import { deferred, ok, policyGateway } from '../../../test/remotePolicyEditor'
import { RemoteAccountAccess } from './RemoteAccountAccess'

const bridge = vi.hoisted(() => ({ current: undefined as RemoteLauncher | undefined }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ remoteControl: bridge.current }) }))
beforeAll(async () => { await changeLanguage('zh-CN') })
const view = (generation = 'account') => <ConfigProvider theme={{ token: { motion: false } }} button={{ autoInsertSpace: false }}><RemoteAccountAccess generation={generation} currentDevice="current" trusted>{() => null}</RemoteAccountAccess></ConfigProvider>
async function open() {
  fireEvent.click(screen.getByRole('button', { name: '管理访问范围' }))
  await screen.findByRole('switch', { name: '允许远程控制' })
}
function tab(name: RegExp) { fireEvent.click(screen.getByRole('tab', { name })) }

test('勾选主机后立即切换桌面编辑，不必等待保存，两个写入串行执行', async () => {
  const pending = deferred<RemoteResult<RemotePolicyReceipt>>()
  const gateway = policyGateway({}, { changePolicy: vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async (_g, _e, revision, change) => gateway.apply(revision, change)) })
  bridge.current = gateway.api; render(view()); await open()
  expect(screen.queryByRole('button', { name: /保存|完成/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: '构建主机' }))
  tab(/桌面访问/)
  const desktop = screen.getByRole('checkbox', { name: /开发桌面/ })
  expect(desktop).toBeEnabled(); fireEvent.click(desktop)
  expect(gateway.api.changePolicy).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve(gateway.apply(4, { kind: 'hosts', add: ['build'] })))
  await waitFor(() => expect(gateway.api.changePolicy).toHaveBeenCalledTimes(2))
  expect(vi.mocked(gateway.api.changePolicy!).mock.calls[1].slice(2)).toEqual([5, { kind: 'desktops', add: ['rdp'] }])
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(desktop).toBeChecked()
})

test('桌面独立授权，取消主机后仍保留桌面与文件交换', async () => {
  const gateway = policyGateway({ hosts: [{ id: 'build', terminal_file_access: true, connections: [{ id: 'rdp', kind: 'desktop' }, { id: 'rdp', kind: 'desktop_exchange' }] }] })
  bridge.current = gateway.api; render(view()); await open()
  fireEvent.click(screen.getByRole('checkbox', { name: '构建主机' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '构建主机' })).toBeEnabled())
  tab(/桌面访问/)
  expect(screen.getByRole('checkbox', { name: /开发桌面/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /文件交换/ })).toBeChecked()
  expect(gateway.api.configure).not.toHaveBeenCalled()
})

test('未授权主机也能直接选择桌面，总开关关闭时可以预配置', async () => {
  const { api } = policyGateway({ enabled: false, hosts: null, directories: null })
  bridge.current = api; render(view()); await open(); tab(/桌面访问/)
  fireEvent.click(screen.getByRole('checkbox', { name: /开发桌面/ }))
  await waitFor(() => expect(api.changePolicy).toHaveBeenCalledWith('account', expect.any(String), 4, { kind: 'desktops', add: ['rdp'] }))
  expect(screen.getByRole('switch', { name: '允许远程控制' })).not.toBeChecked()
  tab(/主机连接/); expect(screen.getByRole('checkbox', { name: '构建主机' })).not.toBeChecked()
})

test('失败使用弹出消息，不重放；分类切换保留搜索', async () => {
  const { api } = policyGateway({}, { changePolicy: vi.fn(async () => ({ ok: false as const, code: 'remote_policy_changed' })) })
  const read = api.editPolicy!
  const refresh = deferred<RemoteResult<RemotePolicyEditor>>()
  api.editPolicy = vi.fn().mockImplementationOnce(read).mockReturnValueOnce(refresh.promise).mockImplementation(read)
  bridge.current = api; render(view()); await open()
  fireEvent.change(screen.getByRole('textbox', { name: '搜索主机' }), { target: { value: '构建' } })
  fireEvent.click(screen.getByRole('checkbox', { name: '构建主机' }))
  await screen.findByText('访问设置已变化，已停止后续修改。')
  expect(within(screen.getByRole('dialog')).queryByText('访问设置已变化，已停止后续修改。')).not.toBeInTheDocument()
  await waitFor(() => expect(api.editPolicy).toHaveBeenCalledTimes(2))
  await act(async () => refresh.resolve({ ok: false, code: 'remote_unavailable' }))
  expect(screen.getByRole('checkbox', { name: '构建主机' })).toBeDisabled()
  fireEvent.click(await screen.findByRole('button', { name: '刷新' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '构建主机' })).toBeEnabled())
  tab(/桌面访问/); tab(/主机连接/)
  expect(screen.getByRole('textbox', { name: '搜索主机' })).toHaveValue('构建')
  expect(api.changePolicy).toHaveBeenCalledTimes(1)
})

test('切换账号关闭编辑器，迟到的目录选择不能提交', async () => {
  const selected = deferred<RemoteResult<string | null>>()
  const { api } = policyGateway({}, { selectPolicyDirectory: vi.fn(() => selected.promise) })
  bridge.current = api; const rendered = render(view()); await open(); tab(/此电脑的目录/)
  fireEvent.click(screen.getByRole('button', { name: '添加读写目录' }))
  rendered.rerender(view('next-account'))
  await act(async () => selected.resolve(ok('old-selection')))
  expect(api.changePolicy).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.closePolicyEditor).toHaveBeenCalled()
})

test('批量选择跳过不可用主机，选完后仍能一次清空', async () => {
  const gateway = policyGateway()
  const read = gateway.api.editPolicy!
  gateway.api.editPolicy = vi.fn(async (generation, editor) => {
    const result = await read(generation, editor)
    if (result.ok) result.value.hosts[1].status = 'unavailable'
    return result
  })
  bridge.current = gateway.api
  render(view()); await open()
  fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '取消选择' })).toBeEnabled())
  expect(screen.getByRole('checkbox', { name: '生产主机' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: '取消选择' }))
  await waitFor(() => expect(gateway.api.changePolicy).toHaveBeenCalledTimes(2))
  expect(vi.mocked(gateway.api.changePolicy!).mock.calls[1][3]).toEqual({ kind: 'hosts', remove: ['build'] })
})
