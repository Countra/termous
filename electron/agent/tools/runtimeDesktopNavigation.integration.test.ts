import assert from 'node:assert/strict'
import test from 'node:test'
import type { Tool } from '@modelcontextprotocol/client'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { runtimeBootstrap, runtimePart, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { runtimeToolResponse as response } from '../test-support/runtimeToolResponseFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import { createPiAgent } from '../runtime/piAgentAdapter.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { DesktopObservationContext } from '../context/desktop/state.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'

const prefix = 'termous.desktops.'
const string = { type: 'string' }
function definition(suffix: string, properties: Record<string, unknown>, required: string[] = [], readOnly = true): Tool {
  return { name: prefix + suffix, description: suffix, annotations: { readOnlyHint: readOnly },
    inputSchema: { type: 'object', properties: properties as Tool['inputSchema']['properties'], required, additionalProperties: false } }
}

for (const api of ['responses', 'chat_completions'] as const) {
  for (const origin of ['binding', 'history', 'checkpoint'] as const) {
  for (const [inputAllowed, startWithKeys] of [[true, true], [true, false], [false, false]]) {
    test(`${api}/${origin} 实际请求并列提供链式与单动作，跨 SDK 分段保留；有输入权限=${inputAllowed}，先按键=${startWithKeys}`, async () => {
      const bootstrap = runtimeBootstrap()
      bootstrap.messages = [runtimeUserMessage([], { text: '观察受控测试窗口并点击目标按钮。' })]
      bootstrap.model.snapshot.api_mode = api
      bootstrap.model.snapshot.supports_images = true
      bootstrap.model.snapshot.context_window_tokens = 128000
      bootstrap.session.resource_bindings = [{ kind: 'desktop_session', session_id: 'desktop', connection_generation: 1,
        desktop_profile_id: 'profile', desktop_profile_name: 'Fixture', host_id: 'host', host_name: 'Fixture', protocol: 'rdp', bound_at: '2026-10-24T00:00:00Z' }]
      if (origin !== 'binding') {
        bootstrap.session.resource_bindings = []
        const context = new DesktopObservationContext(bootstrap.session.id, bootstrap.core_instance_id)
        context.observe(prefix + 'capture', {}, { capture: { target: { kind: 'protocol_session', session_id: 'desktop', connection_generation: 1 } } })
        if (origin === 'checkpoint') bootstrap.context.checkpoint = { boundary_message_sequence: 0, summary: 'Observed the selected desktop.', estimated_tokens: 10, details: { desktop_context: context.snapshot() } }
        else bootstrap.messages.unshift({ id: 'historical', role: 'assistant', status: 'completed', sequence: 0, created_at: '2026-10-24T00:00:00Z', attachments: [],
          parts: [runtimePart('tool_result', 1, { tool_result: { tool_call_id: 'previous-capture', tool_name: prefix + 'capture',
            content: context.project({ content: [], details: undefined }).content, is_error: false } })] })
      }
      const definitions = [
        definition('get', { session_id: string, attachment_id: string, wait_ms: { type: 'integer' } }),
        definition('attach', { session_id: string, connection_generation: { type: 'integer' }, client_request_id: string }, ['session_id', 'connection_generation', 'client_request_id'], false),
        definition('capture', { attachment_id: string }, ['attachment_id']),
        ...(inputAllowed ? [
          definition('execute', { attachment_id: string, grant_id: string, client_request_id: string, screenshot_id: string, actions: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'object' } } }, ['attachment_id', 'grant_id', 'client_request_id', 'actions'], false),
          definition('keyboard.text', { attachment_id: string, grant_id: string, client_request_id: string, text: string }, ['attachment_id', 'grant_id', 'client_request_id', 'text'], false),
          definition('control.acquire', { attachment_id: string, client_request_id: string }, ['attachment_id', 'client_request_id'], false),
          definition('keyboard.shortcut', { attachment_id: string, grant_id: string, client_request_id: string, codes: { type: 'array', items: string } }, ['attachment_id', 'grant_id', 'client_request_id', 'codes'], false),
          definition('pointer.click', { attachment_id: string, grant_id: string, client_request_id: string, screenshot_id: string, coordinate_space: { type: 'string', enum: ['image', 'desktop'] }, x: { type: 'integer' }, y: { type: 'integer' } },
            ['attachment_id', 'grant_id', 'client_request_id', 'screenshot_id', 'coordinate_space', 'x', 'y'], false),
        ] : []),
      ]
      const calls: { name: string; args: Record<string, unknown> }[] = []
      let granted = false
      let screenshots = 0
      const attachment = () => ({ id: 'attachment', session_id: 'desktop', state: 'ready', connection_generation: 1, execution_generation: 1,
        ...(granted ? { grant: { id: 'grant', expires_at: new Date(Date.now() + 600000).toISOString(), idle_expires_at: new Date(Date.now() + 600000).toISOString() } } : {}) })
      const mapped = mapMCPTools(definitions, async (tool, args) => {
        calls.push({ name: tool.name, args })
        if (tool.name.endsWith('.control.acquire')) granted = true
        if (tool.name.endsWith('.capture')) screenshots++
        const data = tool.name.endsWith('.get') ? args.session_id ? { session: { id: 'desktop', profile_id: 'profile', host_id: 'host', protocol: 'rdp', status: 'ready', connection_generation: 1 } } : { attachment: attachment() }
          : tool.name.endsWith('.attach') ? { attachment: attachment() }
            : tool.name.endsWith('.control.acquire') ? { control: { attachment: attachment() } }
              : tool.name.endsWith('.capture') ? { capture: { screenshot_id: `shot-${screenshots}`, image_view: { width: 800, height: 600 }, metadata: { connection_generation: 1 } } }
                : { operation: { state: 'accepted', completed_steps: 1 } }
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
      })
      const writer = new RuntimeEventWriter({
        start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
        runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
        core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
          appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
      })
      let requests = 0
      let requestFailure: unknown
      const encoded = (suffix: string) => mapped.tools.find((tool) => mapped.originalNames.get(tool.name) === prefix + suffix)!.name
      const agent = createPiAgent({ bootstrap, skills: testAgentSkillBundle(), events: writer,
        mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null,
          readOnly: (name) => definitions.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true, close: async () => {} },
        lookupPreparedCall: async () => undefined,
        commitCheckpoint: async () => { throw new Error('不应压缩') },
        fetch: async (_input, init) => {
          try {
            const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; description?: string; parameters?: { required: string[] }; function?: { name: string; description: string; parameters: { required: string[] } } }> }
            const tools = body.tools.map((tool) => tool.function ?? tool)
            requests++
            for (const suffix of ['execute', 'pointer.click', 'keyboard.text', 'keyboard.shortcut']) {
              if (inputAllowed) assert.ok(tools.some(tool => tool.name === encoded(suffix)), `${suffix} missing on request ${requests}`)
              else assert.ok(tools.every(tool => tool.name !== encodeMCPToolName(prefix + suffix)))
            }
            if (requests === 1) {
              assert.equal(calls.length, 0, '加载声明不建立连接、申请控制或输入')
              assert.ok(tools.some((tool) => tool.name === encoded('capture')))
              if (inputAllowed) assert.ok(tools.some((tool) => tool.name === encoded('pointer.click')))
              else assert.ok(tools.every((tool) => !tool.name?.includes('_dpointer_')))
              return response(api, encoded('capture'), {}, 'observe')
            }
            if (startWithKeys && requests <= 4) return response(api, encoded('keyboard.shortcut'), { codes: ['KeyY'] }, String(requests))
            if (inputAllowed && requests >= 3) {
              const click = tools.find((tool) => tool.name === encoded('pointer.click'))!
              assert.ok(click)
              assert.ok(!click.parameters!.required.includes('grant_id'))
              assert.ok(click.parameters!.required.includes('screenshot_id'))
              assert.match(click.description!, /coordinate_space/)
              const keyboard = tools.find((tool) => tool.name === encoded('keyboard.shortcut'))!
              assert.match(keyboard.description!, /pointer.click/)
              if (startWithKeys && requests === 5) assert.match(String(init?.body), /尚无画面变化证据/)
            } else if (!inputAllowed) assert.ok(tools.every((tool) => !tool.name?.includes('_dpointer_')))
            if (requests <= 12) return response(api, encoded('capture'), {}, String(requests))
            if (inputAllowed && requests === 13) return response(api, encoded('pointer.click'), { screenshot_id: `shot-${screenshots}`, coordinate_space: 'image', x: 420, y: 260 }, 'click')
            if (inputAllowed && requests === 14) return response(api, encoded('capture'), {}, 'verify')
            assert.equal(requests, inputAllowed ? 15 : 13)
            return response(api)
          } catch (error) {
            // 断言在测试边界抛出，避免被 Provider 当成网络故障重试。
            requestFailure = error
            return response(api)
          }
        },
      })
      try {
        assert.equal(await agent.continue(), 'completed')
        if (requestFailure) throw requestFailure
        const clicks = calls.filter((call) => call.name === prefix + 'pointer.click')
        assert.equal(clicks.length, inputAllowed ? 1 : 0)
        if (inputAllowed) {
          assert.equal(clicks[0]!.args.x, 420)
          assert.equal(clicks[0]!.args.screenshot_id, startWithKeys ? 'shot-9' : 'shot-12')
          assert.equal(clicks[0]!.args.grant_id, 'grant')
          assert.equal(calls.filter((call) => call.name === prefix + 'control.acquire').length, 1)
          assert.equal(calls[calls.length - 1]!.name, prefix + 'capture')
        }
      } finally { agent.close(); await writer.close() }
    })
  }
  }
}
