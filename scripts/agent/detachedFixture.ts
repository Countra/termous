import type { AgentWorkspaceGateway } from '#features/agent-runtime'
import type { AgentAttachment, AgentLocalDirectory, AgentSession } from '#entities/agent'
import type { IntegrationPolicy } from '#entities/agent-integrations'
import { createIntegrationFixture } from '../integrations/fixture.ts'
import { agentMessageFixture, agentRunFixture, agentSessionFixture, agentTextPartFixture } from '../../src/features/agent-runtime/model/agentRuntimeTestFixtures.ts'
import { modelFixture, providerFixture, readinessFixture } from './detachedFixtureData.ts'

// 验收夹具只在内存中运行，不连接模型、SSH、Core 或开发数据目录。
export function createDetachedFixture(scenario = 'ready', runStatus?: 'queued' | 'running', longHistory = false) {
  let readiness = scenario === 'ready' ? readinessFixture() : {
    ...readinessFixture('needs_setup', scenario === 'bound' ? 'ready' : 'missing'),
    mcp_runtime: { status: 'missing' as const, message: '' },
    mcp_client: { status: 'missing' as const, message: '' },
  }
  let failRead = scenario === 'error'
  const sessions: AgentSession[] = [
    agentSessionFixture({ id: 'session-one', title: '生产节点 · 资源巡检', model_id: 'model-one', reasoning_level: 'off' }),
    agentSessionFixture({ id: 'session-two', title: 'Nginx 日志分析', model_id: 'model-one', reasoning_level: 'off', pinned: true }),
    agentSessionFixture({ id: 'session-three', title: '部署前检查清单', model_id: 'model-one', reasoning_level: 'off' }),
  ]
  if (scenario === 'bound') sessions[0].resource_bindings = [{
    kind: 'ssh_session', session_id: 'ssh-fixture', host_id: 'host-fixture', ssh_profile_id: 'profile-fixture',
    host_name: '验收主机', platform: 'linux', bound_at: '2026-08-29T00:00:00Z',
  }]
  const files = new Map<string, File>()
  const directories = new Map<string, AgentLocalDirectory>()
  const integrations = createIntegrationFixture()
  const policies = new Map<string, IntegrationPolicy[]>()
  integrations.policies = async id => structuredClone(policies.get(id) ?? [])
  integrations.setPolicy = async (id, policy) => {
    policies.set(id, [...(policies.get(id) ?? []).filter(value => value.source_id !== policy.source_id), structuredClone(policy)])
  }
  let run = runStatus ? agentRunFixture({ session_id: 'session-one', model_id: 'model-one', status: runStatus }) : undefined
  const messages = [agentMessageFixture({ id: 'message-user', session_id: 'session-one', role: 'user', status: 'completed', sequence: 1,
    parts: [agentTextPartFixture({ text: '帮我整理这台主机的检查顺序，先不要执行任何命令。' })] }),
    agentMessageFixture({ session_id: 'session-one', status: 'completed', parts: [agentTextPartFixture({ text: '可以先按下面的顺序确认环境：\n\n1. **观察负载**：CPU、内存与磁盘空间。\n2. **检查服务**：确认进程状态和最近的错误日志。\n3. **核对变更**：查看最近一次发布及配置修改。\n\n```bash\nuptime\nfree -h\ndf -h\n```\n\n选择关联的 SSH 会话后，我们可以继续细化排查步骤。' })] })]
  if (longHistory) {
    // 保持与内容窗口相同的片段上限，复现长工具轮与多会话下的输入路径。
    messages[1].parts = Array.from({ length: 199 }, (_, index) => agentTextPartFixture({
      id: `history-part-${index}`, sequence: index + 1,
      text: `### 检查记录 ${index + 1}\n\n**服务状态**：正常。请保留历史观察内容。\n\n| 指标 | 结果 |\n| --- | --- |\n| CPU | 12% |\n| 内存 | 512 MiB |\n\n` + '这是一段用于输入性能验收的合成记录。'.repeat(12),
    }))
    for (let index = sessions.length; index < 80; index++) sessions.push(agentSessionFixture({
      id: `session-history-${index}`, title: `历史巡检 ${index + 1}`, model_id: 'model-one', reasoning_level: 'off',
    }))
  }
  const methods: Partial<AgentWorkspaceGateway> = {
    localDirectory: async id => structuredClone(directories.get(id) ?? { path: `D:/Termous/workspaces/${id}`, managed: true, revision: 1 }),
    setLocalDirectory: async (id, path, revision) => {
      if (revision !== (directories.get(id)?.revision ?? 1)) throw new Error('合成目录版本已变化')
      const value = { path, managed: false, revision: revision + 1 }
      directories.set(id, value)
      return structuredClone(value)
    },
    runtimeOwnedByHost: true,
    subscribeWorkspace: observer => { const timer = setTimeout(() => { observer.open(); observer.event({ type: 'snapshot', revision: 1, sessions, active_runs: run && run.status !== 'cancelled' ? [run] : [] }) }, 5); return { close: () => clearTimeout(timer) } },
    run: async id => {
      if (!run || run.id !== id) throw new Error('验收任务不存在')
      return { ...run }
    },
    runEvents: async () => ({ items: [] }),
    stopRun: async (id, revision, generation) => {
      if (!run || run.id !== id || run.revision !== revision || run.generation !== generation || run.status === 'cancelled') throw new Error('验收任务停止参数不匹配或重复停止')
      run = { ...run, status: 'cancelled', revision: run.revision + 1 }
      return { ...run }
    },
    sessions: async options => ({ items: sessions.filter(session => options?.archived ? !!session.archived_at : !session.archived_at).filter(session => !options?.query || session.title.includes(options.query)), revision: 1 }),
    sessionGroups: async () => ({ items: [] }),
    resourceBindingConnection: async () => ({ instance_id: 'fixture-instance', operation: null }),
    resourceBindingRecovery: async () => ({ instance_id: 'fixture-instance', kind: 'ssh_session', can_recover: false, operation: null }),
    session: async id => sessions.find(session => session.id === id)!,
    createSession: async input => { const session = agentSessionFixture({ ...input, id: crypto.randomUUID() }); sessions.push(session); return session },
    updateSession: async (id, input) => { const session = sessions.find(item => item.id === id)!; Object.assign(session, input, { revision: session.revision + 1 }); return { ...session } },
    updateSessionMetadata: async (id, input) => { const session = sessions.find(item => item.id === id)!; Object.assign(session, input, { archived_at: input.archived ? new Date().toISOString() : undefined, revision: session.revision + 1 }); return { ...session } },
    messages: async id => ({ items: id === 'session-one' ? messages : [] }),
    queuedTurns: async () => ({ items: [] }),
    context: async id => ({ session_id: id, estimated_tokens: 512, context_window_tokens: 32768, compression_trigger_tokens: 26000, estimated: true, warning: false, compression_available: false, assessment: 'ready', compression_status: 'unavailable' }),
    usage: async id => ({ session_id: id, run_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 0, estimated: false }),
    runtimeStatus: async () => ({ state: 'ready', configured: true, active_runs: [], max_concurrent_runs: 3 }),
    onRuntimeStatus: () => () => undefined,
    uploadAttachment: async (sessionId, file) => {
      const id = crypto.randomUUID(); files.set(id, file)
      await new Promise(resolve => setTimeout(resolve, 1500))
      return { id, session_id: sessionId, original_name: file.name, size_bytes: file.size, mime_type: file.type, kind: file.type.startsWith('image/') ? 'image' : 'text', state: 'ready', revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as AgentAttachment
    },
    attachmentContent: async id => files.get(id)!,
    deleteAttachment: async id => { files.delete(id) },
    deleteSession: async id => { const index = sessions.findIndex(session => session.id === id); if (index >= 0) sessions.splice(index, 1) },
  }
  const gateway = new Proxy(methods, { get(target, property) {
    if (property in target) return target[property as keyof typeof target]
    return () => Promise.reject(new Error(`未实现的验收操作：${String(property)}`))
  } }) as AgentWorkspaceGateway
  return { gateway, integrations, setup: {
    readiness: async () => {
      if (scenario === 'loading') await new Promise(resolve => setTimeout(resolve, 2500))
      if (failRead) { failRead = false; throw new Error('合成状态读取失败') }
      return readiness
    },
    setup: async () => {
      await new Promise(resolve => setTimeout(resolve, 800))
      readiness = scenario === 'bound' ? readinessFixture() : readinessFixture('needs_setup', 'missing')
      return readiness
    },
    modelProviders: async () => ({ items: [providerFixture()] }), models: async () => ({ items: [modelFixture()] }),
  } }
}
