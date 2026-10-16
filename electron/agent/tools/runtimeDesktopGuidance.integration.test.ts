import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { createPiAgent } from '../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../test-support/runtimeToolResponseFixture.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { isRuntimeContextCheckpoint } from '../contracts/runtimeCheckpoint.ts'

const acquire = 'termous.desktops.control.acquire'
const get = 'termous.desktops.get'
const release = 'termous.desktops.control.release'
const inputNames = ['keyboard.shortcut', 'keyboard.key', 'keyboard.text', 'pointer.click', 'pointer.scroll'].map((name) => `termous.desktops.${name}`)
const encode = (name: string) => `m_${name.replace(/_/gu, '_u').replace(/\./gu, '_d')}`
const attachment = { id: 'a', session_id: 's', connection_generation: 1, execution_generation: 2, state: 'ready',
  grant: { id: 'g', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' } }
const args = { attachment_id: 'a', grant_id: 'g' }

for (const api of ['responses', 'chat_completions'] as const) {
  for (const scenario of ['grant', 'pending', 'rejected', 'no-grant', 'expired', 'already-held', 'locked', 'history', 'compaction', 'session-changed'] as const) {
    test(`${api} ${scenario} 的真实请求声明和执行摘要准确，连续普通选择仍可执行`, async () => {
      const bootstrap = runtimeBootstrap()
      bootstrap.model.snapshot.api_mode = api
      bootstrap.model.snapshot.context_window_tokens = 65536
      bootstrap.context.progress_supported = true
      bootstrap.messages = [runtimeUserMessage([], { text: '在桌面输入目标应用名称。' })]
      if (scenario === 'compaction') {
        bootstrap.model.snapshot.context_window_tokens = 16384
        bootstrap.messages.unshift({ ...runtimeUserMessage([], { text: '历史观察记录。'.repeat(2000) }), id: 'old-user' },
          { id: 'old-assistant', role: 'assistant', sequence: 2, status: 'completed', created_at: '2026-10-15T00:00:00Z', attachments: [],
            parts: [{ id: 'old-part', message_id: 'old-assistant', kind: 'text', sequence: 1, content: { text: { text: '旧记录已检查。'.repeat(2000) } } }] })
      }
      const executed: string[] = []
      const receipt = () => scenario === 'pending' || scenario === 'rejected' ? { control: { attachment, approval: { state: scenario } } }
        : scenario === 'no-grant' ? { control: { attachment: { ...attachment, grant: undefined } } }
          : scenario === 'expired' ? { control: { attachment: { ...attachment, grant: { ...attachment.grant, expires_at: '2000-01-01T00:00:00Z' } } } }
            : scenario === 'already-held' || scenario === 'locked' ? { error: { code: scenario === 'already-held' ? 'desktop_control_already_held' : 'desktop_control_locked' } }
              : { control: { attachment } }
      if (scenario === 'history') {
        const previous = new RuntimeToolProgress()
        for (let i = 0; i < 6; i++) previous.observe(acquire, args, { content: [{ type: 'text', text: JSON.stringify(receipt()) }],
          details: { kind: 'mcp', originalToolName: acquire, result: { content: [], structuredContent: receipt() } } }, false)
        // Worker 重启读取持久检查点；真实历史正文仍保留，计数不继承。
        bootstrap.context.checkpoint = { id: 'checkpoint', version: 2, generation: 1, run_id: bootstrap.run.id,
          boundary_message_sequence: 0, covered_event_sequence: 0, estimated_tokens: 100, image_sources: [],
          summary: '历史曾反复申请控制权，尚未操作目标应用。', retained_tail: [], details: { execution_progress: previous.snapshot() } }
      }
      const mapped = mapMCPTools([acquire, get, release, ...inputNames].map((name) => ({ name,
        inputSchema: { type: 'object' as const, properties: {} } })), async (definition) => {
        executed.push(definition.name)
        const data = definition.name === acquire ? receipt() : definition.name === get ? scenario === 'session-changed'
          ? { session: { id: 's', status: 'ready', connection_generation: 2 } } : { attachment }
          : definition.name === release ? { completed: true } : { operation: { client_request_id: 'input', state: 'accepted' } }
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: 'error' in data }
      })
      const skills = testAgentSkillBundle()
      const notices: unknown[] = []
      const failures: unknown[] = []
      const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
        core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
        runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
        core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => {
          notices.push(...batch.filter((event) => event.kind === 'progress'))
          failures.push(...batch.filter((event) => event.kind === 'error'))
          return batch[batch.length - 1]!.sequence
        }, appendSteer: async () => { throw new Error('不追加指令') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
      })
      const requests: Array<{ names: string[]; summary: string }> = []
      const granted = scenario === 'grant' || scenario === 'history' || scenario === 'compaction' || scenario === 'session-changed'
      let compactions = 0
      let heldAtCompaction = false
      const agent = createPiAgent({ bootstrap, events: writer, skills,
        mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
        commitCheckpoint: async (input) => {
          assert.equal(scenario, 'compaction')
          compactions++
          heldAtCompaction ||= JSON.stringify(input.details).includes('"grant_status":"held"')
          const checkpoint = { id: 'checkpoint', version: 2, boundary_message_sequence: 0,
            summary: input.summary, retained_tail: input.retained_tail, estimated_tokens: input.tokens_after, image_sources: [],
            run_id: bootstrap.run.id, generation: 1, covered_event_sequence: input.covered_event_sequence, details: input.details }
          assert.ok(isRuntimeContextCheckpoint(checkpoint))
          return { last_sequence: input.sequence, checkpoint }
        }, fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body))
          if (!body.tools?.length) return response(api)
          const messages = body.messages ?? body.input
          const text = messages.map((message: { content: unknown }) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')
          // 只检查模型请求中的补充摘要，避免历史原始回执的 held 字样影响判断。
          const summary = text.slice(text.lastIndexOf('[TERMOUS_EXECUTION_STATE]')).split('[/TERMOUS_EXECUTION_STATE]')[0]!
          requests.push({ names: body.tools.map((tool: { name?: string; function?: { name: string } }) => tool.name ?? tool.function!.name), summary })
          const index = requests.length
          if (index === 1) return response(api, 'discover_tools', { names: scenario === 'session-changed' ? [acquire, get] : [acquire] })
          if (index === 2 || granted && index <= 5) {
            const result = response(api, encode(acquire), { ...args, client_request_id: String(index) }, String(index))
            return scenario === 'compaction' && index === 3 ? withUsage(result, api, 14000) : result
          }
          if (scenario === 'session-changed' && index === 6) return response(api, encode(get), { session_id: 's' })
          if (granted && index === 6) return response(api, encode(inputNames[2]!), { ...args, text: '应用名称' })
          if (scenario === 'session-changed') return response(api)
          if (granted && index === 7) return response(api, encode(release), args)
          return response(api)
        },
      })
      try {
        const outcome = await agent.continue()
        await writer.flush()
        assert.equal(outcome, 'completed', JSON.stringify(failures))
        for (const name of inputNames) assert.equal(requests[2]!.names.includes(encode(name)), granted, name)
        if (granted) {
          assert.equal(executed.filter((name) => name === acquire).length, 4)
          assert.ok(requests[5]!.names.includes(encode(acquire)))
          assert.match(requests[5]!.summary, /重复取得相同前置状态/)
          const final = requests[requests.length - 1]!.summary
          assert.match(final, scenario === 'session-changed' ? /needs_verification/ : /released/)
          assert.doesNotMatch(final, /grant_status.{1,5}held/)
          assert.equal(notices.length, 1)
        } else {
          assert.doesNotMatch(requests[2]!.summary, /grant_status.{1,5}held/)
          assert.equal(requests[2]!.names.includes(encode(get)), scenario !== 'rejected')
        }
        if (scenario === 'history') {
          assert.match(requests[0]!.summary, /historical/)
          assert.match(requests[0]!.summary, /needs_verification/)
          assert.doesNotMatch(requests[2]!.summary, /"origin":"historical"/)
        }
        if (scenario === 'compaction') {
          assert.ok(compactions > 0)
          assert.ok(heldAtCompaction, '至少一次压缩发生在本轮已取得 grant 后')
          assert.match(requests[3]!.summary, /grant_status.{1,5}held/)
          assert.doesNotMatch(requests[3]!.summary, /historical.{1,5}"/)
        }
      } finally { agent.close(); await writer.close() }
    })
  }
}

async function withUsage(response: Response, api: string, tokens: number) {
  const text = (await response.text()).split('\n').map((line) => {
    if (!line.startsWith('data: {')) return line
    const event = JSON.parse(line.slice(6))
    if (api === 'chat_completions') event.usage = { prompt_tokens: tokens, completion_tokens: 1, total_tokens: tokens + 1 }
    else if (event.type === 'response.completed') event.response.usage = { input_tokens: tokens, output_tokens: 1, total_tokens: tokens + 1 }
    return `data: ${JSON.stringify(event)}`
  }).join('\n')
  return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
}
