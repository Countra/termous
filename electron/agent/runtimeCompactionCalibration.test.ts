import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareCompaction, type AgentMessage } from '@earendil-works/pi-agent-core'
import {
  runtimeCompactionBudget,
  runtimeCompactionCalibratedSettings,
  runtimeCompactionEntries,
  runtimeCompactionEstimate,
} from './runtimeCompactionPolicy.ts'
import {
  compactionTestAssistant,
  compactionTestModel,
  compactionTestToolHistory,
  compactionTestUser,
  createCompactionTestHarness,
} from './runtimeCompactionTestFixture.ts'

const model = { ...compactionTestModel, contextWindow: 101072, maxTokens: 4096 }
const systemPrompt = '系统要求'.repeat(1000)

test('中文历史已达真实用量阈值时校准官方切点，不再误判没有可压缩前缀', async () => {
  const raw: AgentMessage[] = []
  for (let index = 0; index < 6; index += 1) {
    raw.push(compactionTestUser('中文任务'.repeat(1000)))
    raw.push(compactionTestAssistant('执行结果'.repeat(1000), index === 5 ? 50702 : 0))
  }
  raw.push(compactionTestUser('继续'))
  const original = structuredClone(raw)
  assertNoDefaultPrefix(raw)

  const harness = createCompactionTestHarness({ model, thresholdPercent: 50, systemPrompt })
  const projected = await harness.controller.transformContext(raw)
  harness.controller.beforeProviderRequest()

  assert.equal(harness.requests.length, 1)
  assert.equal(harness.commits.length, 1)
  assert.equal(harness.commits[0]!.tokensBefore, 50703)
  assert.ok(harness.commits[0]!.tokensAfter < 50536)
  assert.equal(projected[projected.length - 1], raw[raw.length - 1])
  assert.match(JSON.stringify(projected[0]), /compacted/u)
  assert.ok(projected.length < raw.length)
  assert.deepEqual(raw, original)
  assert.deepEqual(harness.activities.map(({ status }) => status), ['started', 'completed'])
})

test('原始工具结果触发校准后仍保留完整调用配对和近期结果原文', async () => {
  const raw: AgentMessage[] = [compactionTestUser('检查远程日志'), ...compactionTestToolHistory().map((message) => {
    if (message.role === 'assistant') {
      return { ...message, usage: compactionTestAssistant('', 50702).usage }
    }
    if (message.role === 'toolResult') {
      return { ...message, content: [{ type: 'text' as const, text: `工具结果 ${message.toolCallId} ` + '日志原文'.repeat(2000) }] }
    }
    return message
  })]
  assertNoDefaultPrefix(raw)
  const original = structuredClone(raw)
  const harness = createCompactionTestHarness({ model, thresholdPercent: 50, systemPrompt })
  const projected = await harness.controller.transformContext(raw)
  harness.controller.beforeProviderRequest()

  assert.equal(harness.commits.length, 1)
  assert.equal(harness.requests.length, 1)
  const calls = new Set(projected.flatMap((message) => message.role === 'assistant'
    ? message.content.filter((part) => part.type === 'toolCall').map((part) => part.id) : []))
  const results = projected.filter((message) => message.role === 'toolResult')
  assert.ok(results.length > 0 && results.length < 6)
  assert.equal(calls.size, results.length)
  for (const result of results) {
    assert.ok(calls.has(result.toolCallId))
    const source = original.find((message) => message.role === 'toolResult' && message.toolCallId === result.toolCallId)
    assert.deepEqual(result, source)
    assert.ok(JSON.stringify(result.content).length > 8000)
  }
  assert.deepEqual(raw, original)
})

test('固定开销参与尺度换算，不把系统和工具成本全部归入短历史', async () => {
  const fixedPrompt = 's'.repeat(192000)
  const raw = [compactionTestUser('h'.repeat(4000)), compactionTestAssistant('', 50702)]
  const budget = runtimeCompactionBudget(model, 50, fixedPrompt, [])
  const calibrated = runtimeCompactionCalibratedSettings(raw, model, budget)
  assert.ok(calibrated)
  assert.equal(budget.fixedTokens, 48000)
  assert.ok(calibrated.keepRecentTokens > budget.settings.keepRecentTokens * 0.95)
  assert.equal(calibrated.reserveTokens, budget.settings.reserveTokens)

  const harness = createCompactionTestHarness({ model, thresholdPercent: 50, systemPrompt: fixedPrompt })
  await harness.controller.transformContext(raw)
  assert.equal(harness.requests.length, 0)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_UNAVAILABLE/u)
})

test('只使用有效 usage 锚点校准近期预算，不改变新增消息和窗口用量的估算', () => {
  const budget = runtimeCompactionBudget(model, 50, systemPrompt, [])
  const raw = [compactionTestUser('h'.repeat(4000)), compactionTestAssistant('', 50702)]
  const settings = runtimeCompactionCalibratedSettings(raw, model, budget)
  assert.ok(settings)
  const extended = [...raw, compactionTestUser('新增消息'.repeat(2000))]
  assert.deepEqual(runtimeCompactionCalibratedSettings(extended, model, budget), settings)
  assert.equal(runtimeCompactionEstimate(extended, model, budget.fixedTokens), 52702)

  for (const patch of [
    { model: 'previous-model' },
    { provider: 'previous-provider' },
    { api: 'openai-responses' as const },
    { stopReason: 'error' as const },
    { stopReason: 'aborted' as const },
  ]) {
    const stale = [raw[0]!, { ...compactionTestAssistant('', 50702), ...patch }]
    assert.equal(runtimeCompactionCalibratedSettings(stale, model, budget), undefined)
    assert.equal(runtimeCompactionEstimate(stale, model, budget.fixedTokens), 2000)
  }
  const withoutUsage = [compactionTestUser('h'.repeat(220000))]
  assert.equal(runtimeCompactionCalibratedSettings(withoutUsage, model, budget), undefined)
})

test('校准不强迫单条消息产生切点，也不触发低于门禁的手动无前缀压缩', async () => {
  const oversized = [compactionTestAssistant('单条历史'.repeat(1000), 50702)]
  const blocked = createCompactionTestHarness({ model, thresholdPercent: 50, systemPrompt })
  await blocked.controller.transformContext(oversized)
  assert.equal(blocked.requests.length, 0)
  assert.throws(() => blocked.controller.beforeProviderRequest(), /COMPRESSION_UNAVAILABLE/u)

  const short = [compactionTestUser('当前任务'), compactionTestAssistant('当前结果', 20000)]
  const manual = createCompactionTestHarness({ model, thresholdPercent: 50, systemPrompt, forceCompression: true })
  assert.deepEqual(await manual.controller.transformContext(short), short)
  manual.controller.beforeProviderRequest()
  assert.equal(manual.requests.length, 0)
})

function assertNoDefaultPrefix(raw: AgentMessage[]) {
  const budget = runtimeCompactionBudget(model, 50, systemPrompt, [])
  const result = prepareCompaction(runtimeCompactionEntries(raw, undefined), budget.settings)
  if (!result.ok) throw result.error
  assert.ok(result.value)
  assert.equal(result.value.messagesToSummarize.length + result.value.turnPrefixMessages.length, 0)
}
