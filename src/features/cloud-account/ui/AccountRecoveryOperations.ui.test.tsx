import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, test, vi } from 'vitest'
import type { CloudArchive, CloudArchivePreview, CloudStatus, CloudWorkspaceRestart } from '#common/contracts'
import { CloudState, type CloudGateway } from '#entities/cloud'
import { TermousApiError } from '#shared/api'
import { changeLanguage } from '#shared/i18n'
import { AccountArchives } from './AccountArchives'
import { AccountPersonalAuthorize } from './AccountPersonalAuthorize'
import { AccountWorkspaceRestart } from './AccountWorkspaceRestart'

beforeAll(async () => { await changeLanguage('zh-CN') })
const status: CloudStatus = { generation: 'fixture', revision: 1, configured: true, authenticated: true, phase: 'ready', device_status: 'pending', confirmed: false, auto_sync: false, pending: 0, conflicts: 0 }
const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => { try { return await action() } catch { return undefined } }
const archive: CloudArchive = { id: 'archive_fixture', status: 'archived', revision: '1', expires_at: new Date(Date.now() + 600_000).toISOString(), local_key_available: false }
const preview: CloudArchivePreview = { id: 'preview_fixture', generation: 'fixture', workspace_id: archive.id, expires_at: archive.expires_at!, items: [], blocked: false, conflicts: [{ id: 'conflict_fixture', dataset: 'host_groups', object_id: 'group_fixture', name: 'Synthetic group', local_deleted: false, remote_deleted: false }] }
function fixture() {
  const state = new CloudState(); state.accept(status)
  const api = {
    getStatus: state.snapshot, subscribeStatus: state.subscribe,
    archives: vi.fn(async () => [archive]), previewArchive: vi.fn(async () => preview), applyArchive: vi.fn(async () => undefined),
    reauthenticate: vi.fn(async () => ({ verified_until: new Date(Date.now() + 300_000).toISOString() })), deleteArchive: vi.fn(async () => undefined),
  } as unknown as CloudGateway
  return { api, state }
}
async function openArchive() {
  fireEvent.click(await screen.findByRole('button', { name: '取回到本地' }))
  fireEvent.change(screen.getByLabelText('个人恢复密钥'), { target: { value: 'synthetic-recovery-key' } })
  fireEvent.submit(screen.getByLabelText('个人恢复密钥').closest('form')!)
}

test('个人恢复失败在弹窗内显示安全错误码并清除密钥输入', async () => {
  const { api } = fixture()
  api.recoverPersonal = vi.fn(async () => { throw new TermousApiError('membership_conflict', 'CLOUD_OPERATION_FAILED', 409) })
  render(<AccountPersonalAuthorize api={api} status={status} devices={[]} enabled busy={false} disabled={false} run={run} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '使用个人恢复密钥' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('个人恢复密钥'), { target: { value: 'synthetic-recovery-key' } })
  fireEvent.submit(dialog.getByLabelText('个人恢复密钥').closest('form')!)
  expect(await dialog.findByText('错误代码：membership_conflict')).toBeInTheDocument()
  expect(dialog.getByLabelText('个人恢复密钥')).toHaveValue('')
})

test('个人恢复处理中拦截重复提交和关闭', async () => {
  const { api } = fixture()
  let reject!: (cause: Error) => void
  api.recoverPersonal = vi.fn<CloudGateway['recoverPersonal']>(() => new Promise((_resolve, fail) => { reject = fail }))
  render(<AccountPersonalAuthorize api={api} status={status} devices={[]} enabled busy={false} disabled={false} run={run} onChanged={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '使用个人恢复密钥' }))
  const dialog = within(screen.getByRole('dialog'))
  const field = dialog.getByLabelText('个人恢复密钥')
  fireEvent.change(field, { target: { value: 'synthetic-recovery-key' } })
  fireEvent.submit(field.closest('form')!); fireEvent.submit(field.closest('form')!)
  await waitFor(() => expect(api.recoverPersonal).toHaveBeenCalledOnce())
  expect(dialog.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  await act(async () => { reject(new Error('network_unavailable')) })
  expect(await dialog.findByText('错误代码：network_unavailable')).toBeInTheDocument()
})

test('归档预览失败在弹窗内反馈且不保留恢复秘密', async () => {
  const { api } = fixture()
  vi.mocked(api.previewArchive).mockRejectedValueOnce(new TermousApiError('archive_expired', 'CLOUD_OPERATION_FAILED', 410))
  render(<AccountArchives api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  await openArchive()
  const dialog = within(screen.getByRole('dialog'))
  expect(await dialog.findByText('错误代码：archive_expired')).toBeInTheDocument()
  expect(dialog.getByLabelText('个人恢复密钥')).toHaveValue('')
  expect(api.applyArchive).not.toHaveBeenCalled()
})

test('归档应用失败保留冲突选择，重试不重复获取快照', async () => {
  const { api } = fixture()
  vi.mocked(api.applyArchive).mockRejectedValueOnce(new TermousApiError('membership_conflict', 'CLOUD_OPERATION_FAILED', 409))
  render(<AccountArchives api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  await openArchive()
  const dialog = within(screen.getByRole('dialog'))
  const local = await dialog.findByRole('radio', { name: '保留本地' })
  fireEvent.click(local)
  const apply = dialog.getByRole('button', { name: '确认取回并暂停自动同步' })
  fireEvent.click(apply)
  expect(await dialog.findByText('错误代码：membership_conflict')).toBeInTheDocument()
  expect(local).toBeChecked()
  fireEvent.click(apply)
  await waitFor(() => expect(api.applyArchive).toHaveBeenCalledTimes(2))
  expect(api.previewArchive).toHaveBeenCalledOnce()
})

test('账号切换后迟到的归档身份验证不能继续删除', async () => {
  const { api, state } = fixture()
  let resolve!: (value: { verified_until: string }) => void
  vi.mocked(api.reauthenticate).mockImplementation(() => new Promise(done => { resolve = done }))
  const view = render(<AccountArchives key={status.generation} api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  fireEvent.click(await screen.findByRole('button', { name: '永久删除归档' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('密码'), { target: { value: 'synthetic-password' } })
  fireEvent.submit(dialog.getByLabelText('密码').closest('form')!)
  await waitFor(() => expect(api.reauthenticate).toHaveBeenCalledOnce())
  const next = { ...status, generation: 'another-account' }; state.accept(next)
  view.rerender(<AccountArchives key={next.generation} api={api} status={next} busy={false} mfaEnabled={false} run={run} />)
  await act(async () => { resolve({ verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(api.deleteArchive).not.toHaveBeenCalled()
})

test('因子更换后的迟到认证不能删除归档，旧验证码及时清除', async () => {
  const { api } = fixture()
  let resolve!: (value: { verified_until: string }) => void
  vi.mocked(api.reauthenticate).mockImplementation(() => new Promise(done => { resolve = done }))
  const view = render(<AccountArchives api={api} status={status} busy={false} mfaEnabled mfaRevision="1" run={run} />)
  fireEvent.click(await screen.findByRole('button', { name: '永久删除归档' }))
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '永久删除归档' }))
  await waitFor(() => expect(api.reauthenticate).toHaveBeenCalledOnce())
  view.rerender(<AccountArchives api={api} status={status} busy={false} mfaEnabled mfaRevision="2" run={run} />)
  expect(screen.getByLabelText('验证器验证码')).toHaveValue('')
  await act(async () => { resolve({ verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(api.deleteArchive).not.toHaveBeenCalled()
  expect(screen.getByText('错误代码：mfa_revision_conflict')).toBeInTheDocument()
})

test('重新开始验证期间因子变化，仅查询事实，不采用旧验证结果或执行切换', async () => {
  const { api } = fixture()
  const pending: CloudWorkspaceRestart = { id: 'restart_fixture', status: 'pending', revision: 1, source_workspace_id: 'old', target_workspace_id: 'new', expires_at: archive.expires_at!, email_sent: true }
  let resolve!: (value: CloudWorkspaceRestart) => void
  api.createWorkspaceRestart = vi.fn(async () => pending)
  api.workspaceRestart = vi.fn(async () => pending)
  api.verifyRestart = vi.fn<CloudGateway['verifyRestart']>(() => new Promise(done => { resolve = done }))
  api.completeRestart = vi.fn()
  const view = render(<AccountWorkspaceRestart api={api} status={status} busy={false} mfaEnabled mfaRevision="1" run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  fireEvent.click(screen.getByRole('button', { name: '创建重新开始申请' }))
  fireEvent.change(await screen.findByLabelText('邮件中的确认码'), { target: { value: 'synthetic-email-proof' } })
  fireEvent.change(screen.getByLabelText('验证器验证码'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: '验证身份' }))
  await waitFor(() => expect(resolve).toBeDefined())
  view.rerender(<AccountWorkspaceRestart api={api} status={status} busy={false} mfaEnabled mfaRevision="2" run={run} />)
  await act(async () => { resolve({ ...pending, status: 'verified', revision: 2, verified_until: new Date(Date.now() + 300_000).toISOString() }) })
  expect(screen.getByText('错误代码：mfa_revision_conflict')).toBeInTheDocument()
  expect(api.workspaceRestart).toHaveBeenCalledOnce()
  expect(api.completeRestart).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: '确认立即重新开始' })).not.toBeInTheDocument()
})

test('旧归档预览不能进入新账号的取回向导', async () => {
  const { api, state } = fixture()
  let resolve!: (value: CloudArchivePreview) => void
  vi.mocked(api.previewArchive).mockImplementation(() => new Promise(done => { resolve = done }))
  const view = render(<AccountArchives key={status.generation} api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  await openArchive()
  await waitFor(() => expect(api.previewArchive).toHaveBeenCalledOnce())
  const next = { ...status, generation: 'another-account' }; state.accept(next)
  view.rerender(<AccountArchives key={next.generation} api={api} status={next} busy={false} mfaEnabled={false} run={run} />)
  await act(async () => { resolve(preview) })
  fireEvent.click(await screen.findByRole('button', { name: '取回到本地' }))
  expect(screen.getByLabelText('个人恢复密钥')).toHaveValue('')
  expect(screen.queryByText('Synthetic group')).not.toBeInTheDocument()
})

test('重新开始申请失败就地反馈，异常正文不进入弹窗', async () => {
  const { api } = fixture()
  api.createWorkspaceRestart = vi.fn(async () => { throw new Error('synthetic secret in arbitrary error') })
  render(<AccountWorkspaceRestart api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  fireEvent.click(screen.getByRole('button', { name: '创建重新开始申请' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(await dialog.findByText('错误代码：local_failed')).toBeInTheDocument()
  expect(dialog.queryByText('synthetic secret in arbitrary error')).not.toBeInTheDocument()
  await waitFor(() => expect(dialog.getByRole('button', { name: /创建重新开始申请/ })).toBeEnabled())
})

test('重新开始申请仅提交一次，账号切换后旧回执失效', async () => {
  const { api, state } = fixture()
  let resolve!: (value: CloudWorkspaceRestart) => void
  api.createWorkspaceRestart = vi.fn<CloudGateway['createWorkspaceRestart']>(() => new Promise(done => { resolve = done }))
  const view = render(<AccountWorkspaceRestart key={status.generation} api={api} status={status} busy={false} mfaEnabled={false} run={run} />)
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  const create = screen.getByRole('button', { name: '创建重新开始申请' })
  fireEvent.click(create); fireEvent.click(create)
  expect(api.createWorkspaceRestart).toHaveBeenCalledOnce()
  const next = { ...status, generation: 'another-account' }; state.accept(next)
  view.rerender(<AccountWorkspaceRestart key={next.generation} api={api} status={next} busy={false} mfaEnabled={false} run={run} />)
  await act(async () => { resolve({ id: 'restart_fixture', status: 'pending', revision: 1, source_workspace_id: 'old', target_workspace_id: 'new', expires_at: archive.expires_at!, email_sent: true }) })
  fireEvent.click(screen.getByRole('button', { name: '重新开始云同步' }))
  expect(screen.getByRole('button', { name: '创建重新开始申请' })).toBeEnabled()
  expect(screen.queryByLabelText('邮件中的确认码')).not.toBeInTheDocument()
})
