import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { RuntimeEventInput } from '../contracts/runtimeEvents.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { runtimeToolResponse } from '../test-support/runtimeToolResponseFixture.ts'
import { withToolDiscovery } from '../test-support/runtimeDiscoveryTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { attachLocalTools } from '../worker/localTools.ts'
import { createPiAgent } from './piAgentAdapter.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'

for (const api of ['chat_completions', 'responses'] as const) {
  for (const queries of [true, false]) test(`${api} 本地命令待完成时${queries ? '查询原任务后正常收尾' : '忽略查询引导不会无限续跑'}`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = api
    bootstrap.model.snapshot.context_window_tokens = 128000
    bootstrap.messages = [runtimeUserMessage([], { text: '运行命令并检查结果' })]
    const events: RuntimeEventInput[] = []
    const calls: string[] = []
    const mcp = attachLocalTools({ tools: [], originalName: () => null, close: async () => {} }, {
      directory: { path: 'C:/fixture', managed: false, revision: 1 },
      environment: { platform: 'windows', default_shell: 'powershell', shells: [] },
      tools: Object.fromEntries(['execute', 'wait'].map(action => [`termous.local.commands.${action}`, {
        description: action, inputSchema: { type: 'object', properties: {} },
      }])),
    }, async input => {
      calls.push(input.tool)
      return { state: 'completed', value: { task: { id: 'lc_fixture', status: input.tool.endsWith('.wait') ? 'completed' : 'running' } } }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48),
        run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1, onFailure: error => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence },
        appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    let requests = 0
    const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(), mcp,
      commitCheckpoint: async () => { throw new Error('不应压缩') },
      fetch: withToolDiscovery(async (_url, init) => {
        requests++
        assert.ok(requests <= 4, '待完成提示不能产生无限模型请求')
        if (requests === 3) assert.match(String(init?.body), /Local commands are still active/u)
        return runtimeToolResponse(api, requests === 1 ? mcp.tools[0]!.name : queries && requests === 3 ? mcp.tools[1]!.name : undefined, {}, String(requests))
      }, ['termous.local.commands.execute', 'termous.local.commands.wait']),
    })
    try {
      assert.equal(await agent.continue(), queries ? 'completed' : 'failed')
      await writer.flush()
      assert.equal(requests, queries ? 4 : 3)
      assert.deepEqual(calls, queries ? ['termous.local.commands.execute', 'termous.local.commands.wait'] : ['termous.local.commands.execute'])
      if (!queries) assert.ok(events.some(event => event.kind === 'error' && JSON.stringify(event.payload).includes('AGENT_RUNTIME_LOCAL_COMMAND_PENDING')))
    } finally { agent.close(); await writer.close(); await mcp.close() }
  })
}
