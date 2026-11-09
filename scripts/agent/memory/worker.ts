import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { AgentWorkerRuntime } from '../../../electron/agent/worker/workerRuntime.ts'
import { createPiAgent } from '../../../electron/agent/runtime/piAgentAdapter.ts'
import { mapMCPTools } from '../../../electron/agent/tools/mcpClientAdapter.ts'
import { withToolDiscovery } from '../../../electron/agent/test-support/runtimeDiscoveryTestFixture.ts'
import type { AgentWorkerStartMessage } from '../../../electron/agent/contracts/protocol.ts'

// 仅验收入口替换模型和工具，队列、图片读取、SDK、检查点和 Core 持久化均使用生产实现。
const parent = process.parentPort!
const rounds = Number(process.env.TERMOUS_MEMORY_ROUNDS ?? 500)
const interval = Number(process.env.TERMOUS_MEMORY_INTERVAL ?? 0)
const instance = Number(process.env.TERMOUS_MEMORY_INSTANCE ?? 0)
let start: AgentWorkerStartMessage
let count = 0
let modelCalls = 0
let imageRequests = 0
let compactions = 0
let exitAcknowledged = false
let finished = false
function finishExit() { if (finished && exitAcknowledged) setImmediate(() => process.exit(0)) }
const mapped = mapMCPTools([{ name: 'termous.screen_analyses.images.get', description: 'Local memory acceptance image fixture.',
  inputSchema: { type: 'object', properties: { round: { type: 'integer' } }, required: ['round'] } }], async (_tool, args, signal, call) => {
  assert.equal(args.round, count + 1, '工具调用不得重放或跳过')
  count++
  const text = { type: 'text' as const, text: `Observation ${count}: ${'local text output '.repeat(1024)}` }
  if (count % 2) return { content: [text] }
  const response = await fetch(`http://127.0.0.1:18123/image/${start.run_id}/${start.generation}/${call}/${instance * 100000 + count}`, {
    method: 'POST', headers: { 'X-Termous-Token': 'memory-acceptance-local' }, signal,
  })
  assert.ok(response.ok, await response.clone().text())
  const ref = await response.json()
  return { content: [text, { type: 'resource_link', uri: `termous-resource://${ref.resource_id}`, name: ref.resource_id,
    mimeType: ref.mime_type, _meta: { 'termous/resource': ref } }] }
})
const telemetry = setInterval(() => parent.postMessage({ type: 'memory_sample', pid: process.pid, count, modelCalls, imageRequests, compactions, ...process.memoryUsage() }), 5000)
const runtime = new AgentWorkerRuntime({
  send: message => parent.postMessage(message),
  finish: () => { clearInterval(telemetry); finished = true; finishExit() },
  connectMCP: async () => ({ tools: mapped.tools, originalName: name => mapped.originalNames.get(name) ?? null, close: async () => {} }),
  createAgent: options => createPiAgent({ ...options, fetch: withToolDiscovery(async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    const summary = !body.tools?.length
    if (summary) compactions++
    else {
      modelCalls++
      if (containsImage(body.messages)) imageRequests++
      await delay(interval, undefined, { signal: init?.signal ?? undefined })
    }
    const final = count >= rounds || summary
    const delta = final ? { content: summary ? '## Goal\nContinue the local memory acceptance. Preserve tool order and image references.\n## Next Steps\nFollow the current request.' : `Completed ${count} observations.` }
      : { tool_calls: [{ index: 0, id: `memory_${instance}_${count + 1}`, type: 'function', function: { name: mapped.tools[0]!.name, arguments: JSON.stringify({ round: count + 1 }) } }] }
    // 图片按视觉输入计量；Base64 是传输编码，不能按普通文字估算上下文用量。
    const promptTokens = summary ? 1000 : Math.min(240000, estimatePromptTokens(body.messages))
    const chunk = { id: `memory_response_${instance}_${modelCalls}_${compactions}`, object: 'chat.completion.chunk', created: 1, model: body.model,
      choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: final ? 'stop' : 'tool_calls' }],
      usage: { prompt_tokens: promptTokens, completion_tokens: 64, total_tokens: promptTokens + 64 } }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }, ['termous.screen_analyses.images.get']) }),
})
function receive(event: Electron.MessageEvent) {
  if (event.data?.type === 'finish_ack') { exitAcknowledged = true; finishExit(); return }
  if (event.data?.type === 'start') start = event.data
  runtime.handleMessage(event.data)
}
parent.on('message', receive)

function estimatePromptTokens(messages: unknown): number {
  if (!messages || typeof messages !== 'object') return typeof messages === 'string' ? Math.ceil(Buffer.byteLength(messages) / 4) : 0
  if ('type' in messages && messages.type === 'image_url') return 1105
  return Object.values(messages).reduce<number>((sum, value) => sum + estimatePromptTokens(value), 0)
}

function containsImage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return 'type' in value && value.type === 'image_url' || Object.values(value).some(containsImage)
}
