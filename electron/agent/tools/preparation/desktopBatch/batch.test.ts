import assert from 'node:assert/strict'
import test from 'node:test'
import type { Tool, CallToolResult } from '@modelcontextprotocol/client'
import { mapMCPTools } from '../../mcpClientAdapter.ts'
import { prepareBuiltinTools } from '../index.ts'
import type { PreparedCall } from '../../../contracts/toolPreparation.ts'
import { isMCPToolDetails } from '../../../contracts/mcpTools.ts'
import { runtimeDesktopSafetyOutcome, RuntimeInputSafety } from '../../../execution/runtimeInputSafety.ts'
import { DesktopTaskCoordinator } from '../../../runtime/desktopTasks/coordinator.ts'
import { desktopWaitTool } from '../../../runtime/desktopTasks/waitTool.ts'

const string = { type: 'string' }
const tool = (name: string, properties: Record<string, unknown>, required: string[], readOnly = false): Tool => ({ name: `termous.desktops.${name}`, description: name,
  inputSchema: { type: 'object', properties: properties as Tool['inputSchema']['properties'], required, additionalProperties: false }, annotations: { readOnlyHint: readOnly } })
const execute = tool('execute', { wait_ms: { type: 'integer', minimum: 0, maximum: 5000 }, attachment_id: string, grant_id: string, client_request_id: string, screenshot_id: string, actions: { type: 'array', items: { type: 'object' } } }, ['attachment_id', 'grant_id', 'client_request_id', 'actions'])
const definitions = [execute,
  tool('get', { attachment_id: string, wait_ms: { type: 'integer' } }, [], true),
  tool('executions.get', { execution_id: string, client_request_id: string }, [], true),
  tool('executions.cancel', { execution_id: string, client_request_id: string }, []),
  tool('pointer.click', { attachment_id: string, grant_id: string, client_request_id: string, screenshot_id: string, x: { type: 'integer' }, y: { type: 'integer' } }, ['attachment_id', 'grant_id', 'client_request_id', 'screenshot_id', 'x', 'y']),
]
const attachment = { id: 'attachment', session_id: 'session', connection_generation: 1, state: 'ready', grant: { id: 'grant', expires_at: new Date(Date.now() + 60000).toISOString(), idle_expires_at: new Date(Date.now() + 60000).toISOString() } }
function receipt(request = 'original') {
  return { run: { id: 'desktop_execution_test', client_request_id: request, attachment_id: 'attachment', state: 'stopped', accepted_actions: 1,
    steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 100 }, { index: 1, kind: 'keyboard.key', state: 'failed', wait_after_ms: 0 }],
    execution: { phase: 'desktop_batch', dispatch: 'dispatched', recovery: { kind: 'reread', tool: 'termous.desktops.executions.get', arguments: { client_request_id: request } } } },
  capture_state: 'ready', capture: { screenshot_id: 'after', expires_at: new Date(Date.now() + 60000).toISOString() } }
}
function response(data: Record<string, unknown>, failed = false): CallToolResult {
  return { isError: failed, content: [{ type: 'text', text: JSON.stringify(data) }, ...(data.capture ? [{ type: 'image' as const, mimeType: 'image/png', data: 'iVBORw==' }] : [])], structuredContent: data }
}
function harness(respond: (name: string, args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const records = new Map<string, PreparedCall>()
  const mapped = mapMCPTools(definitions, async (definition, args) => {
    calls.push({ name: definition.name, args: structuredClone(args) })
    if (definition.name === 'termous.desktops.get') return response({ attachment })
    return respond(definition.name, args)
  })
  const originalName = (name: string) => mapped.originalNames.get(name) ?? null
  let observeBatch: ((output: Record<string, unknown>) => void) | undefined
  const tools = prepareBuiltinTools({ ...mapped, originalName, close: async () => {}, readOnly: name => definitions.find(tool => tool.name === name)?.annotations?.readOnlyHint === true }, {
    registerBatchObserver: observe => { observeBatch = observe },
    runID: 'run', generation: 2, persist: async value => { records.set(`${value.tool_call_id}:${value.step}`, value) }, lookup: async (id, step) => records.get(`${id}:${step}`),
  })
  return { calls, records, observeBatch: (output: Record<string, unknown>) => observeBatch?.(output), run: (name: string, id: string, args: Record<string, unknown>) => tools.find(tool => originalName(tool.name) === `termous.desktops.${name}`)!.execute(id, args) }
}

test('显式本地等待登记原终态截图，下一次坐标输入无需重新截图', async () => {
  const h = harness(() => response({}))
  await h.run('execute', 'batch', { attachment_id: 'attachment', actions: [{ kind: 'keyboard.key', code: 'Enter' }] })
  const result = receipt()
  const terminal = { tool_call_id: 'batch', execution_id: result.run.id, revision: 4, result: { ...result, run: { ...result.run, revision: 4 } } }
  const tasks = new DesktopTaskCoordinator(async () => ({ cursor: 'a'.repeat(64), tasks: [{ tool_call_id: 'batch', client_request_id: 'original', generation: 2, execution_id: terminal.execution_id, receipt: terminal }] }), () => {}, () => {})
  try {
    const waited = await desktopWaitTool(tasks, h.observeBatch).execute('wait', { execution_id: terminal.execution_id })
    assert.ok(isMCPToolDetails(waited.details))
    await h.run('pointer.click', 'click-after-wait', { screenshot_id: 'after', x: 3, y: 4 })
    assert.equal(h.calls[h.calls.length - 1].name, 'termous.desktops.pointer.click')
  } finally { tasks.close() }
})

test('链式派发丢失响应只核查原请求一次，保留失败图片且不重放', async () => {
  const h = harness((name, args) => {
    if (name === execute.name) throw new Error('transport lost')
    return response(receipt(String(args.client_request_id)), true)
  })
  const result = await h.run('execute', 'call', { attachment_id: 'attachment', actions: [{ kind: 'keyboard.text', text: 'private' }] })
  assert.deepEqual(h.calls.map(call => call.name), ['termous.desktops.get', execute.name, 'termous.desktops.executions.get'])
  assert.equal(h.calls[1].args.client_request_id, h.calls[2].args.client_request_id)
  assert.ok(result.content.some(block => block.type === 'image'))
  assert.ok(isMCPToolDetails(result.details) && result.details.result.isError)
  assert.ok(!JSON.stringify([...h.records.values()]).includes('private'))
  await h.run('execute', 'call', { attachment_id: 'attachment', actions: [{ kind: 'keyboard.text', text: 'private' }] })
  assert.equal(h.calls.filter(call => call.name === execute.name).length, 1)
  assert.equal(h.calls[h.calls.length - 1].name, 'termous.desktops.executions.get')
  // 失败批次仍可登记本轮附着的有效截图；后续定位使用原图，不暗中补拍。
  await h.run('pointer.click', 'click', { screenshot_id: 'after', x: 3, y: 4 })
  assert.equal(h.calls[h.calls.length - 1].name, 'termous.desktops.pointer.click')
})

test('核查失败保持未知，查询与取消跨代次只使用原请求标识', async () => {
  const h = harness(() => { throw new Error('offline') })
  const result = await h.run('execute', 'call', { attachment_id: 'attachment', actions: [{ kind: 'keyboard.key', code: 'Enter' }] })
  assert.equal(h.calls.filter(call => call.name === execute.name).length, 1)
  assert.equal(h.calls.filter(call => call.name === 'termous.desktops.executions.get').length, 1)
  assert.ok(runtimeDesktopSafetyOutcome(execute.name, result, true).inputUncertain)
  for (const name of ['executions.get', 'executions.cancel']) {
    const query = harness((_name, args) => response(receipt(String(args.client_request_id)), true))
    query.records.set('old:dispatch', { tool_call_id: 'old', tool_name: execute.name, step: 'dispatch', generation: 1, request_id: 'original', arguments_sha256: 'digest', values: { attachment_id: 'expired', grant_id: 'expired' } })
    await query.run(name, 'query', { tool_call_id: 'old' })
    assert.deepEqual(query.calls, [{ name: `termous.desktops.${name}`, args: { client_request_id: 'original' } }])
    await query.run(name, 'query', { tool_call_id: 'old' })
    assert.deepEqual(query.calls, Array.from({ length: 2 }, () => ({ name: `termous.desktops.${name}`, args: { client_request_id: 'original' } })))
  }
})

test('按执行标识重复取消只复用原执行标识', async () => {
  const h = harness(() => response(receipt()))
  for (let i = 0; i < 2; i++) await h.run('executions.cancel', 'cancel', { execution_id: 'desktop_execution_test' })
  assert.deepEqual(h.calls, Array.from({ length: 2 }, () => ({ name: 'termous.desktops.executions.cancel', args: { execution_id: 'desktop_execution_test' } })))
})

test('链式不确定和清理问题沿用运行保护，允许查询与取消', () => {
  const data = receipt()
  data.run.state = 'uncertain'
  data.run.steps[1].state = 'uncertain'
  const result = { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: {} }
  const safety = new RuntimeInputSafety()
  safety.observe(execute.name, result, true)
  assert.equal(safety.failure()?.code, 'AGENT_RUNTIME_INPUT_UNCERTAIN')
  const cleanup = new RuntimeInputSafety()
  cleanup.observe('termous.desktops.executions.get', { ...result, content: [{ type: 'text', text: JSON.stringify({ ...data, run: { ...data.run, state: 'completed', accepted_actions: 2, steps: data.run.steps.map(step => ({ ...step, state: 'accepted' })), cleanup_error: 'desktop_cleanup_uncertain' } }) }] }, true)
  assert.ok(cleanup.blockedTool(execute.name, {}))
  assert.equal(cleanup.blockedTool('termous.desktops.executions.get', {}), undefined)
  assert.equal(cleanup.blockedTool('termous.desktops.executions.cancel', {}), undefined)
})
