import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import type { SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway } from '#entities/settings'
import { i18n } from '#shared/i18n'
import { renderWithFeedback as render } from '../../../../test/renderWithFeedback'
import { MCPInstallationSettings } from './MCPInstallationSettings'

const native = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => native.value }))
afterEach(() => { native.value = undefined })

function setup() {
  let snapshot: SettingsSnapshot = { id: 'mcp_integrations', schema_version: 1, revision: 3, state: { status: 'saved' },
    value: { install_root: 'D:/MCP/packages', install_timeout_seconds: 1800, startup_timeout_seconds: 120 } }
  const update = vi.fn(async (_id, request) => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, ...request.patch } }
    return snapshot
  })
  const store = new SettingsModuleStore({ read: async () => snapshot, update })
  store.merge(snapshot)
  const gateway: SettingsGateway = { getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe }
  const view = render(<I18nextProvider i18n={i18n}><SettingsGatewayContext.Provider value={gateway}><MCPInstallationSettings /></SettingsGatewayContext.Provider></I18nextProvider>)
  return { view, store, update }
}

it('通过已有系统目录选择入口选中后直接提交路径，保留超时参数', async () => {
  await i18n.changeLanguage('zh-CN')
  const pick = vi.fn(async () => ['E:/MCP 安装目录'])
  native.value = { files: { pickDirectory: pick } }
  const { update } = setup()
  const input = await screen.findByLabelText('安装目录')
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '选择目录' }))
  await waitFor(() => expect(input).toHaveValue('E:/MCP 安装目录'))
  expect(pick).toHaveBeenCalledOnce()
  expect(update).toHaveBeenCalledExactlyOnceWith('mcp_integrations', { expected_revision: 3, patch: { install_root: 'E:/MCP 安装目录' } }, undefined)
  expect(screen.getByLabelText('安装超时（分钟）')).toHaveValue('30')
  expect(screen.getByLabelText('初始化超时（秒）')).toHaveValue('120')
})

it('取消系统目录选择保留原路径，不发送更新', async () => {
  await i18n.changeLanguage('zh-CN')
  native.value = { files: { pickDirectory: vi.fn(async () => []) } }
  const { update } = setup()
  const choose = await screen.findByRole('button', { name: '选择目录' })
  await waitFor(() => expect(choose).toBeEnabled())
  await act(async () => fireEvent.click(choose))
  expect(screen.getByLabelText('安装目录')).toHaveValue('D:/MCP/packages')
  expect(update).not.toHaveBeenCalled()
  expect(choose).toBeEnabled()
})

it('选择窗口打开期间合并重复点击，关闭设置后忽略晚到的选择结果', async () => {
  await i18n.changeLanguage('zh-CN')
  let complete!: (paths: string[]) => void
  const pick = vi.fn(() => new Promise<string[]>(resolve => { complete = resolve }))
  native.value = { files: { pickDirectory: pick } }
  const { update, view } = setup()
  const choose = await screen.findByRole('button', { name: '选择目录' })
  await waitFor(() => expect(choose).toBeEnabled())
  fireEvent.click(choose);fireEvent.click(choose)
  expect(pick).toHaveBeenCalledOnce()
  expect(screen.getByLabelText('安装目录')).toBeDisabled()
  view.unmount()
  await act(async () => complete(['E:/late-result']))
  expect(update).not.toHaveBeenCalled()
})

it('选择目录失败通过消息提示，保留路径且可再次打开', async () => {
  await i18n.changeLanguage('zh-CN')
  const pick = vi.fn().mockRejectedValueOnce(new Error('合成目录选择失败')).mockResolvedValueOnce(['E:/MCP'])
  native.value = { files: { pickDirectory: pick } }
  const { update, view } = setup()
  const choose = await screen.findByRole('button', { name: '选择目录' })
  await waitFor(() => expect(choose).toBeEnabled())
  fireEvent.click(choose)
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('合成目录选择失败')
  expect(view.container).not.toContainElement(notice)
  expect(screen.getByLabelText('安装目录')).toHaveValue('D:/MCP/packages')
  expect(update).not.toHaveBeenCalled()
  fireEvent.click(choose)
  await waitFor(() => expect(update).toHaveBeenCalledOnce())
  expect(screen.getByLabelText('安装目录')).toHaveValue('E:/MCP')
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

it('缺少桌面桥接时仍可手动输入与留空恢复默认，选择入口不可用', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update } = setup()
  const input = await screen.findByLabelText('安装目录')
  await waitFor(() => expect(input).toBeEnabled())
  expect(screen.getByRole('button', { name: '选择目录' })).toBeDisabled()
  fireEvent.change(input, { target: { value: 'E:/manual' } })
  expect(update).not.toHaveBeenCalled()
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledOnce())
  expect(update.mock.calls[0][1]).toEqual({ expected_revision: 3, patch: { install_root: 'E:/manual' } })
  fireEvent.change(input, { target: { value: '' } })
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update.mock.calls[1][1]).toEqual({ expected_revision: 4, patch: { install_root: '' } })
})
