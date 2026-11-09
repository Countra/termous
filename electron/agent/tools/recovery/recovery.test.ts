import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeToolNavigation } from '../runtimeToolNavigation.ts'
import { RuntimeToolDiscovery } from '../runtimeToolDiscovery.ts'
import { mapMCPTools } from '../mcpClientAdapter.ts'
import { Type } from 'typebox'
import { previewRecovery, revisionRecovery } from './revisions.ts'
import { RuntimeToolProgress } from '../runtimeToolProgress.ts'

function failure(code: string, recovery?: Record<string, unknown>) {
  const data = { error: { code, message: '具体原因', ...(recovery ? { execution: { phase: 'preparation', dispatch: 'not_started', recovery } } : {}) } }
  return { content: [], details: { kind: 'mcp', originalToolName: 'termous.desktops.get', result: { content: [], structuredContent: data, isError: true } } }
}

test('泛化 reread 不遮蔽领域恢复，失效附着不再导航到原 get', () => {
  for (const recovery of [undefined, { kind: 'reread' }, { kind: 'reread', tool: 'termous.desktops.attach' }]) {
    const navigation = runtimeToolNavigation('termous.desktops.get', failure('desktop_generation_stale', recovery))!
    assert.ok(navigation.names.includes('termous.desktops.attach'))
    assert.ok(navigation.names.includes('termous.desktops.sources'))
    assert.ok(!navigation.names.includes('termous.desktops.get'))
  }
  for (const kind of ['user_action', 'approval', 'none', 'query_operation']) {
    const navigation = runtimeToolNavigation('termous.desktops.get', failure('desktop_generation_stale', { kind }))!
    assert.deepEqual(navigation.names, [])
  }
})

test('恢复动作先校验当前模型 Schema，缺少权限不声明可执行参数', () => {
  const name = 'termous.snippets.get'
  const mapped = mapMCPTools([{ name, inputSchema: { type: 'object', properties: { snippet_id: { type: 'string' } }, required: ['snippet_id'], additionalProperties: false } }], async () => { throw new Error('恢复指引不能派发') })
  const discovery = new RuntimeToolDiscovery(mapped.tools, encoded => mapped.originalNames.get(encoded) ?? null, [])
  const base = { names: [name], guidance: 'Read the snippet.', recovery: true }
  const valid = discovery.resolveNavigation({ ...base, prerequisite: { tool: name, arguments: { snippet_id: 's' } } })
  assert.match(valid.guidance, /m_termous_dsnippets_dget/)
  assert.deepEqual(JSON.parse(discovery.navigate(valid)).tool_navigation.next_action.arguments, { snippet_id: 's' })
  const invalid = discovery.resolveNavigation({ ...base, prerequisite: { tool: name, arguments: { grant_id: 'hidden' } } })
  assert.equal(invalid.prerequisite, undefined)
  assert.ok(!invalid.guidance.includes('hidden'))
  const missing = discovery.resolveNavigation({ names: ['termous.desktops.capture'], guidance: '', prerequisite: { tool: 'termous.desktops.capture', arguments: {} } })
  const output = JSON.parse(discovery.navigate(missing)).tool_navigation
  assert.equal(output.unavailable[0].status, 'unavailable')
  assert.deepEqual(output.available_next_turn, [])
  assert.equal(output.next_action, undefined)
})

test('已知任务等待保持原任务查询，结构化恢复不回到重新提交', () => {
  const result = failure('wait', { kind: 'wait', tool: 'termous.screen_analyses.get', arguments: { analysis_id: 'original' } })
  const navigation = runtimeToolNavigation('termous.screen_analyses.create', result)!
  assert.deepEqual(navigation.names, ['termous.screen_analyses.get'])
  assert.deepEqual(navigation.prerequisite?.arguments, { analysis_id: 'original' })
})

test('声明容量不足提示精确发现参数，不把暂缓声明说成已加载', () => {
  const name = 'termous.snippets.get'
  const mapped = mapMCPTools([{ name, inputSchema: { type: 'object', properties: { snippet_id: { type: 'string' } }, required: ['snippet_id'] } }], async () => { throw new Error('不能派发') })
  const permanent = Array.from({ length: 31 }, (_, i) => ({ name: `local_${i}`, label: 'test', description: 'test', parameters: Type.Object({}),
    execute: async () => ({ content: [], details: undefined }) }))
  const discovery = new RuntimeToolDiscovery(mapped.tools, encoded => mapped.originalNames.get(encoded) ?? null, permanent)
  const navigation = discovery.resolveNavigation({ names: [name], guidance: '', prerequisite: { tool: name, arguments: { snippet_id: 's' } } })
  const output = JSON.parse(discovery.navigate(navigation)).tool_navigation
  assert.equal(output.unavailable[0].status, 'deferred')
  assert.deepEqual(output.unavailable[0].discovery, { tool: 'discover_tools', arguments: { names: [name] } })
  assert.deepEqual(output.available_next_turn, [])
  assert.equal(output.next_action, undefined)
  assert.ok(!discovery.publish().some(tool => tool.name === mapped.tools[0].name))
})

test('编辑和预览恢复指明原资源，不把运行时身份传回模型', () => {
  assert.deepEqual(revisionRecovery('termous.snippets.update', { snippet_id: 's' }), { kind: 'reread', tool: 'termous.snippets.get', arguments: { snippet_id: 's' } })
  assert.deepEqual(revisionRecovery('termous.desktop_workflows.update', { script_id: 'w' }), { kind: 'reread', tool: 'termous.desktop_workflows.get', arguments: { script_id: 'w' } })
  assert.deepEqual(revisionRecovery('termous.remoteops.crontab.jobs.create', { session_id: 'ssh' }), { kind: 'reread', tool: 'termous.remoteops.crontab.get', arguments: { session_id: 'ssh' } })
  assert.deepEqual(previewRecovery('termous.files.delete.start', { file_session_id: 'fs', paths: ['/example'], client_request_id: 'hidden', expected_plan_hash: 'hidden', expected_connection_generation: 3 }),
    { kind: 'reread', tool: 'termous.files.delete.preview', arguments: { file_session_id: 'fs', paths: ['/example'] } })
})

test('未知派发不能被泛化 reread 引导为重新附着', () => {
  const result = failure('desktop_generation_stale', { kind: 'reread' })
  result.details.result.structuredContent.error.execution!.dispatch = 'unknown'
  const navigation = runtimeToolNavigation('termous.desktops.get', result)!
  assert.deepEqual(navigation.names, [])
  assert.match(navigation.guidance, /Dispatch is uncertain/)
})

test('实际版本冲突补齐读取入口，人工处理优先于领域补全', () => {
  const name = 'termous.files.save_text'
  const args = { file_session_id: 'original-session', path: '/original-path', text: 'private content' }
  const navigation = runtimeToolNavigation(name, failure('SFTP_TEXT_CONFLICT'), [], true, undefined, args)!
  assert.deepEqual(navigation.prerequisite, { tool: 'termous.files.read_text', arguments: { file_session_id: 'original-session', path: '/original-path' } })
  assert.ok(!JSON.stringify(navigation).includes('private content'))
  const restricted = runtimeToolNavigation(name, failure('SFTP_TEXT_CONFLICT', { kind: 'user_action' }), [], true, undefined, args)!
  assert.deepEqual(restricted.names, [])
})

test('新附着只消除旧观察诊断，当前与历史的人工收回提示保持', () => {
  for (const historical of [false, true]) for (const kind of ['reread', 'user_action', 'query_operation']) {
    let progress = new RuntimeToolProgress()
    progress.observe('termous.desktops.get', { attachment_id: 'old' }, failure('desktop_generation_stale', {
      kind, ...(kind === 'reread' ? { tool: 'termous.desktops.capture', arguments: {} } : {}),
    }), true)
    if (historical) {
      const snapshot = progress.snapshot()
      progress = new RuntimeToolProgress()
      assert.equal(progress.restore(snapshot), true)
    }
    progress.resolveDesktopObservation('old')
    assert.equal(progress.summary().includes('具体原因'), kind !== 'reread')
  }
})

test('新附着不消除仍需新截图的画面失效诊断', () => {
  for (const historical of [false, true]) {
    let progress = new RuntimeToolProgress()
    progress.observe('termous.desktops.capture', { attachment_id: 'old' }, failure('desktop_display_stale', {
      kind: 'reread', tool: 'termous.desktops.capture', arguments: { attachment_id: 'old' },
    }), true)
    if (historical) {
      const snapshot = progress.snapshot()
      progress = new RuntimeToolProgress()
      assert.equal(progress.restore(snapshot), true)
    }
    progress.resolveDesktopObservation('old')
    assert.ok(progress.summary().includes('具体原因'))
  }
})
