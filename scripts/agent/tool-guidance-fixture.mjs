import { mapMCPTools } from '../../electron/agent/tools/mcpClientAdapter.ts'
import { runtimeUserMessage } from '../../electron/agent/test-support/runtimeBootstrapTestFixture.ts'

const prefix = 'termous.desktops.'
const string = { type: 'string' }
const properties = { attachment_id: string, session_id: string, connection_generation: { type: 'integer' }, grant_id: string,
  client_request_id: string, wait_ms: { type: 'integer' }, takeover: { type: 'boolean' }, text: string,
  codes: { type: 'array', items: string }, code: string, screenshot_id: string, x: { type: 'integer' }, y: { type: 'integer' },
  button: string, count: { type: 'integer' }, delta: { type: 'integer' } }
const definitions = [
  ['list', [], '列出现有桌面连接。'], ['get', [], '查询会话或观察附着状态。'],
  ['attach', ['session_id', 'connection_generation'], '为已有会话建立本轮观察附着。'],
  ['control.acquire', ['attachment_id', 'client_request_id'], '申请键盘鼠标控制权。'],
  ['control.release', ['attachment_id', 'grant_id'], '归还当前控制权。'],
  ['capture', ['attachment_id'], '观察当前桌面。'],
  ['keyboard.shortcut', ['attachment_id', 'grant_id', 'client_request_id', 'codes'], '发送组合键。'],
  ['keyboard.key', ['attachment_id', 'grant_id', 'client_request_id', 'code'], '发送单个按键。'],
  ['keyboard.text', ['attachment_id', 'grant_id', 'client_request_id', 'text'], '向当前焦点输入文本。'],
  ['pointer.click', ['attachment_id', 'grant_id', 'client_request_id', 'screenshot_id', 'x', 'y'], '点击桌面坐标。'],
  ['pointer.scroll', ['attachment_id', 'grant_id', 'client_request_id', 'screenshot_id', 'delta'], '滚动桌面。'],
  ['clipboard.set_text', ['attachment_id', 'grant_id', 'client_request_id', 'text'], '只修改远端剪贴板文本，不输入到应用。'],
  ['operations.get', ['attachment_id', 'client_request_id'], '查询原输入操作的协议回执。'],
  ['detach', ['attachment_id'], '移除观察附着。'],
]

// 纯本地状态夹具，不连接真实桌面；成功只代表 Agent 选择了合适操作。
export function guidanceFixture(scenario, onCall, now = Date.now) {
  let attached = false, grant, generation = 0, input = false
  const operations = new Map()
  const session = { id: 'synthetic-session', status: 'ready', connection_generation: 1, protocol: 'rdp' }
  const attachment = () => ({ id: 'synthetic-attachment', session_id: session.id, state: 'ready', connection_generation: 1, execution_generation: 1, ...(grant ? { grant } : {}) })
  const mapped = mapMCPTools(definitions.map(([name, required, description]) => ({ name: prefix + name, description,
    annotations: { readOnlyHint: ['list', 'get', 'capture', 'operations.get'].includes(name) },
    inputSchema: { type: 'object', properties: Object.fromEntries([...new Set([...required,
      ...(name === 'get' ? ['session_id', 'attachment_id', 'wait_ms'] : name === 'attach' ? ['client_request_id'] : name === 'control.acquire' ? ['takeover'] : [])])]
      .map((field) => [field, properties[field]])), required, additionalProperties: false } })), async (definition, args) => {
    const name = definition.name.slice(prefix.length)
    let data, effectiveInput = false
    if (grant && [grant.expires_at, grant.idle_expires_at].some((value) => Date.parse(value) <= now())) grant = undefined
    if (name === 'list') data = { sessions: [session] }
    else if (name === 'get') data = args.attachment_id ? attached && args.attachment_id === 'synthetic-attachment'
      ? { attachment: attachment() } : { error: { code: 'desktop_not_found' } }
      : args.session_id === session.id ? { session } : { error: { code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND' } }
    else if (name === 'attach') {
      if (args.session_id !== session.id) data = { error: { code: 'REMOTE_DESKTOP_SESSION_NOT_FOUND' } }
      else if (args.connection_generation !== session.connection_generation) data = { error: { code: 'desktop_generation_stale' } }
      else { attached = true; data = { attachment: attachment() } }
    }
    else if (!attached || args.attachment_id !== 'synthetic-attachment') data = { error: { code: 'desktop_not_found' } }
    else if (name === 'control.acquire') {
      if (grant) data = { error: { code: 'desktop_control_already_held' } }
      else {
        generation++; operations.clear()
        grant = { id: `synthetic-grant-${generation}`, expires_at: new Date(now() + 1800000).toISOString(), idle_expires_at: new Date(now() + 900000).toISOString() }
        data = { control: { attachment: attachment() } }
      }
    } else if (name === 'control.release') {
      if (!grant || args.grant_id !== grant.id) data = { error: { code: 'desktop_control_stale' } }
      else { grant = undefined; data = { completed: true } }
    } else if (name === 'detach') { attached = false; grant = undefined; data = { completed: true } }
    else if (name === 'capture') data = { capture: { screenshot_id: 'synthetic-shot', metadata: { connection_generation: 1, execution_generation: 1 } }, observation: input ? '合成文本框已收到文本' : '合成文本框已聚焦，等待文本' }
    else if (name === 'operations.get') data = operations.has(args.client_request_id)
      ? { operation: operations.get(args.client_request_id) } : { error: { code: 'desktop_not_found' } }
    else if (!grant || args.grant_id !== grant.id) data = { error: { code: 'desktop_control_stale' } }
    else {
      effectiveInput = (scenario === 'discover' ? name === 'clipboard.set_text' : name === 'keyboard.text') && args.text === 'Termous 验收'
      input ||= effectiveInput
      data = { operation: { client_request_id: args.client_request_id, state: 'completed' } }
      operations.set(args.client_request_id, data.operation)
    }
    onCall({ name: definition.name, error: data.error?.code, input: effectiveInput })
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: Boolean(data.error) }
  })
  return { mcp: { tools: mapped.tools, originalName: (name) => mapped.originalNames.get(name) ?? null, close: async () => {} }, success: () => input && !grant }
}

export function guidanceMessages(scenario) {
  const goal = scenario === 'discover' ? '把 Termous 验收 写入远端剪贴板，不要输入到应用。' : '在桌面当前已聚焦的文本框输入 Termous 验收。'
  const prompt = `这是本地合成桌面验收，目标是现有的 synthetic-session，会话连接代次为 1。${goal}无需重新连接。完成实际操作后归还控制权，简要报告。`
  const current = runtimeUserMessage([], { text: prompt })
  if (scenario === 'compaction') {
    // 较早的完整轮次可被真实压缩；当前任务与工具调用组继续保留。
    const history = Array.from({ length: 4 }, (_, turn) => {
      const trace = Array.from({ length: 1000 }, (_, index) => `Synthetic observation ${turn}-${index}: unchanged; no input.`).join('\n')
      return [{ ...runtimeUserMessage([], { text: '整理上一轮合成观察日志。' }), id: `old-user-${turn}`, sequence: turn * 2 + 1 },
        { id: `old-message-${turn}`, role: 'assistant', status: 'completed', sequence: turn * 2 + 2, created_at: '2026-10-15T00:00:00Z', attachments: [],
          parts: [{ id: `old-part-${turn}`, message_id: `old-message-${turn}`, kind: 'text', sequence: 1, content: { text: { text: trace } } }] }]
    }).flat()
    return [...history, { ...current, sequence: 9 }]
  }
  if (scenario !== 'history') return [current]
  const parts = []
  for (let index = 0; index < 3; index++) for (const name of ['control.acquire', 'control.release']) {
    const id = `old-${index}-${name}`
    const args = { attachment_id: 'old-attachment', grant_id: 'old-grant', client_request_id: id }
    const data = name === 'control.acquire' ? { control: { attachment: { id: 'old-attachment', session_id: 'synthetic-session', state: 'ready',
      connection_generation: 1, execution_generation: 1, grant: { id: 'old-grant', expires_at: '2099-01-01T00:00:00Z', idle_expires_at: '2099-01-01T00:00:00Z' } } } } : { completed: true }
    for (const [kind, value] of [['tool_call', { tool_call_id: id, tool_name: prefix + name, arguments: args }],
      ['tool_result', { tool_call_id: id, tool_name: prefix + name, content: [{ type: 'text', text: JSON.stringify(data) }], is_error: false }]]) {
      parts.push({ id: `part-${parts.length}`, message_id: 'old-message', kind, sequence: parts.length + 1, content: { [kind]: value } })
    }
  }
  return [{ ...current, id: 'old-user' }, { id: 'old-message', role: 'assistant', status: 'completed', sequence: 2,
    created_at: '2026-10-15T00:00:00Z', attachments: [], parts }, { ...current, sequence: 3 }]
}
