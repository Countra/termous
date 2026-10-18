import { runtimeToolResponse as response } from '../test-support/runtimeToolResponseFixture.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from '../runtime/piAgentAdapter.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import type { RuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'
import { createHash } from 'node:crypto'
import { createAgentSkillBundleSnapshot } from '../contracts/skillBundle.ts'

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 从只发现 list 到 get/attach，声明与执行在完整轮次边界同步`, async () => {
    const bootstrap = fixtureBootstrap(api)
    const executed: string[] = []
    const mapped = mapMCPTools(['list', 'get', 'attach'].map((name) => ({
      name: `termous.desktops.${name}`, description: name,
      inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    })), async (definition) => {
      executed.push(definition.name)
      const result = { sessions: [{ session_id: 'fixture', connection_generation: 2 }], session: { session_id: 'fixture', connection_generation: 2 }, attachment: { attachment_id: 'current' } }
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

test('自动阶段说明不能代替显式 Skill 读取，切换能力后完整文档仍保留在历史中', async () => {
  const bootstrap = fixtureBootstrap('chat_completions')
  const entries = ['termous-remote-desktop', 'termous-files', 'termous-snippets'].map((name) => ({
    name, description: name, entry_uri: `skill://${name}/SKILL.md`,
  }))
  const resources = entries.map((entry) => {
    const content = `Durable instructions for ${entry.name}.`
    return { uri: entry.entry_uri, content, size: Buffer.byteLength(content),
      sha256: createHash('sha256').update(content).digest('hex'), media_type: 'text/markdown; charset=utf-8' as const }
  })
  const skills = createAgentSkillBundleSnapshot(entries, [...resources,
    { ...resources[1]!, uri: 'skill://termous-files/references/session-and-files.md' },
    { ...resources[2]!, uri: 'skill://termous-snippets/references/library-workflows.md' },
  ])
  const names = ['termous.desktops.list', 'termous.files.sessions.list', 'termous.snippets.list']
  const mapped = mapMCPTools(names.map((name) => ({ name, inputSchema: { type: 'object' as const, properties: {} } })),
    async () => { throw new Error('本测试只发现能力和读取文档') })
  const writer = new RuntimeEventWriter({
    start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122',
      ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
    runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
    core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
      appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
  })
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  const agent = createPiAgent({ bootstrap, skills, events: writer,
    mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
    commitCheckpoint: async () => { throw new Error('不应压缩') },
    fetch: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)))
      if (requests.length === 1) return response('chat_completions', 'discover_tools', { names: [names[0]] })
      if (requests.length === 2) return response('chat_completions', 'read_skill_resource', { uri: resources[0]!.uri })
      if (requests.length === 3) return response('chat_completions', 'discover_tools', { names: names.slice(1) }, 'switch')
      return response('chat_completions')
    },
  })
  try {
    assert.equal(await agent.continue(), 'completed')
    assert.equal(requests.length, 4)
    const text = resources[0]!.content
    assert.ok(requests[1]!.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes(text)))
    assert.ok(requests[3]!.messages.some((message) => message.role === 'tool' && JSON.stringify(message.content).includes(text)))
    assert.equal(JSON.stringify(requests[3]).split(text).length - 1, 1)
    assert.ok(requests[3]!.messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes(resources[2]!.content)))
  }
  finally { agent.close(); await writer.close() }
})

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 重复启动后的下一请求包含报告和编辑入口，版本以真实回执为准`, async () => {
    const bootstrap = fixtureBootstrap(api)
    bootstrap.context.progress_supported = true
    const prefix = 'termous.desktop_workflows.'
    const called: string[] = []
    const run = { id: 'original-run', script_id: 'original-script', version: 2, state: 'failed', error_code: 'desktop_generation_stale', executed: 6 }
    const mapped = mapMCPTools(['runs.start', 'runs.get', 'get', 'update', 'validate'].map((suffix) => ({
      name: prefix + suffix, annotations: { readOnlyHint: ['runs.get', 'get', 'validate'].includes(suffix) },
      inputSchema: { type: 'object' as const, properties: {} },
    })), async (definition) => {
      called.push(definition.name)
      const data = definition.name === prefix + 'runs.start' ? { run }
        : definition.name === prefix + 'runs.get' ? { report: { run, steps: [] } }
          : definition.name === prefix + 'get' ? { detail: { script: { id: 'original-script', revision: 6 }, version: { script_id: 'original-script', number: 2 } } }
            : { script: { id: 'original-script', revision: 7 } }
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
        appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('重复调用不应强制压缩') } },
    })
    const encoded = (suffix: string) => mapped.tools.find((tool) => mapped.originalNames.get(tool.name) === prefix + suffix)!.name
    let requests = 0
    const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('不应压缩') }, fetch: async (_input, init) => {
        const wire = String(init?.body)
        const body = JSON.parse(wire) as { tools: Array<{ name?: string; function?: { name: string } }> }
        const names = body.tools.map((tool) => tool.name ?? tool.function?.name)
        requests++
        if (requests === 1) return response(api, 'discover_tools', { names: [prefix + 'runs.start'] })
        if (requests >= 3) {
          assert.ok(names.includes(encoded('runs.get')))
          assert.ok(names.includes(encoded('get')))
          assert.match(wire, /expected_revision/)
          assert.match(wire, /original-run/)
        }
        if (requests <= 4) return response(api, encoded('runs.start'), { client_request_id: 'same', script_id: 'original-script', version: 2 }, String(requests))
        assert.ok(names.includes(encoded('runs.start')), '提示模式不能隐藏原工具')
        assert.match(wire, /同类操作反复失败/)
        assert.equal((wire.match(/\[TERMOUS_EXECUTION_STATE\]/gu) ?? []).length, 1)
        if (requests === 5) return response(api, encoded('runs.get'), { run_id: 'original-run' })
        if (requests === 6) return response(api, encoded('get'), { script_id: 'original-script', version: 2 })
        assert.ok(names.includes(encoded('update')))
        assert.match(wire, /revision.{1,4}:6/)
        assert.match(wire, /number.{1,4}:2/)
        if (requests === 7) return response(api, encoded('update'), { script_id: 'original-script', expected_revision: 6, client_request_id: 'edit', name: '修复版本' })
        assert.equal(requests, 8)
        assert.match(wire, /revision.{1,4}:7/)
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      assert.deepEqual(called, ['runs.start', 'runs.start', 'runs.start', 'runs.get', 'get', 'update'].map((suffix) => prefix + suffix))
    } finally { agent.close(); await writer.close() }
  })
}


for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 通用生命周期把多个领域的后续声明送入真实下一请求`, async () => {
    for (const [submit, next, data] of [
      ['termous.commands.dispatch', 'termous.commands.get', { task: { id: 'task', status: 'running' } }],
      ['termous.files.transfers.upload', 'termous.files.transfers.get', { transfer: { id: 'transfer', status: 'running' } }],
      ['termous.remoteops.services.action', 'termous.remoteops.services.operations.get', { operation: { id: 'operation', phase: 'queued' } }],
      ['termous.remoteops.crontab.jobs.create', 'termous.remoteops.crontab.get', { mutation: { revision: 'revision' } }],
      ['termous.forwarding.instances.start', 'termous.forwarding.instances.get', { instance: { id: 'forward', status: 'connecting' } }],
      ['termous.snippets.create', 'termous.snippets.get', { snippet: { id: 'snippet' } }],
    ] as const) {
      const bootstrap = fixtureBootstrap(api)
      const executed: string[] = []
      const mapped = mapMCPTools([submit, next].map((name) => ({ name, inputSchema: { type: 'object' as const, properties: {} } })), async (definition) => {
        executed.push(definition.name)
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
      })
      const writer = new RuntimeEventWriter({
        start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
        runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
        core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
          appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
      })
      let requests = 0
      const encoded = (original: string) => mapped.tools.find((tool) => mapped.originalNames.get(tool.name) === original)!.name
      const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
        mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
        commitCheckpoint: async () => { throw new Error('不应压缩') }, fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
          requests++
          if (requests === 1) return response(api, 'discover_tools', { names: [submit] })
          if (requests === 2) return response(api, encoded(submit))
          assert.ok(body.tools.some((tool) => (tool.name ?? tool.function?.name) === encoded(next)), submit)
          assert.deepEqual(executed, [submit])
          return response(api)
        },
      })
      try { assert.equal(await agent.continue(), 'completed'); assert.equal(requests, 3) }
      finally { agent.close(); await writer.close() }
    }
  })
}

for (const api of ['responses', 'chat_completions'] as const) {
  test(`${api} 历史附着被门禁拒绝后立即提供当前会话查询入口，仍须重新核验和附着`, async () => {
    const bootstrap = fixtureBootstrap(api)
    bootstrap.model.snapshot.supports_images = true
    bootstrap.session.resource_bindings = [{ kind: 'desktop_session', session_id: 'current-session', connection_generation: 1,
      desktop_profile_id: 'profile', desktop_profile_name: '', host_id: 'host', host_name: '', protocol: 'vnc', bound_at: '2026-10-15T00:00:00Z' }]
    const executed: string[] = []
    const mapped = mapMCPTools(['termous.desktop_workflows.captures.create', 'termous.desktops.get', 'termous.desktops.attach'].map((name) => ({ name,
      inputSchema: { type: 'object' as const, properties: { session_id: { type: 'string' }, connection_generation: { type: 'integer' }, attachment_id: { type: 'string' } } },
    })), async (definition) => {
      executed.push(definition.name)
      const data = definition.name.endsWith('.get') ? { session: { id: 'current-session', profile_id: 'profile', host_id: 'host', protocol: 'vnc', status: 'ready', connection_generation: 1 } }
        : definition.name.endsWith('.attach') ? { attachment: { id: 'current-attachment', session_id: 'current-session', connection_generation: 1, state: 'ready' } }
          : { snapshot: { snapshot_id: 'created' } }
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => batch[batch.length - 1]!.sequence,
        appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    let requests = 0
    const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('不应压缩') }, fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
        const names = body.tools.map((tool) => tool.name ?? tool.function?.name)
        requests++
        if (requests === 1) return response(api, 'discover_tools', { names: ['termous.desktop_workflows.captures.create'] })
        if (requests === 2) return response(api, 'm_termous_ddesktop_uworkflows_dcaptures_dcreate', { attachment_id: 'historical-attachment' }, 'old')
        if (requests === 3) {
          assert.equal(executed.length, 0)
          assert.ok(names.includes('m_termous_ddesktops_dget'))
          assert.match(String(init?.body), /required_arguments/)
          return response(api, 'm_termous_ddesktops_dget', { session_id: 'current-session' })
        }
        if (requests === 4) return response(api, 'm_termous_ddesktops_dattach', { session_id: 'current-session', connection_generation: 1 })
        if (requests === 5) return response(api, 'm_termous_ddesktop_uworkflows_dcaptures_dcreate', { attachment_id: 'current-attachment' }, 'new')
        assert.equal(requests, 6)
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      assert.deepEqual(executed, ['termous.desktops.get', 'termous.desktops.attach', 'termous.desktop_workflows.captures.create'])
    } finally { agent.close(); await writer.close() }
  })
}

for (const api of ['responses', 'chat_completions'] as const) {
  for (const { code, phase } of ['desktop_input_uncertain', 'desktop_cleanup_uncertain'].flatMap((code) =>
    ['release', 'acquire'].map((phase) => ({ code, phase })))) {
    test(`${api} ${phase} 清理未确认 ${code}：阻止后续输入，允许只读查询和正常回复`, async () => {
      const bootstrap = fixtureBootstrap(api)
      const executed: string[] = []
      const errors: unknown[] = []
      const mapped = mapMCPTools([`control.${phase}`, 'get', 'keyboard.text'].map((name) => ({
        name: `termous.desktops.${name}`, description: name,
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
      })), async (definition) => {
        executed.push(definition.name)
        const failed = definition.name.endsWith(phase)
        const result = failed ? phase === 'acquire'
          ? { control: { approval: { state: 'dispatch_conflict', error_code: code } } }
          : { error: { code, retryable: false } } : { session: { state: 'connected' } }
        return { isError: failed && phase === 'release', content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }
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
            assert.ok(!names.includes(`m_termous_ddesktops_dcontrol_d${phase}`))
            assert.ok(!names.includes('m_termous_ddesktops_dkeyboard_dtext'))
            assert.ok(names.includes('m_termous_ddesktops_dget'))
          }
          if (requests === 1) return response(api, 'discover_tools', { names: [`termous.desktops.control.${phase}`, 'termous.desktops.get', 'termous.desktops.keyboard.text'] })
          if (requests === 2) return response(api, `m_termous_ddesktops_dcontrol_d${phase}`)
          if (requests === 3) return response(api, 'm_termous_ddesktops_dkeyboard_dtext')
          if (requests === 4) return response(api, 'm_termous_ddesktops_dget')
          assert.equal(requests, 5)
          return response(api)
        },
      })
      try {
        assert.equal(await agent.continue(), 'completed')
        await writer.flush()
        assert.deepEqual(executed, [`termous.desktops.control.${phase}`, 'termous.desktops.get'])
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
  test(`${api} 重复 Skill 只提示，声明始终保留且业务可继续`, async () => {
    const base = testAgentSkillBundle()
    const content = '需要查询时使用 termous.desktops.get。缺少工具时先发现，不重复读取。'
    const resource = { ...base.resources[0]!, uri: 'skill://termous-remote-desktop/SKILL.md', content, size: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }
    const nextContent = '另一份资源的独立规则。'
    const nextResource = { ...resource, uri: resource.uri.replace('/SKILL.md', '/references/next.md'), content: nextContent,
      size: Buffer.byteLength(nextContent), sha256: createHash('sha256').update(nextContent).digest('hex') }
    const skills = createAgentSkillBundleSnapshot([{ name: 'termous-remote-desktop', description: '桌面观察', entry_uri: resource.uri }], [resource, nextResource])
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
          assert.ok(names.includes('read_skill_resource'))
          assert.ok(names.includes('discover_tools'))
          assert.ok(names.includes('m_termous_ddesktops_dget'))
          return response(api, 'discover_tools', { names: ['read_skill_resource'] })
        }
        if (requests === 5) {
          assert.ok(names.includes('read_skill_resource'))
          return response(api, 'read_skill_resource', { uri: resource.uri, refresh: true })
        }
        if (requests === 6) {
          assert.ok(names.includes('read_skill_resource'))
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

for (const api of ['responses', 'chat_completions'] as const) for (const supported of [false, true]) {
  test(`${api} 重复截图只提示，显式发现后才加载固定帧；旧 Core 兼容=${!supported}`, async () => {
    const bootstrap = fixtureBootstrap(api)
    bootstrap.context.progress_supported = supported
    bootstrap.context.request_usage_supported = true
    const content = '# 固定模板流程\n使用 snapshot_id 创建并确认模板。'
    const uri = 'skill://termous-desktop-workflows/references/templates.md'
    const rootURI = 'skill://termous-desktop-workflows/SKILL.md'
    const resource = { uri, content, sha256: createHash('sha256').update(content).digest('hex'), size: Buffer.byteLength(content), media_type: 'text/markdown; charset=utf-8' as const }
    const skills = createAgentSkillBundleSnapshot([{ name: 'termous-desktop-workflows', description: '脚本流程', entry_uri: rootURI }], [resource, { ...resource, uri: rootURI }])
    bootstrap.model.snapshot.supports_images = true
    const events: Array<{ kind: string; payload: Record<string, unknown> }> = []
    const calls: string[] = []
    const mapped = mapMCPTools(['termous.desktops.capture', 'termous.desktop_workflows.captures.create'].map((name) => ({
      name, description: name, annotations: { readOnlyHint: name === 'termous.desktops.capture' },
      inputSchema: { type: 'object' as const, properties: { attachment_id: { type: 'string' } } },
    })), async (definition) => {
      calls.push(definition.name)
      const data = definition.name === 'termous.desktops.capture' ? { capture: { screenshot_id: `shot-${calls.length}`, expires_at: calls.length, metadata: { connection_generation: 1, frame_sequence: calls.length } } } : { snapshot: { snapshot_id: 'snapshot-new' } }
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
    })
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => { events.push(...batch); return batch[batch.length - 1]!.sequence },
        appendSteer: async () => { throw new Error('不应追加消息') }, commitCheckpoint: async () => { throw new Error('循环不能触发压缩') } },
    })
    let requests = 0
    const capture = 'm_termous_ddesktops_dcapture'
    const create = 'm_termous_ddesktop_uworkflows_dcaptures_dcreate'
    const agent = createPiAgent({ bootstrap, events: writer, skills,
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      commitCheckpoint: async () => { throw new Error('循环不能触发压缩') },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
        const names = body.tools.map((tool) => tool.name ?? tool.function?.name)
        requests++
        if (requests === 1) return response(api, 'discover_tools', { names: ['termous.desktops.capture'] })
        if (requests >= 3) {
          assert.equal(names.includes(create), requests >= 7)
          assert.equal((String(init?.body).match(/\[TERMOUS_EXECUTION_STATE\]/gu) ?? []).length, 1)
        }
        if (requests >= 5) {
          assert.ok(names.includes(capture))
          assert.match(String(init?.body), /同一观察反复返回相同有效信息/)
        }
        if (requests <= 5) return response(api, capture, { attachment_id: 'current' }, String(requests))
        if (requests === 6) return response(api, 'discover_tools', { names: ['termous.desktop_workflows.captures.create'] })
        assert.match(String(init?.body), /固定模板流程/)
        if (requests === 7) return response(api, create, { attachment_id: 'current' })
        assert.equal(requests, 8)
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      await writer.flush()
      assert.equal(calls.filter((name) => name === 'termous.desktops.capture').length, 4)
      assert.equal(calls[calls.length - 1], 'termous.desktop_workflows.captures.create')
      assert.deepEqual(events.filter((event) => event.kind === 'progress').map((event) => (event.payload.progress as { status: string }).status), supported ? ['detected', 'progressed'] : [])
      const usage = events.filter((event) => event.kind === 'request_usage').slice(-1)[0]!.payload.request_usage as Record<string, unknown>
      assert.equal(Array.isArray(usage.effective_tools), supported)
      assert.equal(events.some((event) => event.kind === 'compaction'), false)
    } finally { agent.close(); await writer.close() }
  })
}
