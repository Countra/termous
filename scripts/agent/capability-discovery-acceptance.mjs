import assert from 'node:assert/strict'
import { createPiAgent } from '../../electron/agent/runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../../electron/agent/runtime/runtimeEventWriter.ts'
import { discoveryCases, discoveryFixture, discoveryMessages } from './capability-discovery-fixture.mjs'

export function summarizeDiscovery(cases) {
  return [...new Set(cases.map((item) => item.variant))].map((variant) => {
    const samples = cases.filter((item) => item.variant === variant && typeof item.success === 'boolean')
    const sum = (measure) => samples.reduce((total, item) => total + measure(item), 0)
    const count = (predicate) => samples.filter(predicate).length
    return { variant, samples: samples.length,
      strict_single_action_successes: count((item) => item.evaluation !== 'open_goal' && item.success),
      open_goal_successes: count((item) => item.evaluation === 'open_goal' && item.success),
      first_business_tool_correct: count((item) => item.calls[0]?.input === true),
      eventual_correct_selection: count((item) => item.calls.some((call) => call.input === true)),
      unexpected_business_calls: sum((item) => item.calls.filter((call) => call.input !== true).length),
      fixed_delay_ms: sum((item) => item.calls.reduce((total, call) => total + (call.fixed_delay_ms ?? 0), 0)),
      repeated_business_calls: sum((item) => item.nonprogress_calls ?? 0),
      discovery_calls: sum((item) => item.discoveries.length),
      requests: sum((item) => item.requests.length), total_tokens: sum((item) => item.total_tokens ?? 0),
      duration_ms: sum((item) => item.duration_ms ?? 0),
    }
  })
}

export function projectDiscoveryRequest(body, variant) {
  if (variant === 'without_index') {
    const removeIndex = (value) => typeof value === 'string' ? value.replace(/\n\nAvailable capability index[\s\S]*$/, '') : value
    if (typeof body.instructions === 'string') body.instructions = removeIndex(body.instructions)
    for (const message of [...body.messages ?? [], ...Array.isArray(body.input) ? body.input : []]) {
      if (!['system', 'developer'].includes(message.role)) continue
      if (typeof message.content === 'string') message.content = removeIndex(message.content)
      else if (Array.isArray(message.content)) for (const part of message.content) if (typeof part.text === 'string') part.text = removeIndex(part.text)
    }
  }
  const indexVisible = JSON.stringify(body).includes('Available capability index')
  if (variant === 'without_index') assert.equal(indexVisible, false, '对照请求仍含全局索引')
  return { tools: (body.tools ?? []).map((tool) => tool.name ?? tool.function?.name), index_visible: indexVisible }
}

export async function runDiscoveryMatrix({ bootstrap, skills, start, variants, repetitions, report, save, heartbeat, concurrency = 4, timeout = 90000 }) {
  assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4)
  const tasks = discoveryCases.flatMap((scenario) => Array.from({ length: repetitions }, (_, index) => variants.map(([variant, create]) => ({ scenario, index: index + 1, variant, create })))).flat()
  const active = new Set()
  let stopping = false
  let position = 0
  let writing = Promise.resolve()
  const stop = () => { stopping = true; for (const controller of active) controller.abort() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const workers = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
      while (!stopping && position < tasks.length) {
        try { heartbeat.check() } catch (error) { stop(); throw error }
        const { scenario, index, variant, create = createPiAgent } = tasks[position++]
        const result = { variant, scenario: scenario.id, index, evaluation: scenario.evaluation, expected_tool: scenario.expected, accepted_tools: scenario.accepted, requests: [], usage_records: [], calls: [], discoveries: [], tool_failures: [], errors: [] }
        report.cases.push(result)
        const begun = Date.now()
        const fixture = discoveryFixture(scenario.id, (call) => result.calls.push({ ...call, request: result.requests.length }))
        let controller, timedOut = false
        const writer = new RuntimeEventWriter({ start, runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0,
          onFailure: () => controller?.abort(), core: { appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => {
            for (const event of batch) {
              if (event.kind === 'request_usage') result.usage_records.push(event.payload.request_usage)
              if (event.kind === 'error') result.errors.push(event.payload.error?.code)
            }
            return batch.at(-1).sequence
          } } })
        try {
          // 每个样本独立工作集；共享的 Core 领取仅提供既有配置和凭据，工具与事件均留在合成环境。
          controller = create({ bootstrap: { ...bootstrap, context: { estimated_tokens: 0, warning: false, request_usage_supported: true }, messages: discoveryMessages(scenario.id) },
            skills, mcp: fixture.mcp, events: writer,
            fetch: async (url, init) => {
              const body = JSON.parse(String(init.body))
              result.requests.push(projectDiscoveryRequest(body, variant))
              return fetch(url, { ...init, body: JSON.stringify(body) })
            },
            audit: { capture: (event) => {
              if (event.type !== 'message_end') return
              const message = event.message
              if (message.role === 'assistant') for (const part of message.content) if (part.type === 'toolCall' && part.name === 'discover_tools') result.discoveries.push(part.arguments)
              if (message.role === 'toolResult' && message.isError) result.tool_failures.push(message.toolName)
            } },
            commitCheckpoint: async () => { throw new Error('目录选择夹具不应触发上下文压缩') },
          })
          active.add(controller)
          const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout)
          try { result.status = await controller.continue(); await writer.flush() } finally { clearTimeout(timer) }
          result.success = !timedOut && result.status === 'completed' && fixture.success()
        } catch (error) { result.success = false; result.error = error.code ?? error.name }
        finally {
          controller?.abort()
          await controller?.waitForIdle()
          controller?.close()
          active.delete(controller)
          await writer.close()
        }
        result.timed_out = timedOut
        result.duration_ms = Date.now() - begun
        result.total_tokens = result.usage_records.reduce((sum, entry) => sum + entry.usage.total_tokens, 0)
        result.nonprogress_calls = result.calls.filter((call, i) => !call.input && result.calls.slice(0, i).some((old) => old.name === call.name && JSON.stringify(old.arguments) === JSON.stringify(call.arguments))).length
        writing = writing.then(save).catch((error) => { stop(); throw error })
        await writing
        console.log(JSON.stringify({ variant, scenario: scenario.id, index, success: result.success, requests: result.requests.length, ms: result.duration_ms, tokens: result.total_tokens }))
      }
    }))
    const failed = workers.find((worker) => worker.status === 'rejected')
    if (failed) throw failed.reason
  } finally {
    stop()
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    await writing
    report.interrupted = stopping && position < tasks.length
    report.expected_samples = tasks.length
    // 严格单次调用成绩保持原判定；额外指标只解释调用顺序，不代替真实业务成功率。
    report.selection_summary = summarizeDiscovery(report.cases)
  }
}
