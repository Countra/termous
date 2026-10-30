import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import { agentRuntimeProtocolVersion, defaultExecutionBudget } from '#common/contracts'
import { createPiAgent } from '../runtime/piAgentAdapter.ts'
import { RuntimeEventWriter } from '../runtime/runtimeEventWriter.ts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { runtimeToolResponse as response } from '../test-support/runtimeToolResponseFixture.ts'
import { attachLocalTools } from '../worker/localTools.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import type { LocalToolContext } from '../contracts/localTools.ts'

const read = 'termous.local.files.read'
const execute = 'termous.local.commands.execute'
const context: LocalToolContext = {
  directory: { path: 'C:\\work', revision: 1, managed: false },
  environment: { platform: 'windows', default_shell: 'powershell', shells: [] },
  tools: {
    [read]: { description: 'Read a regular local file', inputSchema: Type.Object({ path: Type.String() }) },
    [execute]: { description: 'Execute an approved local command', inputSchema: Type.Object({ command: Type.String() }) },
  },
}
const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object'
  ? Object.values(value).flatMap(strings) : []

for (const api of ['responses', 'chat_completions'] as const) for (const preloaded of [true, false]) {
  test(`${api} 本地纠错声明跨目录刷新及 10 轮续跑保持一致，预加载=${preloaded}`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.local_tools = context
    bootstrap.model.snapshot.api_mode = api
    bootstrap.model.snapshot.context_window_tokens = 128000
    bootstrap.model.snapshot.execution_budget = { ...defaultExecutionBudget, enabled: false }
    bootstrap.messages = [runtimeUserMessage([], { text: '查看本地目录，随后读取配置文件。' })]
    let refresh = false
    const calls: string[] = []
    const mcp = attachLocalTools({ tools: [], originalName: () => null, close: async () => {},
      refreshTools: async () => { if (!refresh) return undefined; refresh = false; return { removed: [], tools: [] } },
    }, context, async input => {
      calls.push(input.tool)
      if (input.tool === execute) return { state: 'completed', value: { task: { id: 'task', status: 'completed', exit_code: 0 } } }
      if (calls.length <= 3) {
        refresh = true
        return { error: { code: 'LOCAL_PATH_IS_DIRECTORY', message: '目标是目录', details: { path: 'C:\\work\\target', actual_type: 'directory' } } }
      }
      return { path: 'C:\\work\\file.txt', text: `configuration ${calls.length}`, next_offset: 16 }
    })
    const skills = testAgentSkillBundle()
    const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
      core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 0, onFailure: error => { throw error },
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => batch.at(-1)!.sequence,
        appendSteer: async () => { throw new Error('不应追加指令') }, commitCheckpoint: async () => { throw new Error('不应触发压缩') } },
    })
    const requests: Array<{ names: string[]; text: string }> = []
    const agent = createPiAgent({ bootstrap, skills, events: writer, mcp,
      ...(preloaded ? { lookupPreparedCall: async () => undefined } : {}),
      commitCheckpoint: async () => { throw new Error('不应触发压缩') },
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { tools: Array<{ name?: string; function?: { name: string } }> }
        requests.push({ names: body.tools.map(tool => tool.name ?? tool.function!.name), text: strings(body).join('\n') })
        if (!preloaded && requests.length === 1) return response(api, 'discover_tools', { source: 'local', names: [read] }, 'discover')
        if (calls.length < 3) return response(api, encodeMCPToolName(read), { path: 'target' }, String(requests.length))
        if (calls.length === 3) return response(api, encodeMCPToolName(execute), { command: "Get-ChildItem -LiteralPath 'C:\\work\\target'" }, 'command')
        if (calls.length < 12) return response(api, encodeMCPToolName(read), { path: 'file.txt' }, String(requests.length))
        return response(api)
      },
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      assert.equal(calls.length, 12)
      assert.equal(calls.filter(name => name === execute).length, 1)
      const afterError = requests[preloaded ? 1 : 2]!
      assert(afterError.names.includes(encodeMCPToolName(execute)))
      assert.match(afterError.text, /"name":"m_termous_dlocal_dcommands_dexecute","source":"local","status":"declared"/u)
      assert.match(afterError.text, /older token error does not explain/u)
      assert.equal((afterError.text.match(/\[TERMOUS_EXECUTION_STATE\]/gu) ?? []).length, 1)
      assert(requests.at(-1)!.names.includes(encodeMCPToolName(execute)))
      assert(requests.every(request => request.names.length <= 32))
    } finally { agent.close(); await writer.close() }
  })
}
