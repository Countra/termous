import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'

const acquire = 'termous.desktops.control.acquire'
const get = 'termous.desktops.get'
const now = Date.parse('2026-10-16T05:15:00Z')
const attachment = { id: 'attachment', session_id: 'session', connection_generation: 1, execution_generation: 1, state: 'ready' }
const held = { ...attachment, grant: { id: 'grant', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' } }
const conflict = { control: { approval: { state: 'dispatch_conflict', error_code: 'desktop_control_locked' } } }
const receipt = (name: string, data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  details: { kind: 'mcp', originalToolName: name, readOnly: name === get, result: { content: [], structuredContent: data, isError: false } } })
const observe = (progress: RuntimeToolProgress, name: string, data: unknown, request = 'request') => progress.observe(name,
  { attachment_id: attachment.id, client_request_id: request }, receipt(name, data), false)

test('脱敏真实回放：占用冲突立即引导，同一前置查询不另发警告，取得授权后恢复诊断', () => {
  const progress = new RuntimeToolProgress(() => now)
  // 来自真实故障的三组 get/acquire；第三次申请复用请求 ID，不应被当作业务推进。
  for (const request of ['first', 'second', 'second']) {
    observe(progress, get, { attachment })
    observe(progress, acquire, conflict, request)
    assert.match(progress.summary(), /desktop_control_locked/)
  }
  const notices = progress.drain()
  assert.equal(notices.filter((notice) => notice.status === 'detected').length, 1)
  assert.equal(notices[0]?.tool_name, acquire)
  assert.equal(progress.beforeCall(acquire, { attachment_id: attachment.id }), undefined)
  observe(progress, acquire, { control: { attachment: held, approval: { state: 'approved' } } }, 'takeover')
  assert.ok(progress.drain().some((notice) => notice.status === 'progressed'))
  assert.doesNotMatch(progress.summary(), /desktop_control_locked|"status":"detected"/)
  assert.match(progress.summary(), /"grant_status":"held"/)
})

test('新授权恢复同附着查询的旧警告，但重复返回相同 grant 仍累计，其他资源不被清除', () => {
  const progress = new RuntimeToolProgress(() => now)
  for (let i = 0; i < 3; i++) observe(progress, get, { attachment })
  for (let i = 0; i < 3; i++) progress.observe(acquire, { attachment_id: 'other' }, receipt(acquire, conflict), false)
  progress.drain()
  observe(progress, acquire, { control: { attachment: held } })
  assert.ok(progress.drain().some((notice) => notice.tool_name === get && notice.status === 'progressed'))
  assert.ok(progress.snapshot().notices.some(([scope, notice]) => scope === 'attachment_id:other' && notice.status === 'detected'))
  for (let i = 0; i < 2; i++) observe(progress, acquire, { control: { attachment: held } })
  assert.ok(progress.drain().some((notice) => notice.tool_name === acquire && notice.status === 'detected'))
})

test('无授权与待核验有不同含义，等待审批或其他附着不能清除控制冲突', () => {
  const progress = new RuntimeToolProgress(() => now)
  observe(progress, get, { attachment })
  assert.match(progress.summary(), /"grant_status":"not_held"/)
  for (let i = 0; i < 3; i++) observe(progress, acquire, conflict)
  progress.drain()
  observe(progress, acquire, { control: { approval: { state: 'dispatching' } } })
  progress.observe(acquire, { attachment_id: 'other' }, receipt(acquire, { control: { attachment: { ...held, id: 'other' } } }), false)
  assert.ok(progress.snapshot().notices.some(([scope, notice]) => scope === 'attachment_id:attachment' && notice.status === 'detected'))
  assert.ok(!progress.drain().some((notice) => notice.status === 'progressed'))
})

test('审批已结束但没有可用 grant 不能恢复控制冲突', () => {
  for (const result of [
    { approval: { state: 'approved' } },
    { approval: { state: 'approved' }, attachment },
    { approval: { state: 'approved' }, attachment: { ...held, grant: { ...held.grant, expires_at: '2000-01-01T00:00:00Z' } } },
  ]) {
    const progress = new RuntimeToolProgress(() => now)
    for (let i = 0; i < 3; i++) observe(progress, acquire, conflict)
    progress.drain()
    observe(progress, acquire, { control: result })
    assert.ok(progress.snapshot().notices.some(([, notice]) => notice.status === 'detected'))
    assert.ok(progress.snapshot().recoveries.some((entry) => entry.tool === acquire))
    assert.ok(!progress.drain().some((notice) => notice.status === 'progressed'))
  }
})

test('重启保留历史冲突经验，不继承重复次数，当前有效授权消除历史问题', () => {
  const old = new RuntimeToolProgress(() => now)
  for (const request of ['first', 'second', 'second']) {
    observe(old, get, { attachment })
    observe(old, acquire, conflict, request)
  }
  const progress = new RuntimeToolProgress(() => now)
  assert.ok(progress.restore(old.snapshot()))
  assert.match(progress.summary(), /historical/)
  observe(progress, get, { attachment })
  observe(progress, acquire, conflict, 'new-run')
  assert.equal(progress.drain().length, 0)
  observe(progress, acquire, { control: { attachment: held } }, 'takeover')
  assert.doesNotMatch(progress.summary(), /desktop_control_locked|"status":"detected"/)
  assert.match(progress.summary(), /"grant_status":"held"/)
})

test('申请失败后持续无授权查询仍按原节奏提示，不被前置查询去重永久吞掉', () => {
  const progress = new RuntimeToolProgress(() => now)
  observe(progress, acquire, conflict)
  for (let index = 0; index < 12; index++) observe(progress, get, { attachment })
  assert.deepEqual(progress.drain().filter((notice) => notice.status === 'detected').map((notice) => notice.count), [3, 6, 12])
  assert.equal(progress.beforeCall(get, { attachment_id: attachment.id }), undefined)
  observe(progress, acquire, { control: { attachment: held } })
  assert.ok(progress.drain().some((notice) => notice.tool_name === get && notice.status === 'progressed'))
})
