import type { AgentWorkspaceGateway } from '#features/agent-runtime'
import type { AgentAttachment, AgentSession } from '#entities/agent'
import { agentMessageFixture, agentSessionFixture, agentTextPartFixture } from '../../src/features/agent-runtime/model/agentRuntimeTestFixtures.ts'
import { modelFixture, providerFixture, readinessFixture } from './detachedFixtureData.ts'

// 验收夹具只在内存中运行，不连接模型、SSH、Core 或开发数据目录。
export function createDetachedFixture() {
  const sessions: AgentSession[] = [
    agentSessionFixture({ id: 'session-one', title: '生产节点 · 资源巡检', model_id: 'model-one', reasoning_level: 'off' }),
    agentSessionFixture({ id: 'session-two', title: 'Nginx 日志分析', model_id: 'model-one', reasoning_level: 'off', pinned: true }),
    agentSessionFixture({ id: 'session-three', title: '部署前检查清单', model_id: 'model-one', reasoning_level: 'off' }),
  ]
  const files = new Map<string, File>()
  const messages = [agentMessageFixture({ id: 'message-user', session_id: 'session-one', role: 'user', status: 'completed', sequence: 1,
    parts: [agentTextPartFixture({ text: '帮我整理这台主机的检查顺序，先不要执行任何命令。' })] }),
    agentMessageFixture({ session_id: 'session-one', status: 'completed', parts: [agentTextPartFixture({ text: '可以先按下面的顺序确认环境：\n\n1. **观察负载**：CPU、内存与磁盘空间。\n2. **检查服务**：确认进程状态和最近的错误日志。\n3. **核对变更**：查看最近一次发布及配置修改。\n\n```bash\nuptime\nfree -h\ndf -h\n```\n\n选择关联的 SSH 会话后，我们可以继续细化排查步骤。' })] })]
  const methods: Partial<AgentWorkspaceGateway> = {
    runtimeOwnedByHost: true,
    subscribeWorkspace: observer => { const timer = setTimeout(() => { observer.open(); observer.event({ type: 'snapshot', revision: 1, sessions, active_runs: [] }) }, 5); return { close: () => clearTimeout(timer) } },
    sessions: async options => ({ items: sessions.filter(session => options?.archived ? !!session.archived_at : !session.archived_at).filter(session => !options?.query || session.title.includes(options.query)), revision: 1 }),
    sessionGroups: async () => ({ items: [] }),
    resourceBindingConnection: async () => ({ instance_id: 'fixture-instance', operation: null }),
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
  return { gateway, setup: { readiness: async () => readinessFixture(), modelProviders: async () => ({ items: [providerFixture()] }), models: async () => ({ items: [modelFixture()] }) } }
}
