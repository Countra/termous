import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compactionTestAssistant,
  compactionTestHistory,
  compactionTestModel,
  compactionTestStream,
  compactionTestToolHistory,
  compactionTestUser,
  createCompactionTestHarness,
} from './runtimeCompactionTestFixture.ts'

test('持久化确认前不裁剪内存，提交失败后禁止主 Provider 请求', async () => {
  let enteredCommit!: () => void
  const commitStarted = new Promise<void>((resolve) => { enteredCommit = resolve })
  let rejectCommit!: (reason: unknown) => void
  const commitPending = new Promise<void>((_resolve, reject) => { rejectCommit = reject })
  const harness = createCompactionTestHarness({
    commit: async () => {
      enteredCommit()
      await commitPending
    },
  })
  const raw = compactionTestHistory()
  const pending = harness.controller.transformContext(raw)
  await commitStarted
  assert.equal(harness.controller.checkpoint(), undefined)
  rejectCommit(new Error('checkpoint write rejected'))
  assert.deepEqual(await pending, raw)
  assert.equal(harness.controller.checkpoint(), undefined)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_CHECKPOINT_FAILED/u)
  assert.deepEqual(harness.activities.map(({ status }) => status), ['started', 'failed'])
  assert.equal(harness.usages.length, 1)
})

test('持久化成功后取消仍保留已提交摘要，不重复写失败活动', async () => {
  const abort = new AbortController()
  const harness = createCompactionTestHarness({ commit: async () => { abort.abort() } })
  const projected = await harness.controller.transformContext(compactionTestHistory(), abort.signal)
  assert.ok(harness.controller.checkpoint())
  assert.match(JSON.stringify(projected[0]), /compacted/u)
  assert.deepEqual(harness.activities.map(({ status }) => status), ['started', 'completed'])
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_ABORTED/u)
})

for (const stopReason of ['length', 'error', 'aborted'] as const) {
  test(`摘要 ${stopReason} 不得提交，已经消耗的 usage 仍回传`, async () => {
    const harness = createCompactionTestHarness({
      streamFn: compactionTestStream({ ...compactionTestAssistant('未完成文本', 123), stopReason }),
    })
    const raw = compactionTestHistory()
    assert.deepEqual(await harness.controller.transformContext(raw), raw)
    assert.equal(harness.commits.length, 0)
    assert.equal(harness.usages[0]!.input_tokens, 123)
    assert.ok(harness.controller.failure())
    assert.throws(() => harness.controller.beforeProviderRequest())
    assert.equal(harness.activities[1]!.status, stopReason === 'aborted' ? 'cancelled' : 'failed')
  })
}

for (const summary of ['', '  \n ', '非法\0摘要', '\uD800', 'x'.repeat(256 * 1024 + 1)]) {
  test(`摘要为空或超过上限时保留上下文（长度 ${summary.length}）`, async () => {
    const harness = createCompactionTestHarness({
      streamFn: compactionTestStream(compactionTestAssistant(summary, 100)),
    })
    const raw = compactionTestHistory()
    assert.deepEqual(await harness.controller.transformContext(raw), raw)
    assert.equal(harness.commits.length, 0)
    assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_INVALID/u)
  })
}

test('摘要返回工具调用时拒绝执行和持久化', async () => {
  const harness = createCompactionTestHarness({
    streamFn: compactionTestStream({
      ...compactionTestAssistant('尝试调用工具', 100),
      content: [{ type: 'toolCall', id: 'unexpected', name: 'remote_exec', arguments: {} }],
    }),
  })
  await harness.controller.transformContext(compactionTestHistory())
  assert.equal(harness.commits.length, 0)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_INVALID/u)
})

test('split 第二个摘要失败仍计入两次 usage，不覆盖旧摘要', async () => {
  let requests = 0
  const checkpoint = {
    summary: '必须保留的旧任务约束',
    retainedTail: [compactionTestUser('当前长任务')],
    coveredRawLength: 0, tokensBefore: 7000, timestamp: 1,
  }
  const harness = createCompactionTestHarness({
    initialCheckpoint: checkpoint,
    streamFn: compactionTestStream(async () => ({
      ...compactionTestAssistant('summary', ++requests * 100),
      stopReason: requests === 1 ? 'stop' : 'error',
    })),
  })
  await harness.controller.transformContext(compactionTestToolHistory())
  assert.equal(requests, 2)
  assert.equal(harness.usages.reduce((sum, usage) => sum + usage.input_tokens, 0), 300)
  assert.deepEqual(harness.controller.checkpoint(), checkpoint)
  assert.equal(harness.commits.length, 0)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_FAILED/u)
})

test('进入门禁前已取消，不启动摘要或触发 Provider', async () => {
  const abort = new AbortController()
  abort.abort()
  const harness = createCompactionTestHarness()
  await harness.controller.transformContext(compactionTestHistory(), abort.signal)
  assert.equal(harness.requests.length, 0)
  assert.equal(harness.activities.length, 0)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_ABORTED/u)
})

test('摘要请求抛出异常时分类并脱敏，错误活动回写失败不覆盖原始原因', async () => {
  const secret = 'summary-test-key'
  const harness = createCompactionTestHarness({
    providerErrorSecrets: [secret],
    streamFn: () => { throw new Error(`Request timed out ${secret}`) },
    onActivity: (activity) => {
      if (activity.status === 'failed') throw new Error('event write rejected')
    },
  })
  const raw = compactionTestHistory()
  assert.deepEqual(await harness.controller.transformContext(raw), raw)
  assert.equal(harness.controller.failure()?.code, 'AGENT_RUNTIME_CONTEXT_COMPRESSION_TIMEOUT')
  assert.match(harness.controller.failure()?.detail ?? '', /Request timed out/u)
  assert.equal(harness.controller.failure()?.detail?.includes(secret), false)
  assert.equal(harness.commits.length, 0)
})

test('摘要请求共享 Agent signal，中途取消不提交', async () => {
  const abort = new AbortController()
  const harness = createCompactionTestHarness({
    streamFn: compactionTestStream(async (_context, options) => {
      assert.equal(options!.signal, abort.signal)
      abort.abort()
      return compactionTestAssistant('取消前文本', 55)
    }),
  })
  const raw = compactionTestHistory()
  assert.deepEqual(await harness.controller.transformContext(raw, abort.signal), raw)
  assert.equal(harness.commits.length, 0)
  assert.equal(harness.usages[0]!.input_tokens, 55)
  assert.equal(harness.activities[1]!.status, 'cancelled')
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_ABORTED/u)
})

test('巨大单条消息没有合法可摘要前缀时停止，不启动无效摘要', async () => {
  const harness = createCompactionTestHarness()
  const raw = [compactionTestUser('x'.repeat(40000))]
  assert.deepEqual(await harness.controller.transformContext(raw), raw)
  assert.equal(harness.requests.length, 0)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_UNAVAILABLE/u)
})

test('固定系统和输出预算占满窗口时明确停止', async () => {
  const harness = createCompactionTestHarness({ systemPrompt: 'x'.repeat(30000) })
  const raw = compactionTestHistory()
  assert.deepEqual(await harness.controller.transformContext(raw), raw)
  assert.equal(harness.requests.length, 0)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_UNAVAILABLE/u)
})

test('摘要变大或压缩后仍超预算时不反复尝试', async () => {
  const harness = createCompactionTestHarness({
    streamFn: compactionTestStream(compactionTestAssistant('x'.repeat(24000), 100)),
  })
  const raw = compactionTestHistory()
  assert.deepEqual(await harness.controller.transformContext(raw), raw)
  await harness.controller.transformContext(raw)
  assert.equal(harness.usages.length, 1)
  assert.equal(harness.commits.length, 0)
  assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_INSUFFICIENT/u)
})

test('快照或事件写入失败仍遵守 transformContext 不拒绝的合同', async () => {
  for (const overrides of [
    { captureSource: async () => { throw new Error('source failed') } },
    { onActivity: async () => { throw new Error('event failed') } },
    { onContextUsage: async () => { throw new Error('usage failed') } },
  ]) {
    const harness = createCompactionTestHarness(overrides)
    const raw = compactionTestHistory()
    assert.deepEqual(await harness.controller.transformContext(raw), raw)
    assert.throws(() => harness.controller.beforeProviderRequest(), /COMPRESSION_FAILED/u)
    assert.equal(harness.commits.length, 0)
  }
})

test('主适配选择的最低受支持推理档位透传给所有摘要请求', async () => {
  const harness = createCompactionTestHarness({
    model: { ...compactionTestModel, reasoning: true },
    thinkingLevel: 'high',
    initialCheckpoint: {
      summary: '上一段工作摘要', retainedTail: [compactionTestUser('当前长任务')],
      coveredRawLength: 0, tokensBefore: 7000, timestamp: 1,
    },
  })
  await harness.controller.transformContext(compactionTestToolHistory())
  harness.controller.beforeProviderRequest()
  assert.equal(harness.requests.length, 2)
  assert.ok(harness.requests.every((request) => request.options!.reasoning === 'high'))
})
