import { renderWithFeedback as render } from '../../../test/renderWithFeedback'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import { ConfigProvider } from 'antd'
import type { CloudPreview, CloudStatus, CloudSecurityOverview, SettingsSnapshot } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway } from '#entities/settings'
import { changeLanguage } from '#shared/i18n'
import { TermousApiError } from '#shared/api'
import { AccountSync } from './AccountSync'
import { AccountSyncPreview } from './AccountSyncPreview'

beforeAll(async () => { await changeLanguage('zh-CN') })
const status: CloudStatus = { revision: 1, generation: 'fixture', authenticated: true, configured: true, phase: 'ready', device_status: 'active', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
const security: CloudSecurityOverview = { account: { contract: 'cloud-recovery-safeguards-v1', managed_recovery: true, mfa_enabled: false, mfa_revision: '0', recovery_required: false, recovery_ready: false }, recovery: { policy: { workspace_id: 'workspace', revision: '0', status: 'disabled', updated_at: new Date().toISOString() }, available: false }, membership_initialized: true, keys_verified: true }
const preview: CloudPreview = { id: 'preview', generation: status.generation, items: [], blocked: false }
const run = async <T,>(action: () => Promise<T>) => { try { return await action() } catch { return undefined } }
function setup(value = status) {
  const state = new CloudState()
  state.accept(value)
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, security: vi.fn(async () => security), archives: vi.fn(async () => []), preview: vi.fn(async () => preview), conflicts: vi.fn(async () => []), resolve: vi.fn(async () => {}), confirm: vi.fn(async () => ({ ...value, confirmed: true })), run: vi.fn(async () => value) } as unknown as CloudGateway
  let snapshot: SettingsSnapshot = { id: 'cloud', schema_version: 1, revision: 1, value: { auto_sync: value.auto_sync }, state: { status: 'applied' } }
  const store = new SettingsModuleStore({
    read: async () => snapshot,
    update: async (_, request) => { snapshot = { ...snapshot, revision: snapshot.revision + 1, value: request.patch }; return snapshot },
  })
  const settings: SettingsGateway = { getModule: store.snapshot.bind(store), subscribeSettings: store.subscribe, readModule: vi.fn(store.read.bind(store)), updateModule: vi.fn(store.update.bind(store)) }
  const view = (next = value) => <ConfigProvider theme={{ token: { motion: false } }}><SettingsGatewayContext value={settings}><AccountSync api={api} status={next} busy={false} run={run} /></SettingsGatewayContext></ConfigProvider>
  return { state, api, settings, view }
}
async function openPreview() {
  await waitFor(() => expect(screen.getByRole('button', { name: '预览同步' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
  return within(await screen.findByRole('dialog', { name: '同步预览' }))
}

test('首次设置读取尚未完成时不把加载阶段提示为错误', async () => {
  const f = setup()
  const read = f.settings.readModule
  let finish!: () => Promise<void>
  vi.mocked(f.settings.readModule).mockImplementationOnce((...args) => new Promise((resolve, reject) => {
    finish = async () => { try { resolve(await read(...args)) } catch (cause) { reject(cause) } }
  }))
  render(f.view())
  expect(screen.queryByText('同步设置暂不可用，请重试')).not.toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '自动同步' })).toBeDisabled()
  await act(async () => { await finish() })
  await waitFor(() => expect(screen.getByRole('switch', { name: '自动同步' })).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(f.api.confirm).not.toHaveBeenCalled()
})

test('首次打开自动同步直接预览，只需在同一弹窗确认一次', async () => {
  const f = setup()
  render(f.view())
  const toggle = screen.getByRole('switch', { name: '自动同步' })
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  const dialog = within(await screen.findByRole('dialog'))
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  expect(f.api.confirm).not.toHaveBeenCalled()
  expect(f.settings.updateModule).not.toHaveBeenCalled()
  fireEvent.click(dialog.getByRole('button', { name: '确认同步' }))
  await waitFor(() => expect(toggle).toBeChecked())
  expect(f.api.confirm).toHaveBeenCalledExactlyOnceWith(status.generation, preview.id)
  expect(f.settings.updateModule).toHaveBeenCalledWith('cloud', { auto_sync: true }, expect.any(Object))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('已确认的设备可以直接开关自动同步和立即同步，不强制重新预览', async () => {
  const f = setup({ ...status, confirmed: true })
  render(f.view())
  const toggle = screen.getByRole('switch')
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).toBeChecked())
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  await waitFor(() => expect(screen.getByRole('button', { name: '立即同步' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '立即同步' }))
  await waitFor(() => expect(f.api.run).toHaveBeenCalledWith(status.generation))
  expect(f.api.preview).not.toHaveBeenCalled()
  expect(f.api.confirm).not.toHaveBeenCalled()
})

test('预览与冲突完整读取前不能确认，失败通过统一消息展示并可重试', async () => {
  const f = setup()
  vi.mocked(f.api.conflicts).mockRejectedValueOnce(new Error('network_unavailable'))
  render(f.view())
  const dialog = await openPreview()
  expect(await screen.findByText('暂时无法连接云服务，请稍后重试。')).toBeInTheDocument()
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
  fireEvent.click(dialog.getByRole('button', { name: '重新预览' }))
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  expect(f.api.confirm).not.toHaveBeenCalled()
})

test('精简表格保留删除提示和合计，不展示无变更类别及空冲突列', async () => {
  const f = setup()
  vi.mocked(f.api.preview).mockResolvedValue({ ...preview, items: [
    { dataset: 'hosts', upload: 2, download: 3, delete: 1, conflicts: 0 },
    { dataset: 'credentials', upload: 0, download: 0, delete: 0, conflicts: 0 },
  ] })
  render(f.view())
  const dialog = await openPreview()
  const table = within(await dialog.findByRole('table'))
  expect(table.getByRole('columnheader', { name: '其中删除' })).toBeInTheDocument()
  expect(table.queryByRole('columnheader', { name: '冲突' })).not.toBeInTheDocument()
  expect(table.queryByText('凭据')).not.toBeInTheDocument()
  expect(table.getByRole('row', { name: '合计 2 3 1' })).toBeInTheDocument()
})

test('预览返回其他代次时不读取冲突，也不允许确认', async () => {
  const f = setup()
  vi.mocked(f.api.preview).mockResolvedValue({ ...preview, generation: 'other' })
  render(f.view())
  const dialog = await openPreview()
  await waitFor(() => expect(f.api.preview).toHaveBeenCalledTimes(1))
  expect(f.api.conflicts).not.toHaveBeenCalled()
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
})

test('确认等待期间切换账号，不为新账号开启自动同步', async () => {
  const f = setup()
  let finish!: (value: CloudStatus) => void
  vi.mocked(f.api.confirm).mockImplementation(() => new Promise(done => { finish = done }))
  render(f.view())
  const dialog = await openPreview()
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  fireEvent.click(dialog.getByRole('button', { name: '确认同步' }))
  await waitFor(() => expect(f.api.confirm).toHaveBeenCalledTimes(1))
  const next = { ...status, generation: 'next', confirmed: true }
  act(() => { f.state.accept(next) })
  await act(async () => { finish(next) })
  expect(f.settings.updateModule).not.toHaveBeenCalled()
})

test('同步成功但开启设置失败时，重试只保存设置，不重复同步', async () => {
  const f = setup()
  vi.mocked(f.settings.updateModule).mockRejectedValueOnce(new Error('network_unavailable'))
  render(f.view())
  const dialog = await openPreview()
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  fireEvent.click(dialog.getByRole('button', { name: '确认同步' }))
  expect(await screen.findByText('已同步，自动同步未开启')).toBeInTheDocument()
  const retry = dialog.getByRole('button', { name: '开启自动同步' })
  await waitFor(() => expect(retry).toBeEnabled())
  fireEvent.click(retry)
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  expect(f.api.confirm).toHaveBeenCalledTimes(1)
  expect(f.settings.updateModule).toHaveBeenCalledTimes(2)
})

test('同步已应用后设置变为不可用，弹窗仍可补读设置且不重复提交同步', async () => {
  const f = setup()
  const onEnable = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const onReloadSettings = vi.fn(), onClose = vi.fn()
  const view = (settingsUnavailable: boolean) => <AccountSyncPreview api={f.api} status={status} open enableAutoSync busy={false} settingsUnavailable={settingsUnavailable} run={run} onEnable={onEnable} onReloadSettings={onReloadSettings} onClose={onClose} />
  const rendered = render(view(false))
  const dialog = within(await screen.findByRole('dialog'))
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  fireEvent.click(dialog.getByRole('button', { name: '确认同步' }))
  await screen.findByText('已同步，自动同步未开启')
  rendered.rerender(view(true))
  const reload = dialog.getByRole('button', { name: /重\s*试/ })
  expect(reload).toBeEnabled()
  expect(dialog.getByRole('button', { name: '开启自动同步' })).toBeDisabled()
  fireEvent.click(reload)
  expect(onReloadSettings).toHaveBeenCalledTimes(1)
  rendered.rerender(view(false))
  fireEvent.click(dialog.getByRole('button', { name: '开启自动同步' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  expect(f.api.confirm).toHaveBeenCalledTimes(1)
  expect(f.api.preview).toHaveBeenCalledTimes(1)
  expect(onEnable).toHaveBeenCalledTimes(2)
})

test('已确认设备的手动预览只同步本次变更，不擅自开启自动同步', async () => {
  const f = setup({ ...status, confirmed: true })
  render(f.view())
  const dialog = await openPreview()
  const confirm = dialog.getByRole('button', { name: '确认同步' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() => expect(f.api.confirm).toHaveBeenCalledTimes(1))
  expect(f.settings.updateModule).not.toHaveBeenCalled()
  expect(screen.getByRole('switch')).not.toBeChecked()
})

test('立即同步发现新冲突时自动进入预览弹窗，不继续修改自动同步设置', async () => {
  const f = setup({ ...status, confirmed: true })
  // HTTP 失败可能先于 WS 状态到达，弹窗不能依赖缓存中的冲突数量。
  vi.mocked(f.api.run).mockRejectedValue(new TermousApiError('conflicts_pending', 'CLOUD_OPERATION_FAILED', 409))
  vi.mocked(f.api.preview).mockResolvedValue({ ...preview, blocked: true })
  vi.mocked(f.api.conflicts).mockResolvedValue([{ id: 'conflict', dataset: 'hosts', object_id: 'host_test', name: 'Synthetic host', local_deleted: false, remote_deleted: false }])
  render(f.view())
  const sync = screen.getByRole('button', { name: '立即同步' })
  await waitFor(() => expect(sync).toBeEnabled())
  fireEvent.click(sync)
  const dialog = within(await screen.findByRole('dialog', { name: '同步预览' }))
  expect(await dialog.findByText('Synthetic host')).toBeInTheDocument()
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
  expect(f.settings.updateModule).not.toHaveBeenCalled()
})

test('缓存出现冲突也不能把网络失败误判为冲突结果', async () => {
  const f = setup({ ...status, confirmed: true })
  vi.mocked(f.api.run).mockImplementation(async () => {
    f.state.accept({ ...status, confirmed: true, revision: 2, conflicts: 1 })
    throw new TermousApiError('network_unavailable', 'CLOUD_OPERATION_FAILED', 503)
  })
  render(f.view())
  const sync = screen.getByRole('button', { name: '立即同步' })
  await waitFor(() => expect(sync).toBeEnabled())
  await act(async () => { fireEvent.click(sync) })
  expect(f.api.run).toHaveBeenCalledTimes(1)
  expect(f.api.preview).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('确认失败后必须重新预览，不能重复提交失效的预览', async () => {
  const f = setup()
  vi.mocked(f.api.confirm).mockRejectedValueOnce(new TermousApiError('预览已变化', 'CLOUD_STALE', 409))
  render(f.view())
  const dialog = await openPreview()
  const confirm = dialog.getByRole('button', { name: '确认同步' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  expect(await screen.findByText('账号状态已变化，请重新操作。')).toBeInTheDocument()
  await waitFor(() => expect(dialog.getByRole('button', { name: '重新预览' })).toBeEnabled())
  expect(confirm).toBeDisabled()
  vi.mocked(f.api.preview).mockResolvedValue({ ...preview, id: 'preview-next' })
  fireEvent.click(dialog.getByRole('button', { name: '重新预览' }))
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  await waitFor(() => expect(f.api.confirm).toHaveBeenLastCalledWith(status.generation, 'preview-next'))
})

test('确认响应代次异常时明确提示，不能默默结束操作或继续开启同步', async () => {
  const f = setup()
  vi.mocked(f.api.confirm).mockResolvedValue({ ...status, generation: 'unexpected', confirmed: true })
  render(f.view())
  const dialog = await openPreview()
  const confirm = dialog.getByRole('button', { name: '确认同步' })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
  expect(await screen.findByText('云服务返回了无效的验证信息，请刷新后重试。')).toBeInTheDocument()
  expect(f.settings.updateModule).not.toHaveBeenCalled()
})

test('恢复保障读取失败可以通过统一消息重试', async () => {
  const f = setup()
  vi.mocked(f.api.security).mockRejectedValueOnce(new Error('network_unavailable'))
  render(f.view())
  const dialog = await openPreview()
  expect(await screen.findByText('无法读取恢复保障，请重试')).toBeInTheDocument()
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
  fireEvent.click(dialog.getByRole('button', { name: /重\s*试/ }))
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  expect(f.api.security).toHaveBeenCalledTimes(2)
})

test('首次预览中设置不可用时通过统一消息提示，重试读取后允许确认', async () => {
  const f = setup()
  vi.mocked(f.settings.readModule).mockRejectedValueOnce(new Error('network_unavailable'))
  render(f.view())
  const dialog = await openPreview()
  expect(await screen.findByText('同步设置暂不可用，请重试')).toBeInTheDocument()
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
  fireEvent.click(dialog.getByRole('button', { name: /重\s*试/ }))
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  expect(f.api.confirm).not.toHaveBeenCalled()
})

test('弹窗打开后设备被撤销，禁用确认且不发送同步请求', async () => {
  const f = setup()
  const view = render(f.view())
  const dialog = await openPreview()
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  view.rerender(f.view({ ...status, device_status: 'revoked' }))
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
  expect(f.api.confirm).not.toHaveBeenCalled()
})

test('切换 Core 后，迟到的预览不能请求旧冲突或恢复旧弹窗', async () => {
  const previous = setup(), next = setup()
  let finish!: (value: CloudPreview) => void
  vi.mocked(previous.api.preview).mockImplementation(() => new Promise(done => { finish = done }))
  const view = render(previous.view())
  await openPreview()
  view.rerender(next.view())
  await act(async () => { finish(preview) })
  expect(previous.api.conflicts).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('关闭预览后迟到结果不能复活弹窗，取消不修改设置', async () => {
  const f = setup()
  let finish!: (value: CloudPreview) => void
  vi.mocked(f.api.preview).mockImplementation(() => new Promise(done => { finish = done }))
  render(f.view())
  const dialog = await openPreview()
  fireEvent.click(dialog.getByRole('button', { name: /取\s*消/ }))
  await act(async () => { finish(preview) })
  expect(f.api.conflicts).not.toHaveBeenCalled()
  expect(f.api.confirm).not.toHaveBeenCalled()
  expect(f.settings.updateModule).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('首次同步缺少恢复保障时仍可查看差异，但不能确认或开启自动同步', async () => {
  const f = setup()
  vi.mocked(f.api.security).mockResolvedValue({ ...security, account: { ...security.account, recovery_required: true, recovery_ready: false } })
  render(f.view())
  const dialog = await openPreview()
  await dialog.findByText('本地与云端没有差异')
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
  expect(screen.getByRole('switch')).toBeDisabled()
  expect(f.api.confirm).not.toHaveBeenCalled()
})

test('恢复保障读取失败不推断为已开启，也不允许手动同步', async () => {
  const f = setup({ ...status, confirmed: true })
  vi.mocked(f.api.security).mockRejectedValue(new Error('offline'))
  render(f.view())
  expect(await screen.findByText('无法读取恢复保障，请重试')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '立即同步' })).toBeDisabled()
  expect(screen.getByRole('switch')).toBeDisabled()
})

test('恢复保障读取失败不阻止关闭已经开启的自动同步', async () => {
  const f = setup({ ...status, confirmed: true, auto_sync: true })
  vi.mocked(f.api.security).mockRejectedValue(new Error('network_unavailable'))
  render(f.view())
  await screen.findByText('无法读取恢复保障，请重试')
  const toggle = screen.getByRole('switch')
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(toggle).toBeChecked()
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle).not.toBeChecked())
  expect(f.settings.updateModule).toHaveBeenCalledWith('cloud', { auto_sync: false }, expect.objectContaining({ expectedRevision: 1 }))
})

test('冲突在同一预览弹窗处理，重新计算差异后才允许确认', async () => {
  const f = setup()
  vi.mocked(f.api.preview).mockResolvedValueOnce({ ...preview, blocked: true })
  vi.mocked(f.api.conflicts).mockResolvedValueOnce([{ id: 'conflict', dataset: 'hosts', object_id: 'host_test', name: 'Synthetic host', local_deleted: false, remote_deleted: false }])
  render(f.view())
  const dialog = await openPreview()
  await dialog.findByText('Synthetic host')
  expect(dialog.queryByText('本地与云端没有差异')).not.toBeInTheDocument()
  expect(dialog.getByRole('button', { name: '确认同步' })).toBeDisabled()
  fireEvent.click(dialog.getByRole('button', { name: '保留本地' }))
  await waitFor(() => expect(f.api.resolve).toHaveBeenCalledWith(status.generation, 'conflict', 'local'))
  await waitFor(() => expect(dialog.getByRole('button', { name: '确认同步' })).toBeEnabled())
  expect(f.api.preview).toHaveBeenCalledTimes(2)
})

test('设置网关缺失时显示明确错误，不再仅留下永久灰色开关', async () => {
  const f = setup({ ...status, confirmed: true })
  render(<AccountSync api={f.api} status={{ ...status, confirmed: true }} busy={false} run={run} />)
  expect(await screen.findByText('同步设置暂不可用，请重试')).toBeInTheDocument()
  expect(screen.getByRole('switch')).toBeDisabled()
})
