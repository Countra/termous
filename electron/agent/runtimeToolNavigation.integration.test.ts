import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from './piAgentAdapter.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'
import type { RuntimeBootstrap } from './workerCoreClient.ts'
import { createHash } from 'node:crypto'
import { createAgentSkillBundleSnapshot } from './skillBundle.ts'

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 从只发现 list 到 get/attach，声明与执行在完整轮次边界同步`, async () => {
    const bootstrap = fixtureBootstrap(api)
    const executed: string[] = []
    const mapped = mapMCPTools(['list', 'get', 'attach'].map((name) => ({
      name: `termous.desktops.${name}`, description: name,
      inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    })), async (definition) => {
      executed.push(definition.name)
      const result = { session: { session_id: 'fixture', connection_generation: 2 }, attachment: { attachment_id: 'current' } }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122',
        ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: {
        bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
        appendSteer: async () => { throw new Error('不应追加消息') },
        commitCheckpoint: async () => { throw new Error('不应压缩') },
      },
    })
    let requests = 0
    const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('不应压缩') },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
        const names = body.tools.map((tool) => tool.name ?? tool.function?.name)
        requests++
        if (requests === 1) {
          assert.deepEqual(names, ['discover_tools', 'read_skill_resource', 'read_history_image'])
          return response(api, 'discover_tools', { names: ['termous.desktops.list'] })
        }
        if (requests === 2) {
          assert.ok(names.includes('m_termous_ddesktops_dlist'))
          assert.ok(!names.includes('m_termous_ddesktops_dattach'))
          return response(api, 'm_termous_ddesktops_dlist')
        }
        assert.ok(names.includes('m_termous_ddesktops_dget'))
        assert.ok(names.includes('m_termous_ddesktops_dattach'))
        if (requests === 3) return response(api, 'm_termous_ddesktops_dget')
        if (requests === 4) return response(api, 'm_termous_ddesktops_dattach')
        assert.equal(requests, 5)
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      assert.deepEqual(executed, ['termous.desktops.list', 'termous.desktops.get', 'termous.desktops.attach'])
      assert.equal(requests, 5)
    } finally { agent.close(); await writer.close() }
  })
}

function response(api: string, name?: string, args = {}) {
  if (api === 'chat_completions') {
    const delta = name ? { tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } : { content: '观察附着已建立' }
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: name ? 'tool_calls' : 'stop' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  const item = name ? { type: 'function_call', id: `fc_${name}`, call_id: `call_${name}`, name, arguments: JSON.stringify(args), status: 'completed' }
    : { type: 'message', id: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '观察附着已建立', annotations: [] }] }
  const events = [
    { type: 'response.created', response: { id: 'response' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', ...(name ? { arguments: '' } : { content: [] }) } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'response', status: 'completed', output: [item] } },
  ]
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

for (const api of ['responses', 'chat_completions'] as const) {
  for (const code of ['desktop_input_uncertain', 'desktop_cleanup_uncertain']) {
    test(`${api} 清理未确认 ${code}：阻止后续输入，允许只读查询和正常回复`, async () => {
      const bootstrap = fixtureBootstrap(api)
      const executed: string[] = []
      const errors: unknown[] = []
      const mapped = mapMCPTools(['control.release', 'get', 'keyboard.text'].map((name) => ({
        name: `termous.desktops.${name}`, description: name,
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
      })), async (definition) => {
        executed.push(definition.name)
        const isError = definition.name.endsWith('release')
        const result = isError ? { error: { code, retryable: false } } : { session: { state: 'connected' } }
        return { isError, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
      })
      const writer = new RuntimeEventWriter({
        start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
        runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
        core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
          appendEvents: async (_start, _bearer, batch) => { errors.push(...batch.filter((event) => event.kind === 'error')); return batch[batch.length - 1]!.sequence },
          appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
      })
      let requests = 0
      const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
        mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
        commitCheckpoint: async () => { throw new Error('不应压缩') }, fetch: async (_input, init) => {
          requests++
          if (requests > 2) {
            const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
            const names = body.tools.map((tool) => tool.name ?? tool.function?.name)
            assert.ok(!names.includes('m_termous_ddesktops_dcontrol_drelease'))
            assert.ok(!names.includes('m_termous_ddesktops_dkeyboard_dtext'))
            assert.ok(names.includes('m_termous_ddesktops_dget'))
          }
          if (requests === 1) return response(api, 'discover_tools', { names: ['termous.desktops.control.release', 'termous.desktops.get', 'termous.desktops.keyboard.text'] })
          if (requests === 2) return response(api, 'm_termous_ddesktops_dcontrol_drelease')
          if (requests === 3) return response(api, 'm_termous_ddesktops_dkeyboard_dtext')
          if (requests === 4) return response(api, 'm_termous_ddesktops_dget')
          assert.equal(requests, 5)
          return response(api)
        },
      })
      try {
        assert.equal(await agent.continue(), 'completed')
        await writer.flush()
        assert.deepEqual(executed, ['termous.desktops.control.release', 'termous.desktops.get'])
        assert.deepEqual(errors, [])
      } finally { agent.close(); await writer.close() }
    })
  }
}

function fixtureBootstrap(api: 'responses' | 'chat_completions'): RuntimeBootstrap {
  return {
    core_instance_id: 'fixture', run: { id: 'agr_fixture', session_id: 'ags_fixture', generation: 1, event_sequence: 0, status: 'starting',
      assistant_message_id: 'agm_reply', provider_id: 'provider', model_id: 'model', reasoning_level: 'off' },
    session: { id: 'ags_fixture' }, runtime_bearer: 'fixture', mcp: { endpoint: '/mcp', bearer_token: 'fixture', protocol_version: '2025-11-25' },
    model: { snapshot: { api_mode: api, base_url: 'http://127.0.0.1:8123/v1', model_id: 'fixture', provider_id: 'provider', provider_name: 'fixture',
      model_display_name: 'fixture', provider_revision: 1, model_revision: 1, context_window_tokens: 32768, max_output_tokens: 1024,
      supports_images: false, reasoning_control: 'none', supported_reasoning_levels: ['off'] } },
    context: { estimated_tokens: 100, warning: false },
    messages: [{ id: 'agm_user', role: 'user', status: 'completed', sequence: 1, created_at: '2026-10-14T00:00:00Z',
      parts: [{ id: 'part', message_id: 'agm_user', kind: 'text', sequence: 1, content: { text: { text: '建立观察附着' } } }], attachments: [] }],
  }
}

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 重复 Skill 撤下后可发现其他资源，但旧请求仍被拦截且业务可继续`, async () => {
    const base = testAgentSkillBundle()
    const content = '需要查询时使用 termous.desktops.get。缺少工具时先发现，不重复读取。'
    const resource = { ...base.resources[0]!, content, size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }
    const nextContent = '另一份资源的独立规则。'
    const nextResource = { ...resource, uri: resource.uri.replace('/SKILL.md', '/references/next.md'), content: nextContent,
      size: Buffer.byteLength(nextContent), sha256: createHash('sha256').update(nextContent).digest('hex') }
    const skills = createAgentSkillBundleSnapshot([...base.catalog], [resource, nextResource])
    const bootstrap = fixtureBootstrap(api)
    let executed = 0
    const mapped = mapMCPTools([{ name: 'termous.desktops.get', inputSchema: { type: 'object', properties: {} } }], async () => {
      executed++
      return { content: [{ type: 'text', text: '当前目标已就绪' }] }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
        appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    let requests = 0
    const agent = createPiAgent({ bootstrap, events: writer, skills,
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('不应压缩') },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
        const names = body.tools.map((tool) => tool.name ?? tool.function?.name)
        requests++
        if (requests <= 3) return response(api, 'read_skill_resource', { uri: resource.uri, refresh: true })
        if (requests === 4) {
          assert.ok(!names.includes('read_skill_resource'))
          assert.ok(names.includes('discover_tools'))
          assert.ok(names.includes('m_termous_ddesktops_dget'))
          return response(api, 'discover_tools', { names: ['read_skill_resource'] })
        }
        if (requests === 5) {
          assert.ok(names.includes('read_skill_resource'))
          return response(api, 'read_skill_resource', { uri: resource.uri, refresh: true })
        }
        if (requests === 6) {
          assert.ok(!names.includes('read_skill_resource'))
          return response(api, 'discover_tools', { names: ['read_skill_resource'] })
        }
        if (requests === 7) return response(api, 'read_skill_resource', { uri: nextResource.uri })
        if (requests === 8) {
          assert.match(String(init?.body), /另一份资源的独立规则/)
          return response(api, 'm_termous_ddesktops_dget')
        }
        assert.equal(requests, 9)
        assert.ok(names.includes('read_skill_resource'))
        return response(api)
      },
    })
    try { assert.equal(await agent.continue(), 'completed'); assert.equal(executed, 1) }
    finally { agent.close(); await writer.close() }
  })
}

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 强制重复释放被执行门禁拦截，下一轮可创建且不同资源仍能清理`, async () => {
    const bootstrap = fixtureBootstrap(api)
    bootstrap.model.snapshot.supports_images = true
    const executed: Array<{ name: string; args: unknown }> = []
    const mapped = mapMCPTools(['captures.create', 'captures.release', 'runs.get'].map((name) => ({
      name: `termous.desktop_workflows.${name}`, inputSchema: { type: 'object' as const, properties: {} },
      annotations: { readOnlyHint: name === 'runs.get' },
    })), async (definition, args) => {
      executed.push({ name: definition.name, args })
      const data = definition.name.endsWith('create') ? { snapshot: { snapshot_id: 'new' } }
        : definition.name.endsWith('release') ? { completed: true } : { report: { run: { state: 'failed' }, steps: [] } }
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
        appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    let requests = 0
    const release = 'm_termous_ddesktop_uworkflows_dcaptures_drelease'
    const create = 'm_termous_ddesktop_uworkflows_dcaptures_dcreate'
    const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('不应压缩') },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
        const names = body.tools.map((tool) => tool.name ?? tool.function?.name)
        switch (++requests) {
          case 1: return response(api, 'discover_tools', { names: ['termous.desktop_workflows.runs.get'] })
          case 2:
            assert.ok(!names.includes(release))
            return response(api, 'm_termous_ddesktop_uworkflows_druns_dget')
          case 3: return response(api, 'discover_tools', { names: ['termous.desktop_workflows.captures.release'] })
          case 4: return response(api, release, { snapshot_id: 'old', client_request_id: 'one' })
          case 5:
            assert.ok(names.includes(create))
            return response(api, release, { snapshot_id: 'old', client_request_id: 'two' })
          case 6:
            assert.ok(!names.includes(release))
            assert.match(String(init?.body), /discover_tools/)
            return response(api, release, { snapshot_id: 'old', client_request_id: 'three' })
          case 7: return response(api, 'discover_tools', { names: ['termous.desktop_workflows.captures.release'] })
          case 8:
            assert.ok(names.includes(release))
            return response(api, release, { snapshot_id: 'other', client_request_id: 'four' })
          case 9: return response(api, create, { attachment_id: 'current', client_request_id: 'create' })
          case 10: return response(api, release, { snapshot_id: 'new', client_request_id: 'five' })
          default:
            assert.equal(requests, 11)
            return response(api)
        }
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      assert.deepEqual(executed.filter((call) => call.name.endsWith('release')).map((call) => (call.args as { snapshot_id: string }).snapshot_id), ['old', 'other', 'new'])
      assert.equal(executed.filter((call) => call.name.endsWith('create')).length, 1)
    } finally { agent.close(); await writer.close() }
  })
}
