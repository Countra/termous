import assert from 'node:assert/strict'
import test from 'node:test'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { RuntimeToolDiscovery } from './runtimeToolDiscovery.ts'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { projectDesktopEvidence } from './runtimeDesktopObservation.ts'

const acquire = 'termous.desktops.control.acquire'
const get = 'termous.desktops.get'
const attachment = { id: 'a', session_id: 's', connection_generation: 1, execution_generation: 1, state: 'ready' }
const receipt = (control?: { state: string; reason?: string }, grant?: object) => ({
  content: [], details: { kind: 'mcp', originalToolName: get,
    result: { content: [], structuredContent: { attachment: { ...attachment, control, grant } } } },
})

test('首次发现已含申请前分支，重复目录增强不重复说明，也不修改接管参数', async () => {
  const calls: unknown[] = []
  const mapped = mapMCPTools([{ name: acquire, inputSchema: { type: 'object', properties: { takeover: { type: 'boolean' } } } }], async (_tool, args) => {
    calls.push(args)
    return { content: [] }
  })
  const original = (name: string) => mapped.originalNames.get(name) ?? null
  const discovery = new RuntimeToolDiscovery(mapped.tools, original, [])
  const result = await discovery.tool.execute('discover', { names: [acquire] })
  assert.match(JSON.stringify(result.content), /调用前：.*takeover_required.*takeover=true/)
  const tool = discovery.publish().find((tool) => original(tool.name) === acquire)!
  const second = new RuntimeToolDiscovery([tool], original, [])
  await second.tool.execute('again', { names: [acquire] })
  assert.equal(second.publish().find((tool) => original(tool.name) === acquire)!.description, tool.description)
  assert.equal(calls.length, 0)
  await tool.execute('call', { takeover: true })
  assert.deepEqual(calls, [{ takeover: true }])
})

test('首次查询按控制条件给出建议，阻断条件不会被残留 grant 掩盖', () => {
  for (const state of ['available', 'takeover_required', 'blocked']) {
    const grant = { id: 'old', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' }
    const navigation = runtimeToolNavigation(get, receipt({ state, reason: 'remote_viewer' }, grant))!
    assert.equal(navigation.names.includes(acquire), state !== 'blocked')
    assert.ok(!navigation.names.some((name) => name.includes('keyboard.')))
    if (state === 'takeover_required') assert.match(navigation.guidance, /首次即可.*takeover=true.*授权尚不明确/)
    if (state === 'blocked') assert.match(navigation.guidance, /takeover 不能解决/)
  }
  const legacy = runtimeToolNavigation(get, receipt())!
  assert.match(legacy.guidance, /未知.*不能推断无人占用/)
  for (const grant of [undefined, { id: 'old', expires_at: '2000-01-01T00:00:00Z', idle_expires_at: '2000-01-01T00:00:00Z' }]) {
    const expired = runtimeToolNavigation(get, receipt({ state: 'held' }, grant))!
    assert.deepEqual(expired.names, [get])
    assert.match(expired.guidance, /重新核验/)
  }
})

test('控制状态进入当前摘要，历史恢复和代次变化失效，但不新增执行门禁', () => {
  const progress = new RuntimeToolProgress()
  progress.observe(get, { attachment_id: 'a' }, receipt({ state: 'takeover_required', reason: 'control_occupied' }), false)
  assert.match(progress.summary(), /"control_status":"takeover_required"/)
  assert.equal(progress.beforeCall(acquire, { attachment_id: 'a', takeover: false }), undefined)
  assert.equal(progress.hidden(acquire), false)
  const restored = new RuntimeToolProgress()
  assert.ok(restored.restore(progress.snapshot()))
  assert.match(restored.summary(), /"control_status":"needs_verification"/)
  progress.observe(get, { session_id: 's' }, { content: [], details: { kind: 'mcp', originalToolName: get,
    result: { content: [], structuredContent: { session: { id: 's', connection_generation: 2 } } } } }, false)
  assert.doesNotMatch(progress.summary(), /"control_status":"takeover_required"/)
  const expired = projectDesktopEvidence({ control_status: 'held', grant_status: 'held', grant_expires_at: '2000-01-01T00:00:00Z' }, false, Date.now())
  assert.equal(expired.grant_status, 'needs_verification')
  assert.equal(expired.control_status, 'needs_verification')
})

test('申请返回占用或授权失效时撤销旧控制提示，兼容嵌套审批错误', () => {
  for (const code of ['desktop_control_locked', 'desktop_control_already_held', 'desktop_control_stale', 'desktop_generation_stale']) {
    for (const data of [{ error: { code } }, { control: { approval: { state: 'dispatch_conflict', error_code: code } } }]) {
      const progress = new RuntimeToolProgress()
      progress.observe(get, { attachment_id: 'a' }, receipt({ state: 'available' }), false)
      progress.observe(acquire, { attachment_id: 'a' }, { content: [], details: { kind: 'mcp', originalToolName: acquire,
        result: { content: [], structuredContent: data } } }, false)
      const current = progress.snapshot().facts.find((fact) => fact.values.attachment_id === 'a')!
      assert.equal(current.values.control_status, 'needs_verification')
      assert.equal(current.values.session_id, 's')
      assert.match(progress.summary(), new RegExp(code))
      assert.equal(progress.beforeCall(acquire, { attachment_id: 'a' }), undefined)
      progress.observe(get, { attachment_id: 'a' }, receipt({ state: 'takeover_required', reason: 'control_occupied' }), false)
      assert.equal(progress.snapshot().facts.find((fact) => fact.values.attachment_id === 'a')!.values.control_status, 'takeover_required')
    }
  }
})

test('会话仍连接但执行端不可用时失效旧控制提示，不影响其他会话或旧 Core', () => {
  const progress = new RuntimeToolProgress()
  progress.observe(get, { attachment_id: 'a' }, receipt({ state: 'available' }), false)
  const observeSession = (session: object) => progress.observe(get, { session_id: 's' }, { content: [], details: { kind: 'mcp', originalToolName: get,
    result: { content: [], structuredContent: { session } } } }, false)
  observeSession({ id: 's', status: 'ready', connection_generation: 1 })
  observeSession({ id: 'other', status: 'ready', connection_generation: 1, desktop: { available: false, execution_generation: 1 } })
  assert.equal(progress.snapshot().facts.find((fact) => fact.values.attachment_id === 'a')!.values.control_status, 'available')
  observeSession({ id: 's', status: 'ready', connection_generation: 1, desktop: { available: false, execution_generation: 1 } })
  assert.equal(progress.snapshot().facts.find((fact) => fact.values.attachment_id === 'a')!.values.control_status, 'needs_verification')
})
