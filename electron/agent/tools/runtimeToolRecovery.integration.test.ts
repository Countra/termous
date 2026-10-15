import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from '../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../test-support/runtimeToolResponseFixture.ts'
import incident from '../test-support/desktop-connect-incident.json' with { type: 'json' }
import { mapMCPTools } from './mcpClientAdapter.ts'

const get = 'termous.desktops.get'
const connect = 'termous.desktops.connect'
const encoded = (name: string) => `m_${name.replace(/_/gu, '_u').replace(/\./gu, '_d')}`

for (const api of ['responses', 'chat_completions'] as const) {
  for (const scenario of ['incident', 'missing', 'schema', 'unloaded', 'empty-transition', 'transport'] as const) {
    test(`${api} ${scenario} 首次回执即纠错且不拦截模型后续选择`, async () => {
      const bootstrap = runtimeBootstrap()
      bootstrap.model.snapshot.api_mode = api
      bootstrap.model.snapshot.context_window_tokens = 65536
      bootstrap.messages = [runtimeUserMessage([], { text: '核验准确 Profile 并确保连接，完成后保留会话。' })]
      bootstrap.session.resource_bindings = [{ kind: 'desktop_profile', desktop_profile_id: 'profile', desktop_profile_name: 'test', host_id: 'host', host_name: 'test', protocol: 'rdp', bound_at: '2026-10-15T00:00:00Z' }]
      const calls: Array<{ name: string; args: Record<string, unknown> }> = []
      let receipt = 0
      const mapped = mapMCPTools(['list', 'get', 'connect', 'attach'].map((suffix) => ({
        name: `termous.desktops.${suffix}`, description: suffix,
        inputSchema: { type: 'object' as const, properties: { session_id: { type: 'string' }, profile_id: { type: 'string' }, wait_ms: { type: 'integer' }, connection_generation: { type: 'integer' } }, required: suffix === 'get' ? ['session_id'] : [] },
      })), async (definition, args) => {
        calls.push({ name: definition.name, args })
        if (scenario === 'transport') throw new Error(JSON.stringify({ code: 'AGENT_RESOURCE_BINDING_MISMATCH', dispatched: false, cause_code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND' }))
        const data = scenario === 'incident' ? incident.calls.filter((call) => !call.local)[receipt++]!.data
          : scenario === 'empty-transition' && definition.name === 'termous.desktops.list' ? { sessions: receipt++ === 0 ? [{ id: 'previous' }] : [] }
          : definition.name === connect ? { session: { id: 'current', profile_id: 'profile', host_id: 'host', protocol: 'rdp', status: 'connecting', connection_generation: 1 }, created: false }
            : { error: { code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND', retryable: false } }
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: 'error' in data }
      })
      const skills = testAgentSkillBundle()
      const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
        core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
        runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
        core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
          appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应触发压缩') } },
      })
      const requests: Array<{ text: string; names: string[] }> = []
      const agent = createPiAgent({ bootstrap, skills, events: writer,
        mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
        commitCheckpoint: async () => { throw new Error('不应触发压缩') },
        fetch: async (_input, init) => {
          const text = String(init?.body)
          const body = JSON.parse(text) as { tools: Array<{ name?: string; function?: { name: string } }> }
          const names = body.tools.map((tool) => tool.name ?? tool.function!.name)
          requests.push({ text, names })
          const index = requests.length
          // 断言放在模型循环外，避免把夹具断言异常误当 Provider 网络错误重试。
          if (scenario === 'incident') {
            if (index === 1) return response(api, 'discover_tools', { names: ['termous.desktops.list', get, 'termous.desktops.attach'] }, String(index))
            const call = incident.calls[index - 2]
            return call ? response(api, encoded(call.name), call.args, String(index)) : response(api)
          }
          if (scenario === 'empty-transition') {
            if (index === 1) return response(api, 'discover_tools', { names: ['termous.desktops.list'] }, String(index))
            if (index <= 3) return response(api, encoded('termous.desktops.list'), {}, String(index))
            return index === 4 ? response(api, encoded(connect), { profile_id: 'profile' }, String(index)) : response(api)
          }
          if (index === 1 && scenario !== 'unloaded') return response(api, 'discover_tools', { names: [get] }, String(index))
          if (scenario === 'unloaded') return index === 1 ? response(api, encoded(get), { session_id: 'old' }, String(index)) : response(api)
          if (index === 2) return response(api, encoded(get), scenario === 'schema' ? {} : { session_id: 'old' }, String(index))
          if (index === 3 && scenario !== 'transport') return response(api, scenario === 'schema' ? encoded(get) : encoded(connect), scenario === 'schema' ? { session_id: 'old' } : { profile_id: 'profile' }, String(index))
          return response(api)
        },
      })
      try {
        assert.equal(await agent.continue(), 'completed')
        const after = requests[scenario === 'unloaded' ? 1 : scenario === 'empty-transition' ? 3 : 2]!
        assert.match(after.text, /\[TERMOUS_EXECUTION_STATE\]/)
        assert.equal((after.text.match(/\[TERMOUS_EXECUTION_STATE\]/gu) ?? []).length, 1)
        if (scenario === 'incident' || scenario === 'missing' || scenario === 'empty-transition') {
          assert.ok(after.names.includes(encoded(connect)))
          assert.match(after.text, /does not connect|do not establish a connection/)
        }
        if (scenario === 'transport') {
          assert.ok(!after.names.includes(encoded(connect)))
          assert.match(after.text, /不把通用错误当作资源不存在/)
          assert.equal(calls.length, 1)
        } else if (scenario === 'empty-transition') {
          const state = (text: string) => text.match(/\[TERMOUS_EXECUTION_STATE\]([\s\S]*?)\[\/TERMOUS_EXECUTION_STATE\]/u)?.[1] ?? ''
          assert.match(state(after.text), /No sessions were returned/)
          assert.doesNotMatch(state(requests[4]!.text), /No sessions were returned/)
          assert.match(state(requests[4]!.text), /current/)
          assert.deepEqual(calls.map((call) => call.name), ['termous.desktops.list', 'termous.desktops.list', connect])
        } else if (scenario === 'incident') {
          assert.equal(calls.filter((call) => call.name === get).length, 5)
          assert.ok(requests.slice(2).every((request) => request.names.includes(encoded(connect))))
        } else if (scenario === 'schema') {
          assert.equal(calls.length, 1)
          assert.equal(calls[0]!.args.session_id, 'old')
          assert.ok(after.names.includes(encoded(get)))
          assert.match(after.text, /参数或前置条件修正后可重试原工具/)
        } else if (scenario === 'unloaded') {
          assert.equal(calls.length, 0)
          assert.match(after.text, /discover_tools/)
          assert.match(after.text, /工具未加载或资源不支持/)
        } else assert.deepEqual(calls.map((call) => call.name), [get, connect])
      } finally { agent.close(); await writer.close() }
    })
  }
}
