import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { createRuntimeCompactionModels } from './runtimeCompactionSummary.ts'
import { runtimeContextFailureMessage } from './runtimeContextGate.ts'
import { compactionTestAssistant, compactionTestModel, compactionTestStream } from './runtimeCompactionTestFixture.ts'
import type { RuntimeRetryActivity } from './runtimeProviderRetry.ts'
import type { RuntimeUsage } from './runtimeUsage.ts'

test('摘要重试分别累计失败和完成用量，最终原生 usage 只属于成功请求', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0
  const activities: RuntimeRetryActivity[] = []
  const usages: RuntimeUsage[] = []
  const completed = compactionTestAssistant('## Goal\n保留任务。', 29)
  const summary = createRuntimeCompactionModels(compactionTestStream(async (context, options) => {
    assert.equal(options?.signal, abort.signal)
    assert.equal(context.tools?.length, 0)
    return requests++ === 0
      ? { ...compactionTestAssistant('', 11), stopReason: 'error', errorMessage: '503 summary upstream unavailable' }
      : completed
  }), (usage) => { usages.push(usage) }, undefined, [], (activity) => { activities.push(activity) })
  const abort = new AbortController()
  const task = summary.models.completeSimple(compactionTestModel, { messages: [] }, { signal: abort.signal })
  await setImmediate()
  assert.equal(activities[0]?.delay_ms, 3000)
  t.mock.timers.tick(3000)
  const result = await task

  assert.equal(requests, 2)
  assert.equal(result, completed)
  assert.equal(result.usage.totalTokens, 29)
  assert.equal(summary.usage().total_tokens, 40)
  assert.deepEqual(usages.map(({ total_tokens }) => total_tokens), [11, 29])
  assert.deepEqual(activities.map(({ status, attempt }) => [status, attempt]), [
    ['waiting', 0], ['requesting', 1], ['completed', 1],
  ])
})

test('摘要退避取消保留耗用且不重复统计，不再请求 Provider', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0
  const activities: RuntimeRetryActivity[] = []
  const usages: RuntimeUsage[] = []
  const abort = new AbortController()
  const summary = createRuntimeCompactionModels(compactionTestStream(async () => {
    requests += 1
    return { ...compactionTestAssistant('', 17), stopReason: 'error', errorMessage: '503 summary unavailable' }
  }), (usage) => { usages.push(usage) }, undefined, [], (activity) => { activities.push(activity) })
  const task = summary.models.completeSimple(compactionTestModel, { messages: [] }, { signal: abort.signal })
  const rejected = assert.rejects(task, /AGENT_RUNTIME_CONTEXT_COMPRESSION_ABORTED/u)
  await setImmediate()
  abort.abort()
  await rejected
  assert.equal(requests, 1)
  assert.equal(summary.usage().total_tokens, 17)
  assert.deepEqual(usages.map(({ total_tokens }) => total_tokens), [17])
  assert.equal(activities[activities.length - 1]?.status, 'cancelled')
  assert.equal(activities[activities.length - 1]?.attempt, 0)
})

test('摘要有正文后断流重试至上限，错误原文脱敏且所有尝试耗用被计入', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let requests = 0
  const activities: RuntimeRetryActivity[] = []
  const summary = createRuntimeCompactionModels(compactionTestStream(async () => {
    requests += 1
    return { ...compactionTestAssistant('部分摘要', 31), stopReason: 'error', errorMessage: '503 original-summary-error private-summary-key' }
  }), undefined, undefined, ['private-summary-key'], (activity) => { activities.push(activity) })
  const rejected = assert.rejects(summary.models.completeSimple(compactionTestModel, { messages: [] }), (error: unknown) => {
    assert.ok(error instanceof Error && 'detail' in error)
    assert.match(String(error.detail), /503 original-summary-error/u)
    assert.doesNotMatch(String(error.detail), /private-summary-key/u)
    return true
  })
  for (const delay of [3000, 6000, 12000]) {
    await setImmediate()
    t.mock.timers.tick(delay)
  }
  await rejected
  assert.equal(requests, 4)
  assert.equal(summary.usage().total_tokens, 124)
  assert.equal(activities[activities.length - 1]?.status, 'failed')
})

test('摘要 length 与无效成功响应仍由原有校验拒绝，不启动重试', async () => {
  for (const message of [
    { ...compactionTestAssistant('部分摘要', 5), stopReason: 'length' as const },
    compactionTestAssistant('', 5),
  ]) {
    let requests = 0
    const summary = createRuntimeCompactionModels(compactionTestStream(async () => {
      requests += 1
      return message
    }))
    await assert.rejects(summary.models.completeSimple(compactionTestModel, { messages: [] }), /COMPRESSION_(TRUNCATED|INVALID)/u)
    assert.equal(requests, 1)
    assert.equal(summary.usage().total_tokens, 5)
  }
})

test('摘要最终失败与最后重试原文相同，不拼接 stop reason、前缀或后缀', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const rawError = '503 original summary error\n\tupstream timeout summary-private-key'
  const activities: RuntimeRetryActivity[] = []
  let requests = 0
  const summary = createRuntimeCompactionModels(compactionTestStream(async () => ({
    ...compactionTestAssistant(requests++ === 0 ? '' : '部分摘要', 13),
    stopReason: 'error', errorMessage: rawError, rawStopReason: 'server_error',
  })), undefined, undefined, ['summary-private-key'], (activity) => { activities.push(activity) })
  const task = summary.models.completeSimple(compactionTestModel, { messages: [] })
  const rejected = assert.rejects(task, (error: unknown) => {
    assert.ok(error instanceof Error && 'detail' in error && 'code' in error)
    const expected = '503 original summary error\n\tupstream timeout [已隐藏]'
    assert.equal(error.detail, expected)
    assert.equal(runtimeContextFailureMessage(String(error.code), String(error.detail)), expected)
    assert.equal(activities[activities.length - 1]?.error_message, expected)
    return true
  })
  for (const delay of [3000, 6000, 12000]) {
    await setImmediate()
    t.mock.timers.tick(delay)
  }
  await rejected
  assert.equal(requests, 4)
})
