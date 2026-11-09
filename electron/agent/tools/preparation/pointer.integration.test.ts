import assert from 'node:assert/strict'
import test from 'node:test'
import type { Tool } from '@modelcontextprotocol/client'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from '../../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../../runtime/runtimeEventWriter.ts'
import type { RuntimeEventInput } from '../../contracts/runtimeEvents.ts'
import type { PreparedCall } from '../../contracts/toolPreparation.ts'
import { isRecord } from '../../contracts/validation.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../../test-support/runtimeBootstrapTestFixture.ts'
import { continuationHost, continuationTools } from '../../test-support/desktopContinuationFixture.ts'
import { testAgentSkillBundle } from '../../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../../test-support/runtimeToolResponseFixture.ts'
import { mapMCPTools } from '../mcpClientAdapter.ts'

const target = { ...continuationHost, host: { ...continuationHost.host, title: 'Display' } }
const string = { type: 'string' }
const integer = { type: 'integer' }
const identity = { attachment_id: string, grant_id: string, client_request_id: string, screenshot_id: string }
const definition = (name: string, properties: Record<string, unknown>, required: string[], readOnly: boolean): Tool => ({
  name: `termous.desktops.${name}`, description: name, inputSchema: { type: 'object', properties: properties as Tool['inputSchema']['properties'], required, additionalProperties: false }, annotations: { readOnlyHint: readOnly },
})
const definitions = [...continuationTools,
  definition('pointer.position', { attachment_id: string }, ['attachment_id'], true),
  definition('pointer.move', { ...identity, x: integer, y: integer, duration_ms: integer }, [...Object.keys(identity), 'x', 'y'], false),
  definition('pointer.click_current', { ...identity, button: string, count: integer }, Object.keys(identity), false),
  definition('control.acquire', { attachment_id: string, client_request_id: string }, ['attachment_id', 'client_request_id'], false),
]

for (const api of ['responses', 'chat_completions'] as const) for (const supported of [true, false]) {
  test(`${api} 鼠标生产准备路径：${supported ? '只读查询、平滑移动与原地双击' : '能力不足不申请控制'}`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = api
    bootstrap.model.snapshot.supports_images = true
    bootstrap.model.snapshot.context_window_tokens = 64000
    bootstrap.session.resource_bindings = [{ kind: 'host_desktop', desktop_target: target, host_name: '', bound_at: '2026-10-27T00:00:00Z' }]
    bootstrap.messages = [runtimeUserMessage([], { text: '查询鼠标位置，观察画面后平滑移动并原地双击。' })]
    const events: RuntimeEventInput[] = []
    const calls: { name: string; args: Record<string, unknown> }[] = []
    let granted = false
    const attachment = () => ({ id: 'attachment', target, state: 'ready',
      capabilities: supported ? { pointer_position: true, pointer_smooth: true, pointer_click_current: true } : {},
      ...(granted ? { grant: { id: 'grant', expires_at: new Date(Date.now() + 60000).toISOString(), idle_expires_at: new Date(Date.now() + 60000).toISOString() } } : {}),
    })
    const mapped = mapMCPTools(definitions, async (tool, args) => {
      calls.push({ name: tool.name, args: structuredClone(args) })
      let data: Record<string, unknown>
      if (tool.name.endsWith('.sources')) data = { sources: [{ target }] }
      else if (tool.name.endsWith('.get') || tool.name.endsWith('.attach')) data = { attachment: attachment() }
      else if (tool.name.endsWith('.capture')) data = { capture: { screenshot_id: 'shot', target } }
      else if (tool.name.endsWith('.position')) {
        assert.equal(granted, false)
        assert.deepEqual(args, { attachment_id: 'attachment' })
        data = { pointer_position: { target, inside_target: true, position: { x: 5, y: 6 }, coordinate_space: 'desktop' } }
      } else if (tool.name.endsWith('.acquire')) { granted = true; data = { control: { attachment: attachment() } } }
      else data = { operation: { state: 'accepted' } }
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
    })
    const skills = testAgentSkillBundle()
    const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
      core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: error => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence },
        appendSteer: async () => { throw new Error('不应追加') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    let requests = 0
    const names = ['pointer.position', 'pointer.move', 'pointer.click_current', 'capture'].map(name => `termous.desktops.${name}`)
    const agent = createPiAgent({ bootstrap, skills, events: writer,
      mcp: { tools: mapped.tools, originalName: name => mapped.originalNames.get(name) ?? null, readOnly: name => definitions.find(tool => tool.name === name)?.annotations?.readOnlyHint === true, close: async () => {} },
      lookupPreparedCall: async (id, step) => {
        for (const event of events) {
          const tool = event.payload.tool
          if (event.kind === 'tool_prepared' && isRecord(tool) && tool.tool_call_id === id && isRecord(tool.preparation) && tool.preparation.step === step) return tool.preparation as unknown as PreparedCall
        }
        return undefined
      }, commitCheckpoint: async () => { throw new Error('不应压缩') },
      fetch: async (_input, init) => {
        requests++
        const body = JSON.parse(String(init?.body)) as { tools: { name?: string; parameters?: { properties: Record<string, unknown> }; description?: string; function?: { name: string; parameters: { properties: Record<string, unknown> }; description: string } }[] }
        if (requests === 1) return response(api, 'discover_tools', { names }, 'discover')
        const declarations = body.tools.map(tool => tool.function ?? tool)
        const position = declarations.find(tool => tool.name === 'm_termous_ddesktops_dpointer_dposition')!
        const click = declarations.find(tool => tool.name === 'm_termous_ddesktops_dpointer_dclick_ucurrent')!
        const move = declarations.find(tool => tool.name === 'm_termous_ddesktops_dpointer_dmove')!
        assert.ok(position && click && move)
        assert.ok(!('grant_id' in position.parameters!.properties) && !('screenshot_id' in position.parameters!.properties))
        assert.ok(!('x' in click.parameters!.properties) && !('y' in click.parameters!.properties) && !('grant_id' in click.parameters!.properties))
        assert.ok('duration_ms' in move.parameters!.properties)
        assert.match(position.description!, /does not acquire or renew control/)
        if (requests === 2) return response(api, position.name!, {}, 'position')
        if (requests === 3) return response(api, 'm_termous_ddesktops_dcapture', {}, 'capture')
        if (requests === 4) return response(api, move.name!, { screenshot_id: 'shot', x: 40, y: 50, duration_ms: 250 }, 'move')
        if (requests === 5) return response(api, click.name!, { screenshot_id: 'shot', button: 'right', count: 2 }, 'click')
        if (!supported) assert.match(JSON.stringify(body), /AGENT_DESKTOP_CAPABILITY_UNSUPPORTED/)
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      await writer.flush()
      assert.equal(requests, 6)
      assert.equal(calls.filter(call => call.name.endsWith('.acquire')).length, supported ? 1 : 0)
      const inputs = calls.filter(call => call.name.endsWith('.move') || call.name.endsWith('.click_current'))
      assert.equal(inputs.length, supported ? 2 : 0)
      if (supported) {
        assert.equal(inputs[0]!.args.duration_ms, 250)
        assert.equal(inputs[1]!.args.count, 2)
        assert.ok(!('x' in inputs[1]!.args) && !('y' in inputs[1]!.args))
        assert.equal(inputs[1]!.args.grant_id, 'grant')
        assert.match(String(inputs[1]!.args.client_request_id), /^agt_[a-f0-9]{48}$/)
      }
    } finally { agent.close(); await writer.close() }
  })
}
