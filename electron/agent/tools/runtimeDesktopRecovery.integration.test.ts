import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from '../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../test-support/runtimeToolResponseFixture.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'

const get = 'termous.desktops.get'
const list = 'termous.desktops.list'
const attach = 'termous.desktops.attach'
const acquire = 'termous.desktops.control.acquire'
const operations = 'termous.desktops.operations.get'
const release = 'termous.desktops.control.release'

for (const api of ['responses', 'chat_completions'] as const) for (const target of ['session', 'profile'] as const) {
  test(`${api} ${target} 本地准备失败后实际请求保留查询参数，重复提醒不阻止修正后的接管`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = api
    bootstrap.model.snapshot.context_window_tokens = 65536
    bootstrap.context.progress_supported = true
    bootstrap.messages = [runtimeUserMessage([], { text: '检查并操作当前桌面，历史附着 old-attachment 不再使用。' })]
    bootstrap.session.resource_bindings = [{ ...(target === 'session'
      ? { kind: 'desktop_session' as const, session_id: 'current-session', connection_generation: 2 } : { kind: 'desktop_profile' as const }),
      desktop_profile_id: 'profile', desktop_profile_name: 'test', host_id: 'host', host_name: 'test', protocol: 'rdp', bound_at: '2026-10-21T00:00:00Z' }]
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const attachment = { id: 'current-attachment', session_id: 'current-session', connection_generation: 2,
      execution_generation: 1, state: 'ready', control: { state: 'available' } }
    const session = { id: 'current-session', profile_id: 'profile', host_id: 'host', protocol: 'rdp', status: 'ready', connection_generation: 2 }
    const mapped = mapMCPTools([list, get, attach, acquire, operations, release].map((name) => ({ name, description: name,
      inputSchema: { type: 'object' as const, properties: {
        session_id: { type: 'string' }, attachment_id: { type: 'string' },
        connection_generation: { type: 'integer' }, client_request_id: { type: 'string' },
      }, required: name === attach ? ['session_id', 'connection_generation', 'client_request_id']
        : name === get || name === list ? [] : ['attachment_id', 'client_request_id'] },
    })), async (tool, args) => {
      calls.push({ name: tool.name, args })
      const data = tool.name === list ? { sessions: [session] } : tool.name === get && args.session_id ? { session }
        : tool.name === acquire ? { control: { attachment: { ...attachment, control: { state: 'held' },
          grant: { id: 'current-grant', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' } } } }
          : { attachment }
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
    })
    const skills = testAgentSkillBundle()
    const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
      core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
        appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应触发压缩') } },
    })
    const requests: Array<{ summaries: string[]; names: string[] }> = []
    const steps = [
      { name: 'discover_tools', args: { names: [acquire] } },
      ...Array.from({ length: 4 }, (_, i) => ({ name: encodeMCPToolName(acquire),
        args: { attachment_id: 'old-attachment', client_request_id: `failed-${i}` } })),
      ...(target === 'profile' ? [{ name: encodeMCPToolName(list), args: {} }] : []),
      { name: encodeMCPToolName(get), args: { session_id: 'current-session' } },
      { name: encodeMCPToolName(attach), args: { session_id: 'current-session', connection_generation: 2, client_request_id: 'attach' } },
      { name: encodeMCPToolName(get), args: { attachment_id: 'current-attachment' } },
      { name: encodeMCPToolName(acquire), args: { attachment_id: 'current-attachment', client_request_id: 'acquire' } },
    ]
    const agent = createPiAgent({ bootstrap, skills, events: writer,
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('不应触发压缩') },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }>;
          input?: Array<{ content?: string | Array<{ text?: string }> }>; messages?: Array<{ content?: string | Array<{ text?: string }> }> }
        const summaries = (body.input ?? body.messages ?? []).flatMap((item) => typeof item.content === 'string'
          ? [item.content] : (item.content ?? []).flatMap((part) => part.text ? [part.text] : []))
          .filter((text) => text.startsWith('[TERMOUS_EXECUTION_STATE]'))
        requests.push({ summaries, names: body.tools.map((tool) => tool.name ?? tool.function!.name) })
        const step = steps[requests.length - 1]
        return step ? response(api, step.name, step.args, String(requests.length)) : response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      assert.equal(requests.length, steps.length + 1)
      for (const request of requests.slice(2, 6)) {
        assert.equal(request.summaries.length, 1)
        const summary = request.summaries[0]!
        const query = target === 'session' ? get : list
        assert.ok(summary.includes(`实际调用 ${query}`))
        const entries = summary.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
        assert.ok(entries.some((entry) => entry.guidance?.includes(target === 'session' ? '参数 {"session_id":"current-session"}' : '参数 {}')))
        assert.ok(request.names.includes(encodeMCPToolName(query)))
        assert.ok(request.names.includes(encodeMCPToolName(acquire)))
        assert.ok(!request.names.includes(encodeMCPToolName(operations)))
      }
      assert.match(requests[4]!.summaries[0]!, /3 次/)
      assert.deepEqual(calls.map((call) => call.name), [...(target === 'profile' ? [list] : []), get, attach, get, acquire])
      assert.equal(calls[calls.length - 1]!.args.attachment_id, 'current-attachment')
      assert.match(requests[requests.length - 1]!.summaries[0]!, /"grant_status":"held"/)
      assert.doesNotMatch(requests[requests.length - 1]!.summaries[0]!, /建议先实际调用|同类操作反复失败|AGENT_RESOURCE_BINDING_MISMATCH/)
    } finally { agent.close(); await writer.close() }
  })
}
