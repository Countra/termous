import assert from 'node:assert/strict'
import test from 'node:test'
import type { Usage } from '@earendil-works/pi-ai'
import {
  addRuntimeUsage,
  emptyRuntimeUsage,
  projectPiUsage,
  sumPiUsage,
} from './runtimeUsage.ts'

test('pi usage 保留输入与缓存明细并保持 reasoning 属于输出', () => {
  assert.deepEqual(projectPiUsage(usage({
    input: 10,
    output: 8,
    cacheRead: 4,
    cacheWrite: 2,
    reasoning: 3,
    totalTokens: 24,
  })), {
    input_tokens: 10,
    cache_read_tokens: 4,
    cache_write_tokens: 2,
    output_tokens: 8,
    reasoning_tokens: 3,
    total_tokens: 24,
    estimated: false,
  })
})

test('异常和溢出 Token 被限制在 JavaScript 安全整数内并标记为部分统计', () => {
  const projected = projectPiUsage(usage({
    input: Number.MAX_SAFE_INTEGER,
    output: 20,
    cacheRead: 10,
    reasoning: 20,
    totalTokens: Number.MAX_SAFE_INTEGER,
  }))

  assert.equal(projected.input_tokens, Number.MAX_SAFE_INTEGER)
  assert.equal(projected.cache_read_tokens, 0)
  assert.equal(projected.cache_write_tokens, 0)
  assert.equal(projected.output_tokens, 0)
  assert.equal(projected.reasoning_tokens, 0)
  assert.equal(projected.total_tokens, Number.MAX_SAFE_INTEGER)
  assert.equal(projected.estimated, true)
  assert.equal(Number.isSafeInteger(projected.input_tokens + projected.output_tokens), true)
})

test('Provider 总量与分类和不一致时保留较大总量并标记为估算', () => {
  assert.deepEqual(projectPiUsage(usage({
    input: 10,
    output: 5,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 20,
  })), {
    input_tokens: 10,
    cache_read_tokens: 2,
    cache_write_tokens: 1,
    output_tokens: 5,
    reasoning_tokens: 0,
    total_tokens: 20,
    estimated: true,
  })
})

test('Provider 总量小于分类和时使用分类下限并降级为估算', () => {
  assert.deepEqual(projectPiUsage(usage({
    input: 10,
    output: 5,
    cacheRead: 2,
    cacheWrite: 1,
    totalTokens: 17,
  })), {
    input_tokens: 10,
    cache_read_tokens: 2,
    cache_write_tokens: 1,
    output_tokens: 5,
    reasoning_tokens: 0,
    total_tokens: 18,
    estimated: true,
  })
})

test('跨模型调用累计在饱和后保持单调且满足 Runtime usage 不变量', () => {
  const current = {
    input_tokens: Number.MAX_SAFE_INTEGER - 5,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 2,
    reasoning_tokens: 1,
    total_tokens: Number.MAX_SAFE_INTEGER - 1,
    estimated: false,
  }
  const total = addRuntimeUsage(current, {
    input_tokens: 10,
    cache_read_tokens: 2,
    cache_write_tokens: 3,
    output_tokens: 8,
    reasoning_tokens: 4,
    total_tokens: 18,
    estimated: false,
  })

  assert.deepEqual(total, {
    input_tokens: Number.MAX_SAFE_INTEGER - 2,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 2,
    reasoning_tokens: 1,
    total_tokens: Number.MAX_SAFE_INTEGER,
    estimated: true,
  })
  assert.equal(total.reasoning_tokens <= total.output_tokens, true)
  assert.equal(total.total_tokens >= total.input_tokens + total.output_tokens, true)
})

test('多次 pi usage 使用同一累计规则', () => {
  const total = sumPiUsage([
    usage({ input: 10, output: 4, reasoning: 1, totalTokens: 14 }),
    usage({ input: 8, output: 3, reasoning: 2, totalTokens: 11 }),
  ])

  assert.deepEqual(total, {
    input_tokens: 18,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 7,
    reasoning_tokens: 3,
    total_tokens: 25,
    estimated: false,
  })
  assert.deepEqual(emptyRuntimeUsage(), {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    estimated: false,
  })
})

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  }
}
