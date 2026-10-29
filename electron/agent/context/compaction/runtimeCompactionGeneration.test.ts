import assert from 'node:assert/strict'
import test from 'node:test'
import { runtimeSummaryOutputBudget } from './runtimeCompactionGeneration.ts'

test('摘要使用有效输出上限，保留高推理模型的输出空间', () => {
  assert.equal(runtimeSummaryOutputBudget({ maxTokens: 32768, contextWindow: 262144 }, '任务摘要'), 32768)
  assert.equal(runtimeSummaryOutputBudget({ maxTokens: 2048, contextWindow: 32768 }, '任务摘要'), 2048)
})

test('摘要输出受实际剩余上下文约束，输入放不下时明确失败', () => {
  const model = { maxTokens: 32768, contextWindow: 8192 }
  const budget = runtimeSummaryOutputBudget(model, '约束与执行记录'.repeat(100))
  assert.ok(budget > 0 && budget < 8192)
  assert.throws(() => runtimeSummaryOutputBudget(model, '约束与执行记录'.repeat(10000)), /COMPRESSION_UNAVAILABLE/u)
})
