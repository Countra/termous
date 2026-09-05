import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  compactionTestAssistant,
  compactionTestHistory,
  compactionTestModel,
  compactionTestStream,
  compactionTestToolHistory,
  compactionTestUser,
  createCompactionTestHarness,
} from './runtimeCompactionTestFixture.ts'
import {
  runtimeCompactionBudget,
  runtimeCompactionEstimate,
  runtimeCompactionProjection,
} from './runtimeCompactionPolicy.ts'

test('预算保留输出容量，小窗口适配，大窗口恢复 Pi 默认预算', () => {
  const small = runtimeCompactionBudget(compactionTestModel, 80, '', [])
  assert.equal(small.triggerTokens, 6400)
  assert.equal(small.settings.reserveTokens, 1600)
  assert.equal(small.settings.keepRecentTokens, 3200)
  const large = runtimeCompactionBudget({ ...compactionTestModel, contextWindow: 200000 }, 80, '', [])
  assert.equal(large.settings.reserveTokens, 16384)
  assert.equal(large.settings.keepRecentTokens, 20000)
  const outputLimited = runtimeCompactionBudget({ ...compactionTestModel, maxTokens: 4000 }, 95, 'a'.repeat(400), [])
  assert.equal(outputLimited.triggerTokens, 4000)
  assert.equal(outputLimited.fixedTokens, 100)
  assert.equal(outputLimited.availableTokens, 3900)
  assert.throws(() => runtimeCompactionBudget(compactionTestModel, 49, '', []), /SETTINGS_INVALID/u)
})

test('估算只信任同模型用量，无用量时补入系统和工具固定开销', () => {
  const response = compactionTestAssistant('answer', 500)
  assert.equal(runtimeCompactionEstimate([response], compactionTestModel, 100), 500)
  assert.equal(runtimeCompactionEstimate([compactionTestUser('1234')], compactionTestModel, 100), 101)
  assert.equal(runtimeCompactionEstimate([{ ...response, model: 'old-model' }], compactionTestModel, 100), 102)
  assert.equal(response.usage.totalTokens, 500)
})

test('占用来源跟随 pi 的有效基准，后续门禁无需重复携带原生用量', async () => {
  const harness = createCompactionTestHarness()
  const raw = [compactionTestUser('1234')]
  await harness.controller.transformContext(raw)
  assert.equal(harness.contexts[0]!.basis, 'pi_estimate')
  assert.equal(harness.contexts[0]!.compression_status, 'unavailable')
  raw.push(compactionTestAssistant('已完成', 500))
  await harness.controller.observeContext(raw)
  assert.equal(harness.contexts[1]!.basis, 'provider_usage')
  assert.equal(harness.contexts[1]!.provider_usage, undefined)
  raw.push(compactionTestUser('5678'))
  await harness.controller.transformContext(raw)
  assert.equal(harness.contexts[2]!.basis, 'provider_usage')
  assert.equal(harness.contexts[2]!.estimated_tokens, 501)
  assert.equal(harness.contexts[2]!.provider_usage, undefined)
})

test('模型变化回退 pi 估算，最大输出预留不计入已占用量', async () => {
  const raw = [compactionTestAssistant('answer', 500), compactionTestUser('1234')]
  for (const maxTokens of [1000, 4000]) {
    const harness = createCompactionTestHarness({
      model: { ...compactionTestModel, id: 'other-model', maxTokens },
      systemPrompt: 'system'.repeat(100),
    })
    await harness.controller.transformContext(raw)
    assert.equal(harness.contexts[0]!.basis, 'pi_estimate')
    assert.equal(harness.contexts[0]!.estimated_tokens, 153)
    assert.equal(harness.requests.length, 0)
  }
})

test('固定开销耗尽预算时不把可摘要前缀误报为可整理', async () => {
  const harness = createCompactionTestHarness({ systemPrompt: 'x'.repeat(32000) })
  const raw = [compactionTestUser('开始'), compactionTestAssistant('继续'), compactionTestUser('检查')]
  await harness.controller.transformContext(raw)
  assert.equal(harness.contexts[0]!.compression_status, 'unavailable')
  assert.equal(harness.contexts[0]!.compression_available, false)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_UNAVAILABLE/u)
  assert.equal(harness.requests.length, 0)
})

test('低于阈值不请求摘要，相同上下文指标不重复发布', async () => {
  const harness = createCompactionTestHarness()
  const raw = [compactionTestUser('检查服务状态')]
  assert.deepEqual(await harness.controller.transformContext(raw), raw)
  await harness.controller.transformContext(raw)
  harness.controller.beforeProviderRequest()
  assert.equal(harness.requests.length, 0)
  assert.equal(harness.contexts.length, 1)
  assert.equal(harness.controller.checkpoint(), undefined)
})

test('每个 Provider 前压缩并先提交，再替换投影和更新状态', async () => {
  const harness = createCompactionTestHarness()
  const raw = compactionTestHistory()
  const original = structuredClone(raw)
  const projected = await harness.controller.transformContext(raw)
  harness.controller.beforeProviderRequest()
  assert.equal(harness.commits.length, 1)
  assert.deepEqual(harness.order, ['capture', 'started', 'summary', 'commit', 'completed'])
  assert.deepEqual(raw, original)
  assert.match(JSON.stringify(projected[0]), /conversation history before this point was compacted/u)
  assert.equal(projected[projected.length - 1], raw[raw.length - 1])
  assert.equal(harness.commits[0]!.checkpoint.coveredRawLength, raw.length)
  assert.equal(harness.commits[0]!.source, 'source-snapshot')
  assert.equal(harness.commits[0]!.usage.input_tokens, 100)
  assert.ok(harness.commits[0]!.tokensAfter < 6400)
  assert.equal(harness.contexts.length, 2)
  assert.equal(harness.contexts[0]!.basis, 'provider_usage')
  assert.equal(harness.contexts[1]!.basis, 'pi_estimate')
  assert.equal(harness.contexts[1]!.compression_status,
    harness.contexts[1]!.compression_available ? 'available' : 'unavailable')
  assert.equal(harness.activities[0]!.reason, 'threshold')
})

test('压缩后不复用旧 usage，后续 raw 增量不会丢失或重压缩', async () => {
  const harness = createCompactionTestHarness()
  const raw = compactionTestHistory()
  const first = await harness.controller.transformContext(raw)
  const repeated = await harness.controller.transformContext(raw)
  assert.deepEqual(repeated, first)
  assert.equal(harness.requests.length, 1)
  raw.push(compactionTestAssistant('处理完成', 200), compactionTestUser('再检查一项'))
  const next = await harness.controller.transformContext(raw)
  assert.equal(next[next.length - 1], raw[raw.length - 1])
  assert.equal(harness.requests.length, 1)
  assert.ok(harness.contexts[harness.contexts.length - 1]!.estimated_tokens < 300)
  assert.equal((raw[5] as ReturnType<typeof compactionTestAssistant>).usage.totalTokens, 7000)
})

test('提交摘要前规范化首尾空白，与 Core 持久化回执保持一致', async () => {
  const harness = createCompactionTestHarness({
    streamFn: compactionTestStream(compactionTestAssistant(' \n\t## Goal\n继续原任务。\n\n ', 100)),
  })
  const projected = await harness.controller.transformContext(compactionTestHistory())
  harness.controller.beforeProviderRequest()
  const summary = harness.commits[0]!.checkpoint.summary
  assert.equal(summary, '## Goal\n继续原任务。')
  assert.equal(harness.controller.checkpoint()!.summary, summary)
  assert.ok(JSON.stringify(projected[0]).includes('## Goal'))
})

test('恢复后的旧尾部 usage 失效，只追加 bootstrap 增量', () => {
  const stale = compactionTestAssistant('retained', 100000)
  const raw = [compactionTestUser('新请求')]
  const projected = runtimeCompactionProjection(raw, {
    summary: '已确认的历史', retainedTail: [stale], coveredRawLength: 0, tokensBefore: 100000, timestamp: 1,
  })
  assert.equal(projected[2], raw[0])
  assert.ok(runtimeCompactionEstimate(projected, compactionTestModel, 0) < 100)
  assert.equal(stale.usage.totalTokens, 100000)
})

test('强制压缩只在第一次门禁消费，不要求达到比例阈值', async () => {
  const harness = createCompactionTestHarness({ forceCompression: true })
  const raw = compactionTestHistory()
  raw[5] = compactionTestAssistant('recent-assistant ' + 'f'.repeat(4000), 6000)
  await harness.controller.transformContext(raw)
  await harness.controller.transformContext(raw)
  assert.equal(harness.commits.length, 1)
  assert.equal(harness.activities[0]!.reason, 'manual')
})

test('手动压缩没有可摘要前缀且低于预算时直接继续', async () => {
  const harness = createCompactionTestHarness({ forceCompression: true })
  const raw = [compactionTestUser('新任务')]
  assert.deepEqual(await harness.controller.transformContext(raw), raw)
  harness.controller.beforeProviderRequest()
  assert.equal(harness.requests.length, 0)
  assert.equal(harness.activities.length, 0)
})

test('长单轮采用 Pi split turn，保留完整工具调用结果关系', async () => {
  const harness = createCompactionTestHarness()
  const raw: AgentMessage[] = [compactionTestUser('查看远程日志'), ...compactionTestToolHistory()]
  const result = await harness.controller.transformContext(raw)
  harness.controller.beforeProviderRequest()
  assert.match(JSON.stringify(harness.requests[0]!.context), /Original Request/u)
  const retained = result.slice(1)
  const toolCalls = new Set(retained.flatMap((message) => message.role === 'assistant'
    ? message.content.filter((part) => part.type === 'toolCall').map((part) => part.id) : []))
  for (const message of retained) {
    if (message.role === 'toolResult') {
      assert.ok(toolCalls.has(message.toolCallId))
      assert.ok(JSON.stringify(message.content).length > 4000)
    }
  }
  assert.match(JSON.stringify(harness.requests[0]!.context), /more characters truncated/u)
})

test('连续 split turn 不丢旧摘要，历史和轮次前缀请求都有 Termous 约束', async () => {
  const harness = createCompactionTestHarness({
    initialCheckpoint: {
      summary: '保留 SSH Session session-exact，不得重跑结果未知命令',
      retainedTail: [compactionTestUser('继续处理同一项长任务')],
      coveredRawLength: 0, tokensBefore: 7000, timestamp: 1,
    },
  })
  await harness.controller.transformContext(compactionTestToolHistory())
  harness.controller.beforeProviderRequest()
  assert.equal(harness.requests.length, 2)
  assert.match(JSON.stringify(harness.requests[0]!.context), /session-exact/u)
  for (const request of harness.requests) {
    assert.match(request.context.systemPrompt!, /不得执行，也不得调用任何工具/u)
    assert.match(request.context.systemPrompt!, /结果未知/u)
    assert.deepEqual(request.context.tools, [])
    assert.equal(request.options!.cacheRetention, 'none')
  }
  assert.equal(harness.commits[0]!.usage.input_tokens, 200)
})

test('恢复官方文件操作明细并在新 checkpoint 中继续保存', async () => {
  const harness = createCompactionTestHarness({
    initialCheckpoint: {
      summary: '之前已经修改文件', retainedTail: [compactionTestUser('继续同一长任务')],
      coveredRawLength: 0, tokensBefore: 7000, timestamp: 1,
      details: { readFiles: ['/etc/service.conf'], modifiedFiles: ['/etc/app.conf'] },
    },
  })
  await harness.controller.transformContext(compactionTestToolHistory())
  harness.controller.beforeProviderRequest()
  assert.deepEqual(harness.commits[0]!.checkpoint.details, {
    readFiles: ['/etc/service.conf'], modifiedFiles: ['/etc/app.conf'],
  })
})

test('压后超过窗口 30% 仍可继续，不执行目标比例压缩', async () => {
  const harness = createCompactionTestHarness({
    streamFn: compactionTestStream(compactionTestAssistant('summary '.repeat(600), 100)),
  })
  await harness.controller.transformContext(compactionTestHistory())
  harness.controller.beforeProviderRequest()
  assert.ok(harness.commits[0]!.tokensAfter > compactionTestModel.contextWindow * 0.3)
  assert.ok(harness.commits[0]!.tokensAfter < 6400)
})

test('恰好达到阈值时触发压缩', async () => {
  const harness = createCompactionTestHarness()
  const raw = compactionTestHistory()
  raw.pop()
  raw[5] = compactionTestAssistant('recent-assistant ' + 'f'.repeat(4000), 6400)
  await harness.controller.transformContext(raw)
  assert.equal(harness.commits.length, 1)
})
