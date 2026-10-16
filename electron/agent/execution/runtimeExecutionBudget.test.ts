import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultExecutionBudget } from '#common/contracts'
import { RuntimeExecutionBudget } from './runtimeExecutionBudget.ts'
import { RuntimeInputSafety } from './runtimeInputSafety.ts'
import { emptyRuntimeUsage } from '../provider/runtimeUsage.ts'

const enabled = () => new RuntimeExecutionBudget({ ...defaultExecutionBudget, enabled: true })
const visual = 'termous.desktop_workflows.'
const result = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: {} })
const failure = result({ error: { code: 'MCP_INVALID_REQUEST', diagnostic: { reason: 'template_too_large' } } })
const observe = (budget: RuntimeExecutionBudget, name: string, args: unknown, data: unknown) => budget.evaluate({ type: 'tool_result', name, args, result: result(data), isError: false })
const preview = (budget: RuntimeExecutionBudget, snapshot = 'snapshot') => budget.evaluate({ type: 'before_tool', name: `${visual}templates.preview`, args: { snapshot_id: snapshot } })

test('默认关闭所有可选限额，长任务持续统计；输入不确定保护独立生效', () => {
  const budget = new RuntimeExecutionBudget()
  for (let i = 0; i < 70; i++) {
    assert.equal(budget.evaluate({ type: 'before_request', estimatedInput: 10000 }).allowed, true)
    budget.usage.beginRequest()
    budget.usage.record({ ...emptyRuntimeUsage(), total_tokens: 10000, input_tokens: 10000 })
    assert.equal(preview(budget).allowed, true)
    assert.equal(budget.evaluate({ type: 'tool_result', name: `${visual}templates.preview`, args: {}, result: failure, isError: true }).allowed, true)
  }
  assert.equal(budget.usage.tokens, 700000)
  assert.equal(budget.usage.requests, 70)
  assert.equal(budget.failure(), undefined)
  for (const data of [{ error: { code: 'desktop_input_uncertain' } }, { operation: { state: 'uncertain' } }, { report: { run: { state: 'uncertain' } } }]) {
    const safety = new RuntimeInputSafety()
    safety.observe('report' in data ? 'termous.desktop_workflows.runs.get' : 'termous.desktops.pointer.click', result(data), 'error' in data)
    assert.equal(safety.failure()?.code, 'AGENT_RUNTIME_INPUT_UNCERTAIN')
  }
})

test('统一决策保留首个原因，策略按运行冻结，用量记录不会使最终回答失败', () => {
  const policy = { enabled: true, limits: { ...defaultExecutionBudget.limits, model_requests: 2, total_tokens: 10000 } }
  const budget = new RuntimeExecutionBudget(policy)
  policy.enabled = false
  policy.limits.model_requests = 500
  for (let i = 0; i < 2; i++) {
    assert.equal(budget.evaluate({ type: 'before_request', estimatedInput: 500 }).allowed, true)
    budget.usage.beginRequest()
  }
  budget.usage.record({ ...emptyRuntimeUsage(), total_tokens: 11000, cache_read_tokens: 11000 })
  assert.equal(budget.failure(), undefined)
  const decision = budget.evaluate({ type: 'before_request', estimatedInput: 500 })
  assert.equal(decision.allowed, false)
  if (!decision.allowed) assert.deepEqual({ kind: decision.reason.kind, value: decision.reason.value, limit: decision.reason.limit }, { kind: 'model_requests', value: 2, limit: 2 })
  assert.deepEqual(preview(budget), decision)
  assert.equal(budget.failure()?.code, 'AGENT_RUNTIME_REQUEST_LIMIT')
  const tokens = enabled()
  tokens.usage.record({ ...emptyRuntimeUsage(), total_tokens: 500000, input_tokens: 500000 })
  assert.equal(preview(tokens).allowed, false)
  assert.equal(tokens.failure()?.code, 'AGENT_RUNTIME_TOKEN_LIMIT')
})

test('按桌面和连接代次隔离选区流程，重截图不能重置；确认旧预览不能重置后续流程', () => {
  const budget = enabled()
  for (const id of ['a', 'b']) observe(budget, 'termous.desktops.attach', {}, { attachment: { id, session_id: id, connection_generation: 1, execution_generation: 1 } })
  const capture = (id: string, snapshot: string) => observe(budget, `${visual}captures.create`, { attachment_id: id }, { snapshot: { snapshot_id: snapshot } })
  capture('a', 'a1')
  for (let i = 0; i < 5; i++) assert.equal(preview(budget, 'a1').allowed, true)
  capture('b', 'b1')
  assert.equal(preview(budget, 'b1').allowed, true)
  observe(budget, `${visual}templates.preview`, { snapshot_id: 'a1' }, { preview: { preview_id: 'p1' } })
  observe(budget, `${visual}templates.confirm`, { preview_id: 'p1' }, { asset: { id: 'asset' } })
  capture('a', 'a2')
  for (let i = 0; i < 5; i++) assert.equal(preview(budget, 'a2').allowed, true)
  observe(budget, `${visual}templates.confirm`, { preview_id: 'p1' }, { asset: { id: 'asset' } })
  capture('a', 'a3')
  assert.equal(preview(budget, 'a3').allowed, false)
  assert.equal(budget.failure()?.kind, 'selection_attempts')
})

test('视觉失败跨重新截图计数，其他工具成功不抹掉该资源的失败', () => {
  const budget = enabled()
  for (let i = 0; i < 3; i++) {
    budget.evaluate({ type: 'tool_result', name: `${visual}templates.preview`, args: { snapshot_id: `unknown${i}` }, result: failure, isError: true })
    observe(budget, `${visual}captures.create`, {}, {})
    observe(budget, 'termous.hosts.list', {}, {})
  }
  assert.equal(budget.failure()?.code, 'AGENT_RUNTIME_NO_PROGRESS')
})

test('嵌套审批冲突按实际错误归类，用户关闭预算时仍不限制重复调用', () => {
  for (const budgetEnabled of [false, true]) {
    const budget = new RuntimeExecutionBudget({ ...defaultExecutionBudget, enabled: budgetEnabled })
    const conflict = (code: string) => observe(budget, 'termous.desktops.control.acquire', { attachment_id: 'a' },
      { control: { approval: { state: 'dispatch_conflict', error_code: code } } })
    for (const code of ['desktop_control_locked', 'desktop_control_already_held']) {
      for (let index = 0; index < 2; index++) assert.equal(conflict(code).allowed, true)
    }
    assert.equal(conflict('desktop_control_already_held').allowed, !budgetEnabled)
    assert.equal(budget.failure()?.code, budgetEnabled ? 'AGENT_RUNTIME_NO_PROGRESS' : undefined)
  }
})
