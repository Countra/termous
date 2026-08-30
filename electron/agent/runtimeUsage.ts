import type { Usage } from '@earendil-works/pi-ai'

export interface RuntimeUsage {
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_tokens: number
  estimated: boolean
}

interface SafeTokenCount {
  value: number
  adjusted: boolean
}

export function emptyRuntimeUsage(): RuntimeUsage {
  return {
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    estimated: false,
  }
}

export function projectPiUsage(usage: Usage): RuntimeUsage {
  const projectedInput = safeTokenCount(usage.input)
  const projectedCacheRead = safeTokenCount(usage.cacheRead)
  const projectedCacheWrite = safeTokenCount(usage.cacheWrite)
  const projectedOutput = safeTokenCount(usage.output)
  const projectedReasoning = safeTokenCount(usage.reasoning ?? 0)
  const projectedTotal = safeTokenCount(usage.totalTokens)
  const counts = fitTokenCounts([
    projectedInput.value,
    projectedCacheRead.value,
    projectedCacheWrite.value,
    projectedOutput.value,
  ])
  const [inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens] = counts.values
  const reasoningTokens = Math.min(projectedReasoning.value, outputTokens)
  const minimumTotal = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens
  const totalTokens = Math.max(projectedTotal.value, minimumTotal)
  const adjusted = projectedInput.adjusted
    || projectedCacheRead.adjusted
    || projectedCacheWrite.adjusted
    || counts.adjusted
    || projectedOutput.adjusted
    || projectedReasoning.adjusted
    || projectedTotal.adjusted
    || outputTokens !== projectedOutput.value
    || reasoningTokens !== projectedReasoning.value
    || totalTokens !== projectedTotal.value
    || projectedTotal.value !== minimumTotal

  return {
    input_tokens: inputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    estimated: adjusted || totalTokens === 0,
  }
}

export function addRuntimeUsage(current: RuntimeUsage, increment: RuntimeUsage): RuntimeUsage {
  const currentCount = current.input_tokens + current.cache_read_tokens
    + current.cache_write_tokens + current.output_tokens
  const counts = fitTokenCounts([
    increment.input_tokens,
    increment.cache_read_tokens,
    increment.cache_write_tokens,
    increment.output_tokens,
  ], Number.MAX_SAFE_INTEGER - currentCount)
  const [addedInput, addedCacheRead, addedCacheWrite, addedOutput] = counts.values
  const addedReasoning = Math.min(increment.reasoning_tokens, addedOutput)
  const inputTokens = current.input_tokens + addedInput
  const cacheReadTokens = current.cache_read_tokens + addedCacheRead
  const cacheWriteTokens = current.cache_write_tokens + addedCacheWrite
  const outputTokens = current.output_tokens + addedOutput
  const reasoningTokens = current.reasoning_tokens + addedReasoning
  const totalAvailable = Number.MAX_SAFE_INTEGER - current.total_tokens
  const addedTotal = Math.min(increment.total_tokens, totalAvailable)
  const totalTokens = current.total_tokens + addedTotal
  const adjusted = counts.adjusted
    || addedReasoning !== increment.reasoning_tokens
    || addedTotal !== increment.total_tokens

  return {
    input_tokens: inputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    estimated: current.estimated || increment.estimated || adjusted,
  }
}

export function sumPiUsage(usages: Usage[]): RuntimeUsage {
  return usages.reduce(
    (total, usage) => addRuntimeUsage(total, projectPiUsage(usage)),
    emptyRuntimeUsage(),
  )
}

export function hasRuntimeUsage(value: RuntimeUsage) {
  return value.input_tokens > 0
    || value.cache_read_tokens > 0
    || value.cache_write_tokens > 0
    || value.output_tokens > 0
    || value.reasoning_tokens > 0
    || value.total_tokens > 0
    || value.estimated
}

function safeTokenCount(value: number): SafeTokenCount {
  if (!Number.isFinite(value) || value < 0) {
    return { value: 0, adjusted: true }
  }
  const integer = Math.floor(value)
  return {
    value: Math.min(Number.MAX_SAFE_INTEGER, integer),
    adjusted: integer !== value || integer > Number.MAX_SAFE_INTEGER,
  }
}

function fitTokenCounts(values: number[], maximum = Number.MAX_SAFE_INTEGER) {
  let remaining = Math.max(0, maximum)
  let adjusted = false
  const fitted = values.map((value) => {
    const next = Math.min(value, remaining)
    remaining -= next
    adjusted ||= next !== value
    return next
  })
  return { values: fitted, adjusted }
}
