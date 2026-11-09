import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from '../../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../../runtime/runtimeEventWriter.ts'
import type { RuntimeEventInput } from '../../contracts/runtimeEvents.ts'
import type { PreparedCall } from '../../contracts/toolPreparation.ts'
import { isRecord } from '../../contracts/validation.ts'
import { DesktopObservationContext } from '../../context/desktop/state.ts'
import { runtimeBootstrap, runtimePart, runtimeUserMessage } from '../../test-support/runtimeBootstrapTestFixture.ts'
import { continuationHost as target, continuationMCP } from '../../test-support/desktopContinuationFixture.ts'
import { testAgentSkillBundle } from '../../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../../test-support/runtimeToolResponseFixture.ts'

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 中断后继续的实际模型请求包含恢复动作、简化参数和已加载声明`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = api
    bootstrap.model.snapshot.supports_images = true
    bootstrap.model.snapshot.context_window_tokens = 64000
    const previous = new DesktopObservationContext(bootstrap.session.id, bootstrap.core_instance_id)
    const receipt = { attachment: { id: 'old-attachment', target, state: 'ready' } }
    previous.observe('termous.desktops.attach', {}, receipt)
    bootstrap.messages = [runtimeUserMessage([], { text: '操作此桌面' }),
      { id: 'old-message', role: 'assistant', status: 'interrupted', sequence: 2, created_at: '2026-10-27T00:00:00Z', attachments: [], parts: [
        runtimePart('tool_call', 1, { tool_call: { tool_call_id: 'old-call', tool_name: 'termous.desktops.attach', arguments: { target } } }),
        runtimePart('tool_result', 2, { tool_result: { tool_call_id: 'old-call', tool_name: 'termous.desktops.attach', is_error: false,
          content: previous.project({ content: [{ type: 'text', text: JSON.stringify(receipt) }], details: undefined }).content } }),
      ] }, { ...runtimeUserMessage([], { text: '继续' }), id: 'continue', sequence: 3 }]
    const events: RuntimeEventInput[] = []
    const { calls, mcp } = continuationMCP(name => name.endsWith('.get') ? { error: { code: 'desktop_generation_stale', message: '旧附着不能用于本轮' } }
      : name.endsWith('.sources') ? { sources: [{ target }] }
        : name.endsWith('.attach') ? { attachment: { id: 'new-attachment', target, state: 'ready' } }
          : { capture: { screenshot_id: 'new-shot', target } })
    const skills = testAgentSkillBundle()
    const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
      core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: error => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence },
        appendSteer: async () => { throw new Error('不应追加') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    let requests = 0
    const agent = createPiAgent({ bootstrap, skills, events: writer, mcp,
      lookupPreparedCall: async (id, step) => {
        for (const event of events) {
          const tool = event.payload.tool
          if (event.kind === 'tool_prepared' && isRecord(tool) && tool.tool_call_id === id && isRecord(tool.preparation) && tool.preparation.step === step) return tool.preparation as unknown as PreparedCall
        }
        return undefined
      }, commitCheckpoint: async () => { throw new Error('不应压缩') },
      fetch: async (_input, init) => {
        requests++
        const body = JSON.parse(String(init?.body)) as { tools: { name?: string; function?: { name: string } }[] }
        const names = body.tools.map(tool => tool.name ?? tool.function?.name)
        assert.ok(names.includes('m_termous_ddesktops_dcapture'))
        if (requests === 1) return response(api, 'discover_tools', { names: ['termous.desktops.get'] }, 'discover')
        if (requests >= 3) {
          const raw = JSON.stringify(body)
          assert.match(raw, /get cannot create or restore an attachment/)
          assert.match(raw, /termous.desktops.capture/)
          assert.match(raw, /call termous.desktops.capture/i)
        }
        if (requests <= 4) return response(api, 'm_termous_ddesktops_dget', { attachment_id: 'old-attachment' }, `stale-${requests}`)
        if (requests === 5) return response(api, 'm_termous_ddesktops_dcapture', {}, 'capture')
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      await writer.flush()
      assert.equal(requests, 6)
      assert.equal(calls.filter(call => call.name === 'termous.desktops.get').length, 3)
      assert.deepEqual(calls.slice(-3).map(call => call.name), ['termous.desktops.sources', 'termous.desktops.attach', 'termous.desktops.capture'])
      assert.equal(calls[calls.length - 1]!.args.attachment_id, 'new-attachment')
      assert.ok(!calls.some(call => call.name.includes('.control.') || call.name.includes('.pointer.')))
      assert.ok(events.some(event => event.kind === 'tool_prepared'))
    } finally { agent.close(); await writer.close() }
  })
}
