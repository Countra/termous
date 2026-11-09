import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from '../../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../../runtime/runtimeEventWriter.ts'
import type { RuntimeEventInput } from '../../contracts/runtimeEvents.ts'
import type { PreparedCall } from '../../contracts/toolPreparation.ts'
import { isRecord } from '../../contracts/validation.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../../test-support/runtimeToolResponseFixture.ts'
import { mapMCPTools } from '../mcpClientAdapter.ts'

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 实际 Pi 工具轮使用简化参数，持久准备先于业务派发`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = api
    bootstrap.messages = [runtimeUserMessage([], { text: '保存一个名为 Example、正文为 pwd 的片段，不执行。' })]
    const events: RuntimeEventInput[] = []
    const calls: Record<string, unknown>[] = []
    const name = 'termous.snippets.create'
    const mapped = mapMCPTools([{ name, description: 'Save a command snippet.', annotations: { readOnlyHint: false },
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, client_request_id: { type: 'string' } }, required: ['name', 'command', 'client_request_id'], additionalProperties: false },
    }], async (_tool, args) => {
      const preparation = events.find((e) => e.kind === 'tool_prepared')
      assert.ok(preparation)
      assert.ok(events.some((e) => e.kind === 'tool_started' && e.sequence < preparation.sequence))
      calls.push(args)
      return { content: [{ type: 'text', text: 'saved' }], structuredContent: { snippet: { id: 'snippet', updated_at: '2026-10-24T00:00:00Z' } } }
    })
    const skills = testAgentSkillBundle()
    const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
      core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence },
        appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    let requests = 0
    const agent = createPiAgent({ bootstrap, skills, events: writer,
      mcp: { tools: mapped.tools, originalName: (encoded) => mapped.originalNames.get(encoded) ?? null, readOnly: () => false, close: async () => {} },
      lookupPreparedCall: async (id, step) => {
        for (const event of events) {
          const tool = event.payload.tool
          if (event.kind === 'tool_prepared' && isRecord(tool) && tool.tool_call_id === id && isRecord(tool.preparation) && tool.preparation.step === step) return tool.preparation as unknown as PreparedCall
        }
        return undefined
      },
      commitCheckpoint: async () => { throw new Error('不应压缩') },
      fetch: async () => {
        requests++
        if (requests === 1) return response(api, 'discover_tools', { names: [name] }, 'discover')
        if (requests === 2) return response(api, mapped.tools[0]!.name, { name: 'Example', command: 'pwd' }, 'create')
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      await writer.flush()
      assert.equal(calls.length, 1)
      assert.equal(calls[0]!.command, 'pwd')
      assert.match(String(calls[0]!.client_request_id), /^agt_[a-f0-9]{48}$/u)
      assert.ok(events.some((e) => e.kind === 'tool_completed' && isRecord(e.payload.tool) && e.payload.tool.tool_name === name))
      assert.ok(!JSON.stringify(events.filter((e) => e.kind === 'tool_prepared')).includes('pwd'))
    } finally { agent.close(); await writer.close() }
  })
}
