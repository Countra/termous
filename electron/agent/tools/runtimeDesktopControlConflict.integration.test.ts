import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { RuntimeAuditEvent, RuntimeEventInput } from '../contracts/runtimeEvents.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { createPiAgent } from '../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import { RuntimeAuditWriter } from '../runtime/runtimeAuditWriter.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../test-support/runtimeToolResponseFixture.ts'
import { mapMCPTools } from './mcpClientAdapter.ts'

const acquire = 'termous.desktops.control.acquire'
const get = 'termous.desktops.get'
const input = 'termous.desktops.keyboard.text'
const release = 'termous.desktops.control.release'
const attachment = { id: 'a', session_id: 's', connection_generation: 1, execution_generation: 1, state: 'ready' }
const grant = { id: 'g', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' }

for (const { api, firstAttempt } of (['responses', 'chat_completions'] as const).flatMap((api) => [false, true].map((firstAttempt) => ({ api, firstAttempt })))) {
  test(`${api} ${firstAttempt ? '已知占用时首次接管无需失败试探' : '真实审批冲突同时影响下一请求、时间线和持久结果，授权后恢复且不中断普通调用'}`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = api
    bootstrap.model.snapshot.context_window_tokens = 65536
    bootstrap.context.progress_supported = true
    bootstrap.messages = [runtimeUserMessage([], { text: firstAttempt ? '允许接管指定桌面的当前控制入口并输入目标应用名称。' : '在指定桌面输入目标应用名称。' })]
    const executed: string[] = []
    let acquires = 0
    const mapped = mapMCPTools([acquire, get, input, release].map((name) => ({ name,
      inputSchema: { type: 'object' as const, properties: {} }, annotations: { readOnlyHint: name === get },
    })), async (tool, args) => {
      executed.push(tool.name)
      if (firstAttempt && tool.name === acquire) assert.deepEqual(args, { attachment_id: 'a', client_request_id: 'takeover', takeover: true })
      const data = tool.name === get ? { attachment: { ...attachment, ...(firstAttempt ? { control: { state: 'takeover_required', reason: 'control_occupied' } } : {}) } }
        : tool.name === acquire ? ++acquires < (firstAttempt ? 1 : 4)
          ? { control: { approval: { state: 'dispatch_conflict', error_code: 'desktop_control_locked' } } }
          : { control: { attachment: { ...attachment, grant }, approval: { state: 'approved' } } }
          : tool.name === release ? { completed: true } : { operation: { client_request_id: 'input', state: 'accepted' } }
      // Core 既有审批合同返回正常 MCP 信封，领域失败藏在 control.approval 中。
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false }
    })
    const skills = testAgentSkillBundle()
    const events: RuntimeEventInput[] = []
    const audits: RuntimeAuditEvent[] = []
    const audit = new RuntimeAuditWriter({ originalName: (name) => mapped.originalNames.get(name) ?? null,
      submit: async (batch) => { audits.push(...batch) } })
    const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
      core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: (error) => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {}, appendEvents: async (_start, _bearer, batch) => {
        events.push(...batch)
        return batch[batch.length - 1]!.sequence
      }, appendSteer: async () => { throw new Error('不追加指令') }, commitCheckpoint: async () => { throw new Error('不应压缩') } },
    })
    const plan = [
      { name: 'discover_tools', args: { names: [get, acquire] } },
      { name: get, args: { attachment_id: 'a' } },
      { name: acquire, args: { attachment_id: 'a', client_request_id: 'first' } },
      { name: get, args: { attachment_id: 'a' } },
      { name: acquire, args: { attachment_id: 'a', client_request_id: 'second' } },
      { name: get, args: { attachment_id: 'a' } },
      { name: acquire, args: { attachment_id: 'a', client_request_id: 'second' } },
      { name: acquire, args: { attachment_id: 'a', client_request_id: 'takeover', takeover: true } },
      { name: input, args: { attachment_id: 'a', grant_id: 'g', client_request_id: 'input', text: '目标应用' } },
      { name: release, args: { attachment_id: 'a', grant_id: 'g', client_request_id: 'release' } },
    ]
    if (firstAttempt) plan.splice(2, 6, { name: acquire, args: { attachment_id: 'a', client_request_id: 'takeover', takeover: true } })
    const requests: Array<{ names: string[]; summary: string }> = []
    const agent = createPiAgent({ bootstrap, events: writer, skills, audit,
      commitCheckpoint: async () => { throw new Error('不应压缩') },
      mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body))
        const text = (body.messages ?? body.input).map((message: { content: unknown }) =>
          typeof message.content === 'string' ? message.content : Array.isArray(message.content)
            ? message.content.map((part: { text?: string }) => part.text ?? '').join('\n') : '').join('\n')
        const summary = text.includes('[TERMOUS_EXECUTION_STATE]')
          ? text.slice(text.lastIndexOf('[TERMOUS_EXECUTION_STATE]')).split('[/TERMOUS_EXECUTION_STATE]')[0]! : ''
        const step = plan[requests.length]
        if (firstAttempt && requests.length === 2) assert.match(JSON.stringify(body.tools), /调用前：.*takeover_required.*takeover=true/)
        requests.push({ names: body.tools.map((tool: { name?: string; function?: { name: string } }) => tool.name ?? tool.function!.name), summary })
        return step ? response(api, step.name === 'discover_tools' ? step.name : encodeMCPToolName(step.name), step.args, String(requests.length)) : response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      await writer.flush()
      await audit.flush()
      assert.deepEqual(executed, plan.slice(1).map((step) => step.name))
      if (firstAttempt) {
        assert.equal(acquires, 1)
        assert.match(requests[2]!.summary, /"control_status":"takeover_required"/)
        assert.match(requests[3]!.summary, /"grant_status":"held"/)
        assert.equal(events.filter((event) => event.kind === 'tool_failed').length, 0)
        return
      }
      assert.match(requests[3]!.summary, /desktop_control_locked/)
      assert.match(requests[7]!.summary, /"status":"detected"/)
      assert.ok(!requests[7]!.names.includes(encodeMCPToolName(input)))
      assert.ok(requests[8]!.names.includes(encodeMCPToolName(input)))
      assert.match(requests[8]!.summary, /"grant_status":"held"/)
      assert.doesNotMatch(requests[8]!.summary, /desktop_control_locked|"status":"detected"/)
      const failed = events.filter((event) => event.kind === 'tool_failed')
      assert.equal(failed.length, 3)
      assert.ok(failed.every((event) => (event.payload.tool as { tool_name: string }).tool_name === acquire))
      const persisted = events.filter((event) => event.kind === 'message_part').map((event) =>
        (event.payload.message_part as { content: { tool_result?: { tool_name: string; is_error: boolean } } }).content.tool_result)
        .filter((result) => result?.tool_name === acquire)
      assert.deepEqual(persisted.map((result) => result!.is_error), [true, true, true, false])
      const notices = events.filter((event) => event.kind === 'progress').map((event) =>
        event.payload.progress as { pattern_id: string; status: string; tool_name: string })
      assert.deepEqual(notices.map((notice) => notice.status), ['detected', 'progressed'])
      assert.equal(notices[0]!.pattern_id, notices[1]!.pattern_id)
      assert.equal(notices[0]!.tool_name, acquire)
      const failures = audits.filter((event) => event.phase === 'end' && event.outcome === 'failed')
      assert.equal(failures.length, 3)
      assert.ok(failures.every((event) => (event.result?.error as { code: string }).code === 'desktop_control_locked'))
    } finally { agent.close(); await writer.close(); await audit.close() }
  })
}
