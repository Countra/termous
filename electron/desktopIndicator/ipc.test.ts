import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopControlSnapshot, DesktopIndicatorState } from '../../common/contracts/desktop-controls.ts'
import { installIndicatorIPC } from './ipc.ts'

test('受限浮层 IPC 拒绝徽标、旧引用、断线和重复提交；关闭不收回控制', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, request?: unknown) => unknown>()
  let role: DesktopIndicatorState['role'] = 'badge'
  let snapshot: DesktopControlSnapshot | null = { instance_id: 'core', controls: [{
    target: { kind: 'host_desktop', instance_id: 'capture', host: { id: 'screen', kind: 'screen', title: '', generation: 1 } },
    reference: 'a'.repeat(64), source: 'agent', name: '', active: true,
  }] }
  const request = { ...snapshot.controls[0], instance_id: snapshot.instance_id }
  let calls = 0
  let finish!: () => void
  const uninstall = installIndicatorIPC({
    ipc: { handle: (key, fn) => { handlers.set(key, fn) }, removeHandler: key => { handlers.delete(key) } },
    own: () => role, snapshot: () => snapshot,
    state: value => ({ role: value, revision: 1, theme: 'dark', language: 'zh-CN', control: null, instance_id: 'core' }),
    reclaim: () => { calls++; return new Promise<void>(resolve => { finish = resolve }) },
    failed: () => assert.fail('不应出现业务失败'),
  })
  const invoke = (value: unknown) => Promise.resolve(handlers.get('desktop-indicator:reclaim')!({} as IpcMainInvokeEvent, value))
  await assert.rejects(invoke(request))
  role = 'bar'
  await assert.rejects(invoke({ ...request, reference: 'b'.repeat(64) }))
  const first = invoke(request)
  await assert.rejects(invoke(request))
  assert.equal(calls, 1)
  finish()
  await first
  snapshot = null
  await assert.rejects(invoke(request))
  uninstall()
  assert.equal(calls, 1)
  assert.equal(handlers.size, 0)
})
