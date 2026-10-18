import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { agentRuntimeProtocolVersion } from '../../common/contracts/agent-runtime.ts'
import { WorkerCoreClient } from '../../electron/agent/worker/workerCoreClient.ts'
import { AgentWorkerRuntime } from '../../electron/agent/worker/workerRuntime.ts'
import { createPiAgent } from '../../electron/agent/runtime/piAgentAdapter.ts'
import { testAgentSkillBundle } from '../../electron/agent/test-support/skillBundleTestFixture.ts'
import { isTerminalCompletionBootstrap } from '../../electron/terminalCompletion/protocol.ts'

// 由后端测试通过标准输入提供真实 HTTP 投影；所有网络边界使用本地合成响应。
const responses = JSON.parse(readFileSync(0, 'utf8'))
assert.equal(responses.length, 4)
for (const response of responses) {
  const events = []
  const outbound = []
  let modelRequests = 0
  let closed = false
  const core = new WorkerCoreClient({ fetch: async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v1/agent/runtime/bootstrap') return Response.json(response)
    const body = JSON.parse(String(init?.body))
    if (path.endsWith('/runtime-events')) {
      events.push(...body.events)
      return Response.json({ last_sequence: body.events.at(-1).sequence })
    }
    if (path.endsWith('/runtime-audit-events')) return Response.json({ accepted: body.events.length })
    assert.fail(`夹具禁止其他 Core 请求: ${path}`)
  } })
  const finished = Promise.withResolvers()
  const runtime = new AgentWorkerRuntime({
    core, send: (message) => outbound.push(message), finish: finished.resolve,
    connectMCP: async () => ({ tools: [], originalName: () => null, close: async () => { closed = true } }),
    createAgent: (options) => createPiAgent({ ...options, fetch: async () => {
      modelRequests++
      const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: '启动验证完成' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    } }),
  })
  const start = { type: 'start', protocol_version: agentRuntimeProtocolVersion,
    core_base_url: 'http://127.0.0.1:52000', ticket: 't'.repeat(48),
    run_id: response.run.id, generation: response.run.generation, skills: testAgentSkillBundle() }
  runtime.handleMessage(start)
  await finished.promise
  assert.deepEqual(outbound.map((message) => message.type), ['started', 'settled'], 'Core 响应必须能够启动实际 Worker')
  assert.equal(outbound.at(-1).outcome, 'completed')
  assert.equal(modelRequests, 1)
  assert.equal(closed, true)
  assert.deepEqual(events.filter((event) => event.kind === 'status').map((event) => event.payload.status.status), ['running', 'completed'])
  assert.ok(events.some((event) => event.kind === 'request_usage'))
  // 修复投影不能放宽客户端边界：显式零限额仍必须拒绝。
  const invalid = structuredClone(response)
  invalid.model.snapshot.execution_budget.limits.model_requests = 0
  const rejecting = new WorkerCoreClient({ fetch: async () => Response.json(invalid) })
  await assert.rejects(rejecting.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/u)
  assert.equal(isTerminalCompletionBootstrap({ request_id: 'fixture', model: response.model,
    environment: { os: 'linux', shell: 'bash', cwd: '/fixture' } }, 'fixture'), true)
}
