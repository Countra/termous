import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { RuntimeEventInput } from '../contracts/runtimeEvents.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { withToolDiscovery } from '../test-support/runtimeDiscoveryTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { mapMCPTools } from '../tools/mcpClientAdapter.ts'
import { createPiAgent } from './piAgentAdapter.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { runtimeToolResponse } from '../test-support/runtimeToolResponseFixture.ts'

for (const api of ['chat_completions', 'responses'] as const) test(`${api} 真实 SDK 跨三个循环保持工具身份和 Steer，持久事件只携带图片引用`, async () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.model.snapshot.api_mode = api
  bootstrap.messages = [runtimeUserMessage([], { text: '按顺序观察二十五轮' })]
  bootstrap.model.snapshot.supports_images = true
  bootstrap.model.snapshot.context_window_tokens = 262144
  bootstrap.context.request_usage_supported = true
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const hash = createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex')
  const events: RuntimeEventInput[] = []
  const calls: number[] = []
  let requests = 0, imageReads = 0, leases = 0, steerSeen = false
  const mapped = mapMCPTools([{ name: 'termous.hosts.list', inputSchema: { type: 'object', properties: { round: { type: 'integer' } }, required: ['round'] } }], async (_tool, args) => {
    calls.push(Number(args.round))
    if (calls.length === 10) agent.steer('分段之后仍须遵循此指令', { message_id: 'agm_steer', part_id: 'agp_steer' })
    const ref = { resource_id: `agres_${args.round}`, kind: 'image', mime_type: 'image/png', sha256: hash, size_bytes: Buffer.from(png, 'base64').length, image: { width: 1, height: 1 } }
    return { content: [{ type: 'text', text: `observation ${args.round}` }, { type: 'resource_link', uri: `termous-resource://${ref.resource_id}`, name: ref.resource_id, mimeType: ref.mime_type, _meta: { 'termous/resource': ref } }] }
  })
  const writer = new RuntimeEventWriter({
    start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
    runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1, onFailure: error => { throw error },
    core: {
      bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence },
      appendSteer: async () => { throw new Error('Steer 已持久化') }, commitCheckpoint: async () => { throw new Error('短上下文不应压缩') },
    },
  })
  const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
    mcp: { tools: mapped.tools, originalName: name => mapped.originalNames.get(name) ?? null, close: async () => {} },
    commitCheckpoint: async () => { throw new Error('短上下文不应压缩') },
    readResourceImage: async ref => { assert.equal(ref.sha256, hash); imageReads++; return png },
    reserveImageBytes: async () => { leases++; return () => { leases-- } },
    fetch: withToolDiscovery(async (_input, init) => {
      requests++
      assert.ok(requests <= 26)
      const body = String(init?.body)
      if (calls.length) assert.ok(body.includes(png), '模型请求仍须收到原始图片')
      if (calls.length >= 10 && body.includes('分段之后仍须遵循此指令')) steerSeen = true
      if (api === 'responses') {
        const input = (JSON.parse(body) as { input: Array<{ type?: string; output?: unknown }> }).input
        assert.ok(input.filter(item => item.type === 'function_call_output').every(item => typeof item.output === 'string'))
        return runtimeToolResponse(api, requests <= 25 ? mapped.tools[0]!.name : undefined, { round: requests }, String(requests))
      }
      const delta = requests <= 25 ? { tool_calls: [{ index: 0, id: `call_${requests}`, type: 'function', function: { name: mapped.tools[0]!.name, arguments: JSON.stringify({ round: requests }) } }] } : { content: '全部完成' }
      const chunk = { id: `response_${requests}`, object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: requests <= 25 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010 } }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }, ['termous.hosts.list']),
  })
  try {
    assert.equal(await agent.continue(), 'completed')
    await writer.flush()
    assert.deepEqual(calls, Array.from({ length: 25 }, (_, index) => index + 1))
    assert.ok(steerSeen)
    assert.ok(imageReads >= 25)
    assert.equal(leases, 0)
    assert.ok(events.some(event => event.kind === 'steer_applied'))
    const encoded = JSON.stringify(events)
    assert.ok(encoded.includes('image_ref'))
    assert.ok(!encoded.includes(png))
    assert.equal(events.filter(event => event.kind === 'tool_completed' && (event.payload.tool as { tool_name?: string } | undefined)?.tool_name === 'termous.hosts.list').length, 25)
  } finally { agent.close(); await writer.close() }
})
