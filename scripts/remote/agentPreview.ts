import type { AgentRequest } from '@termous/remote-protocol/agent'
import { AgentQuery_Kind as Q } from '@termous/remote-protocol/agent'
import { agentRunFixture } from '../../src/features/agent-runtime/model/agentRuntimeTestFixtures'

// 只服务隔离验收入口，使用真实协议解码器与界面；不连接模型或读取账号数据。
export function createAgentPreview(english: boolean, changed: () => void) {
  const now = new Date().toISOString()
  const dates = { created_at: now, updated_at: now }
  const session = { id: 'ags-session', title: english ? 'Review deployment' : '检查部署状态', model_id: 'apm-1', reasoning_level: 'medium', origin: 'remote', creator_device_id: 'controller', revision: 1, resource_bindings: [], ...dates }
  const settings = { default_model_id: 'apm-1', default_reasoning_level: 'medium', global_context_window_tokens: 32768, global_max_output_tokens: 4096, max_concurrent_runs: 4, show_turn_token_usage: true, revision: 1, context_compaction_threshold_percent: 80, ...dates }
  const component = { status: 'ready', message: '' }
  const readiness = { status: 'ready', mcp_runtime: component, mcp_client: component, skills_bundle: component, default_model: component, settings, mcp_policy: { client_id: 'builtin-ai', approval_bypass: false, scope_count: 29, required_scope_count: 29, scope_sync_required: false, revision: 1 } }
  const model = { id: 'apm-1', provider_id: 'apv-1', remote_model_id: 'fixture', display_name: 'Fixture AI', availability: 'available', source: 'sync', parameter_mode: 'custom', context_window_tokens: 32768, max_output_tokens: 4096, default_reasoning_level: 'medium', reasoning_control: 'openai_effort', supported_reasoning_levels: ['off', 'medium', 'high'], supports_images: true, supports_reasoning: true, capabilities_confirmed: true, effective_context_window_tokens: 32768, effective_max_output_tokens: 4096, effective_default_reasoning_level: 'medium', first_seen_at: now, last_seen_at: now, revision: 1, ...dates }
  const provider = { id: 'apv-1', name: 'Fixture AI', api_mode: 'responses', base_url: 'https://example.test/v1', enabled: true, api_key_configured: true, refresh_status: 'ready', revision: 1, ...dates }
  const message = (id: string, role: string, content: string, sequence: number) => ({ id, role, session_id: session.id, status: 'completed', sequence, revision: 1, ...dates, attachments: [], parts: [{ id: `part-${id}`, message_id: id, kind: 'text', sequence: 1, revision: 1, content: { text: { text: content } }, ...dates }] })
  const messages = [message('user', 'user', english ? 'Check the release status.' : '检查当前版本的发布状态。', 1), message('answer', 'assistant', english ? 'The service is healthy.\n\n- Deployment checks passed\n- No pending migrations\n\nThe next operation needs your approval.' : '服务运行正常。\n\n- 部署检查通过\n- 没有待执行的迁移\n\n下一项操作需要你的批准。', 2)]
  let approved = false, revision = 1
  const approvals = () => ({ instance_id: 'approval-instance', revision, items: approved ? [] : [{ id: 'approval', run_id: 'run', generation: 1, agent_session_id: session.id, agent_session_title: session.title, kind: 'command', client_id: 'builtin-ai', client_name: english ? 'AI assistant' : 'AI 助手', client_request_id: 'request', revision: 1, state: 'pending', command: 'systemctl status termous', session_ids: [], targets: [], expires_at: new Date(Date.now() + 300000).toISOString(), ...dates }] })
  const document = (type: string, value: unknown) => ({ agent: { type, instanceId: 'agent-instance', json: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))) } })
  return (request: AgentRequest) => {
    const op = request.operation
    if (op.case === 'query') {
      const q = op.value
      switch (q.kind) {
        case Q.STATUS: return document('readiness', readiness)
        case Q.PROVIDERS: return document('providers', { items: [provider] })
        case Q.MODELS: return document('models', { items: [model] })
        case Q.SESSIONS: return document('sessions', { items: q.archived ? [] : [session] })
        case Q.SESSION: return document('session', session)
        case Q.GROUPS: return document('groups', [])
        case Q.WORKSPACE: return document('workspace', { type: 'snapshot', revision, sessions: [session], session_groups: [], active_runs: [], queued_turns: [], queue_states: [] })
        case Q.MESSAGES: return document('messages', { items: messages.filter(m => BigInt(m.sequence) > q.afterSequence) })
        case Q.QUEUE: return document('queue', { items: [], queue_state: { session_id: session.id, state: 'running', revision: 1 } })
        case Q.RESOURCES: return document('resources', { items: [] })
        case Q.APPROVALS: return document('approvals', approvals())
        case Q.CONTEXT: return document('context', { session_id: session.id, estimated_tokens: 2800, context_window_tokens: 32768, estimated: true, warning: false, compression_available: false })
        case Q.USAGE: return document('usage', { session_id: session.id, run_count: 1, input_tokens: 2800, output_tokens: 720, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 3520, estimated: false })
        case Q.RUN_EVENTS: return document('run_events', { items: [] })
        case Q.RUN: return document('run', agentRunFixture({ status: 'completed', completed_at: now }))
      }
    }
    if (op.case === 'resource') return document(op.value.action === 7 ? 'resource_recovery' : 'resource_connection', { instance_id: 'agent-instance', kind: 'ssh_session', can_recover: false, operation: null })
    if (op.case === 'session') { session.revision++; if (op.value.title) session.title = op.value.title; return document('session', session) }
    if (op.case === 'approval') { approved = true; revision++; queueMicrotask(changed); return document('approval', {}) }
    if (op.case === 'run') {
      messages.push(message(`sent-${messages.length}`, 'user', op.value.prompt, messages.length + 1))
      messages.push(message(`reply-${messages.length}`, 'assistant', english ? 'Done.' : '已完成。', messages.length + 1))
      revision++; queueMicrotask(changed)
      return document('run_command', { run: agentRunFixture({ status: 'completed', session_id: session.id, model_id: model.id, completed_at: now }), pending: false })
    }
    throw new Error('隔离夹具不支持此操作')
  }
}
