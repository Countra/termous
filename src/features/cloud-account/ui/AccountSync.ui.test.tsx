import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudPreview, CloudStatus, CloudSecurityOverview, SettingsSnapshot } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { SettingsGatewayContext, type SettingsGateway } from '#entities/settings'
import { changeLanguage } from '#shared/i18n'
import { AccountSync } from './AccountSync'

beforeAll(async () => { await changeLanguage('zh-CN') })
const status: CloudStatus = { revision: 1, generation: 'fixture', authenticated: true, configured: true, phase: 'ready', device_status: 'active', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
const security: CloudSecurityOverview = { account: { contract: 'cloud-recovery-safeguards-v1', managed_recovery: true, mfa_enabled: false, mfa_revision: '0', recovery_required: false, recovery_ready: false }, recovery: { policy: { workspace_id: 'workspace', revision: '0', status: 'disabled', updated_at: new Date().toISOString() }, available: false }, membership_initialized: true, keys_verified: true }
const preview: CloudPreview = { id: 'preview', generation: status.generation, items: [], blocked: false }
const run = async <T,>(action: () => Promise<T>) => { try { return await action() } catch { return undefined } }
function setup() {
  const state = new CloudState()
  state.accept(status)
  const api = { getStatus: state.snapshot, subscribeStatus: state.subscribe, security: vi.fn(async () => security), archives: vi.fn(async () => []), preview: vi.fn(async () => preview), conflicts: vi.fn(async () => []), confirm: vi.fn(async () => status) } as unknown as CloudGateway
  const snapshot: SettingsSnapshot = { id: 'cloud', schema_version: 1, revision: 1, value: { auto_sync: false }, state: { status: 'applied' } }
  const settings: SettingsGateway = { getModule: () => snapshot, subscribeSettings: () => () => {}, readModule: vi.fn(async () => snapshot), updateModule: vi.fn(async () => snapshot) }
  return { state, api, settings }
}

test('预览和冲突读取全部成功后才展示可确认的结果，失败后可重新预览', async () => {
  const { api } = setup()
  vi.mocked(api.conflicts).mockRejectedValueOnce(new Error('network_unavailable'))
  render(<AccountSync api={api} status={status} busy={false} run={run} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '预览同步' })) })
  expect(api.conflicts).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('button', { name: '确认并启用同步' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
  expect(await screen.findByRole('button', { name: '确认并启用同步' })).toBeEnabled()
})

test('预览返回不匹配的账号代次时不读取冲突也不允许确认', async () => {
  const { api } = setup()
  vi.mocked(api.preview).mockResolvedValue({ ...preview, generation: 'other' })
  render(<AccountSync api={api} status={status} busy={false} run={run} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '预览同步' })) })
  expect(api.conflicts).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '确认并启用同步' })).not.toBeInTheDocument()
})

test('确认响应等待期间切换账号，不为新账号开启自动同步', async () => {
  const { api, settings, state } = setup()
  let confirm!: (value: CloudStatus) => void
  vi.mocked(api.confirm).mockImplementation(() => new Promise((done) => { confirm = done }))
  render(<SettingsGatewayContext value={settings}><AccountSync api={api} status={status} busy={false} run={run} /></SettingsGatewayContext>)
  await waitFor(() => expect(screen.getByRole('button', { name: '预览同步' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认并启用同步' }))
  const dialog = within(await screen.findByRole('dialog'))
  fireEvent.click(dialog.getByRole('button', { name: /确定|确 定|OK/ }))
  await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(1))
  const next = { ...status, generation: 'next', confirmed: true }
  act(() => { state.accept(next) })
  await act(async () => { confirm(next) })
  expect(settings.updateModule).not.toHaveBeenCalled()
})

test('当前账号确认成功后才开启自动同步，并收起已完成的预览', async () => {
  const { api, settings } = setup()
  vi.mocked(api.confirm).mockResolvedValue({ ...status, confirmed: true })
  render(<SettingsGatewayContext value={settings}><AccountSync api={api} status={status} busy={false} run={run} /></SettingsGatewayContext>)
  await waitFor(() => expect(screen.getByRole('button', { name: '预览同步' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认并启用同步' }))
  expect(settings.updateModule).not.toHaveBeenCalled()
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /确定|确 定|OK/ }))
  await waitFor(() => expect(settings.updateModule).toHaveBeenCalledWith('cloud', { auto_sync: true }, expect.any(Object)))
  expect(api.confirm).toHaveBeenCalledWith(status.generation, preview.id)
  expect(screen.queryByRole('heading', { name: '同步范围与差异' })).not.toBeInTheDocument()
})

test('确认弹窗打开后设备被撤销，禁用确认且不发送同步请求', async () => {
  const { api } = setup()
  const props = { api, status, busy: false, run }
  const view = render(<AccountSync {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
  fireEvent.click(await screen.findByRole('button', { name: '确认并启用同步' }))
  view.rerender(<AccountSync {...props} status={{ ...status, device_status: 'revoked' }} />)
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: /确定|确 定|OK/ })
  expect(confirm).toBeDisabled()
  fireEvent.click(confirm)
  expect(api.confirm).not.toHaveBeenCalled()
})

test('切换 Core 后，旧预览不能写入新面板或继续请求旧连接', async () => {
  const previous = setup()
  const next = setup()
  let finish!: (value: CloudPreview) => void
  vi.mocked(previous.api.preview).mockImplementation(() => new Promise((done) => { finish = done }))
  const view = render(<AccountSync api={previous.api} status={status} busy={false} run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
  view.rerender(<AccountSync api={next.api} status={status} busy={false} run={run} />)
  await act(async () => { finish(preview) })
  expect(previous.api.conflicts).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '确认并启用同步' })).not.toBeInTheDocument()
})

test('首次同步缺少恢复保障时可预览，但不能确认或开启自动同步', async () => {
  const { api, settings } = setup()
  vi.mocked(api.security).mockResolvedValue({ ...security, account: { ...security.account, recovery_required: true, recovery_ready: false } })
  render(<SettingsGatewayContext value={settings}><AccountSync api={api} status={status} busy={false} run={run} /></SettingsGatewayContext>)
  await waitFor(() => expect(screen.getByRole('button', { name: '预览同步' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '预览同步' }))
  expect(await screen.findByRole('button', { name: '确认并启用同步' })).toBeDisabled()
  expect(screen.getByRole('switch')).toBeDisabled()
  expect(api.confirm).not.toHaveBeenCalled()
  expect(settings.updateModule).not.toHaveBeenCalled()
})

test('读取恢复保障失败时不推断已开启，也不允许手动同步', async () => {
  const { api, settings } = setup()
  vi.mocked(api.security).mockRejectedValue(new Error('offline'))
  render(<SettingsGatewayContext value={settings}><AccountSync api={api} status={{ ...status, confirmed: true }} busy={false} run={run} /></SettingsGatewayContext>)
  expect(await screen.findByRole('button', { name: '立即同步' })).toBeDisabled()
  expect(screen.getByRole('switch')).toBeDisabled()
})
