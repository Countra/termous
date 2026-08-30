import type { Usage } from '@earendil-works/pi-ai'

export interface RuntimeUsage {
  input_tokens: number
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
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    estimated: false,
  }
}

export function projectPiUsage(usage: Usage): RuntimeUsage {
  const inputParts = [usage.input, usage.cacheRead, usage.cacheWrite].map(safeTokenCount)
  const projectedOutput = safeTokenCount(usage.output)
  const projectedReasoning = safeTokenCount(usage.reasoning ?? 0)
  const projectedTotal = safeTokenCount(usage.totalTokens)
  const inputSum = saturatingSum(inputParts.map(({ value }) => value))
  const inputTokens = inputSum.value
  const outputTokens = Math.min(projectedOutput.value, Number.MAX_SAFE_INTEGER - inputTokens)
  const reasoningTokens = Math.min(projectedReasoning.value, outputTokens)
  const minimumTotal = inputTokens + outputTokens
  const totalTokens = Math.max(projectedTotal.value, minimumTotal)
  const adjusted = inputParts.some(({ adjusted }) => adjusted)
    || inputSum.adjusted
    || projectedOutput.adjusted
    || projectedReasoning.adjusted
    || projectedTotal.adjusted
    || outputTokens !== projectedOutput.value
    || reasoningTokens !== projectedReasoning.value
    || projectedTotal.value < minimumTotal

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    estimated: adjusted || totalTokens === 0,
  }
}

export function addRuntimeUsage(current: RuntimeUsage, increment: RuntimeUsage): RuntimeUsage {
  const combinedAvailable = Number.MAX_SAFE_INTEGER - current.input_tokens - current.output_tokens
  const addedInput = Math.min(increment.input_tokens, combinedAvailable)
  const outputAvailable = combinedAvailable - addedInput
  const addedOutput = Math.min(increment.output_tokens, outputAvailable)
  const addedReasoning = Math.min(increment.reasoning_tokens, addedOutput)
  const inputTokens = current.input_tokens + addedInput
  const outputTokens = current.output_tokens + addedOutput
  const reasoningTokens = current.reasoning_tokens + addedReasoning
  const totalAvailable = Number.MAX_SAFE_INTEGER - current.total_tokens
  const addedTotal = Math.min(increment.total_tokens, totalAvailable)
  const totalTokens = Math.max(current.total_tokens + addedTotal, inputTokens + outputTokens)
  const adjusted = addedInput !== increment.input_tokens
    || addedOutput !== increment.output_tokens
    || addedReasoning !== increment.reasoning_tokens
    || addedTotal !== increment.total_tokens

  return {
    input_tokens: inputTokens,
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

function saturatingSum(values: number[]): SafeTokenCount {
  let value = 0
  for (const increment of values) {
    if (increment > Number.MAX_SAFE_INTEGER - value) {
      return { value: Number.MAX_SAFE_INTEGER, adjusted: true }
    }
    value += increment
  }
  return { value, adjusted: false }
}
