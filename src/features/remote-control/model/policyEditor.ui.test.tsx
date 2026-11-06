import { expect, test, vi } from 'vitest'
import type { RemotePolicyEditor, RemotePolicyReceipt, RemoteResult } from '#common/contracts'
import { deferred, ok, policyGateway } from '../../../test/remotePolicyEditor'
import { PolicyEditor } from './policyEditor'

test('串行提交保留后续选择，使用已确认 revision，且阻止重复点击', async () => {
  const pending = deferred<RemoteResult<RemotePolicyReceipt>>()
  const gateway = policyGateway({}, { changePolicy: vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async (_g, _e, revision, change) => gateway.apply(revision, change)) })
  const editor = new PolicyEditor(gateway.api, 'account')
  await editor.open()
  editor.change({ kind: 'hosts', add: ['build'] })
  editor.change({ kind: 'desktops', add: ['rdp'] })
  editor.change({ kind: 'desktops', add: ['rdp'] })
  expect(gateway.api.changePolicy).toHaveBeenCalledTimes(1)
  expect(editor.snapshot().view?.policy.hosts?.[0].connections).toContainEqual({ id: 'rdp', kind: 'desktop' })
  expect(editor.close()).toBe(false)
  pending.resolve(gateway.apply(4, { kind: 'hosts', add: ['build'] }))
  await vi.waitFor(() => expect(gateway.api.changePolicy).toHaveBeenCalledTimes(2))
  expect(vi.mocked(gateway.api.changePolicy!).mock.calls[1][2]).toBe(5)
  await vi.waitFor(() => expect(editor.snapshot().pending.size).toBe(0))
  expect(editor.close()).toBe(true)
})

test.each(['remote_policy_changed', 'remote_request_failed', 'remote_operation_failed'])('失败补读但不重放，也不派发后续授权：%s', async code => {
  const pending = deferred<RemoteResult<RemotePolicyReceipt>>()
  const { api } = policyGateway({}, { changePolicy: vi.fn(() => pending.promise) })
  const editor = new PolicyEditor(api, 'account'); await editor.open()
  editor.change({ kind: 'hosts', add: ['build'] }); editor.change({ kind: 'agent', enabled: true })
  pending.resolve({ ok: false, code, uncertain: code === 'remote_request_failed' })
  await vi.waitFor(() => expect(api.editPolicy).toHaveBeenCalledTimes(2))
  expect(api.changePolicy).toHaveBeenCalledTimes(1)
  expect(editor.snapshot().view?.policy.agent_enabled).toBe(false)
  expect(editor.snapshot().notice).toBeDefined()
  editor.dispose()
})

test('关闭和重新打开隔离较早查询，原生目录结果不能在卸载后提交', async () => {
  const old = deferred<RemoteResult<RemotePolicyEditor>>()
  const pick = deferred<RemoteResult<string | null>>()
  const { api } = policyGateway({}, { selectPolicyDirectory: vi.fn(() => pick.promise) })
  const fresh = api.editPolicy!
  api.editPolicy = vi.fn().mockReturnValueOnce(old.promise).mockImplementation(fresh)
  const editor = new PolicyEditor(api, 'account')
  const opening = editor.open(); editor.dispose(); await editor.open()
  old.resolve(ok({ policy: { revision: 0, enabled: false, hosts: [], directories: [] }, hosts: [], desktops: [] })); await opening
  expect(editor.snapshot().view?.policy.revision).toBe(4)
  const selecting = editor.directory(true); editor.dispose(); pick.resolve(ok('selection')); await selecting
  expect(api.changePolicy).not.toHaveBeenCalled()
})

test('结果不确定且补读失败时暂停编辑，保留已确认快照', async () => {
  const { api } = policyGateway()
  vi.mocked(api.editPolicy!).mockResolvedValueOnce(ok({ policy: { revision: 4, enabled: true, hosts: [], directories: [] }, hosts: [], desktops: [] })).mockResolvedValue({ ok: false as const, code: 'remote_unavailable' })
  api.changePolicy = vi.fn(async () => ({ ok: false as const, code: 'remote_request_failed', uncertain: true }))
  const editor = new PolicyEditor(api, 'account'); await editor.open(); editor.change({ kind: 'agent', enabled: true })
  await vi.waitFor(() => expect(api.editPolicy).toHaveBeenCalledTimes(2))
  expect(editor.snapshot().blocked).toBe(true)
  expect(editor.snapshot().view?.policy.revision).toBe(4)
  editor.change({ kind: 'agent', enabled: true }); expect(api.changePolicy).toHaveBeenCalledTimes(1)
  editor.dispose()
})

test('写入失败补读后，迟到的目录选择不会继续派发授权', async () => {
  const pick = deferred<RemoteResult<string | null>>()
  const { api } = policyGateway({}, {
    selectPolicyDirectory: vi.fn(() => pick.promise),
    changePolicy: vi.fn(async () => ({ ok: false as const, code: 'remote_policy_changed' })),
  })
  const editor = new PolicyEditor(api, 'account')
  await editor.open()
  const selecting = editor.directory(true)
  editor.change({ kind: 'agent', enabled: true })
  await vi.waitFor(() => expect(api.editPolicy).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(editor.snapshot().blocked).toBe(false))
  pick.resolve(ok('old-selection'))
  await selecting
  expect(api.changePolicy).toHaveBeenCalledTimes(1)
  expect(editor.snapshot().picking).toBe(false)
  editor.dispose()
})
