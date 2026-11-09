import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'
import type { TermousBridge } from '#common/contracts'

// 两个预览入口共用内存网关；不连接 Core、启动进程或访问用户文件。
export function createIntegrationFixture({ toggleDelayMs = 0 }: { toggleDelayMs?: number } = {}): AgentIntegrationsGateway {
  let sources: AgentIntegrationSource[] = [
    { id: 'ext_docs', kind: 'mcp', name: 'Documentation', enabled: true, revision: 1, startup_confirmed: true,
      mcp: { transport: 'http', url: 'https://docs.example.test/mcp' }, secret_configured: false, created_at: '', updated_at: '' },
    { id: 'ext_browser', kind: 'mcp', name: 'Browser automation', enabled: false, revision: 1,
      mcp: { transport: 'stdio', mode: 'managed_npm', command: 'npx', args: ['@playwright/mcp'] }, secret_configured: false, created_at: '', updated_at: '' },
    { id: 'ext_local', kind: 'mcp', name: 'Workspace files', enabled: false, revision: 1,
      mcp: { transport: 'stdio', mode: 'external', command: 'node', args: ['workspace-server.js'] }, secret_configured: false, created_at: '', updated_at: '' },
    { id: 'ext_review', kind: 'skill', name: 'design-review', enabled: true, revision: 1, secret_configured: false, created_at: '', updated_at: '',
      skill: { version: 'a'.repeat(64), name: 'design-review', description: '检查界面一致性、交互状态与键盘可访问性。', allow_implicit: true, files: [
        { path: 'SKILL.md', mime_type: 'text/markdown', object: { sha256: 'b'.repeat(64), size_bytes: 75 } },
        { path: 'references/checklist.md', mime_type: 'text/markdown', object: { sha256: 'c'.repeat(64), size_bytes: 50 } },
      ] } },
    { id: 'ext_report', kind: 'skill', name: 'research-notes', enabled: false, revision: 1, secret_configured: false, created_at: '', updated_at: '',
      skill: { version: 'd'.repeat(64), name: 'research-notes', description: '整理调研资料，记录来源并生成结构化笔记。', allow_implicit: true, files: [
        { path: 'SKILL.md', mime_type: 'text/markdown', object: { sha256: 'e'.repeat(64), size_bytes: 80 } },
      ] } },
  ]
  const permissions = new Map<string, Array<{ tool: string; trusted: boolean }>>()
  const unavailable = async (): Promise<never> => { throw new Error('此预览不执行外部操作') }
  return {
    sources: async () => structuredClone(sources),
    saveMCP: async (input, id) => {
      const existing = sources.find(value => value.id === id)
      const source: AgentIntegrationSource = { id: id ?? crypto.randomUUID(), name: input.name, kind: 'mcp', enabled: false,
        revision: (existing?.revision ?? 0) + 1, mcp: input.mcp, secret_configured: Boolean(input.secret) || Boolean(existing?.secret_configured), created_at: '', updated_at: '' }
      sources = [...sources.filter(value => value.id !== source.id), source]
      return structuredClone(source)
    },
    enabled: async (source, enabled, signal) => {
      if (toggleDelayMs) await new Promise(resolve => setTimeout(resolve, toggleDelayMs))
      signal?.throwIfAborted()
      const item = sources.find(value => value.id === source.id)!
      item.enabled = enabled; item.revision++
      return structuredClone(item)
    },
    remove: async source => { sources = sources.filter(value => value.id !== source.id) },
    previewMCP: async text => Object.entries(JSON.parse(text).mcpServers as Record<string, { command?: string; args?: string[]; cwd?: string; url?: string }>).map(([name, value]) => ({
      name, mcp: value.command ? { transport: 'stdio', command: value.command, args: value.args ?? [], cwd: value.cwd } : { transport: 'http', url: value.url }, expected_revision: 0,
    })),
    tools: async source => [
      { source_id: source, source_revision: 1, name: 'search_docs', title: 'Search documentation', description: 'Find reference pages by title or content.', contract_hash: 'c'.repeat(64) },
      { source_id: source, source_revision: 1, name: 'read_document', title: 'Read a document', description: 'Read the contents of a selected reference page.', contract_hash: 'd'.repeat(64) },
    ],
    permissions: async source => permissions.get(source) ?? [],
    setPermission: async (source, _revision, tool, trusted) => { permissions.set(source, [...(permissions.get(source) ?? []).filter(item => item.tool !== tool), { tool, trusted }]) },
    previewSkill: unavailable, publishSkill: unavailable, skillDependencies: async () => [],
    skillFile: async () => new Blob(['# Design review\n\nReview spacing, contrast and keyboard access.'], { type: 'text/markdown' }),
    policies: async () => [], setPolicy: async () => {}, confirmLaunch: unavailable, repairDependency: unavailable,
    dependency: async () => null, previewDependency: unavailable, confirmDependency: unavailable, cancelDependency: unavailable, dependencyOutput: unavailable,
  }
}

// 连接测试预览只模拟有界等待与取消，不启动宿主、外部进程或网络连接。
export function installIntegrationConnectionFixture() {
  if (Object.getOwnPropertyDescriptor(window, 'termous')) return () => {}
  const tasks = new Map<string, { timer: ReturnType<typeof setTimeout>; finish(): void }>()
  const stop = (id: string) => {
    const task = tasks.get(id)
    if (task) { clearTimeout(task.timer);tasks.delete(id);queueMicrotask(task.finish) }
  }
  const native: NonNullable<TermousBridge['agentIntegrations']> = {
    prepare: async () => [], releasePreparation: async () => {}, status: async () => [],
    test: request => new Promise(resolve => {
      const finish = () => resolve({ tools: [], generation: 'preview' })
      tasks.set(request.request_id, { timer: setTimeout(() => { tasks.delete(request.request_id);finish() }, 12_000), finish })
    }),
    login: async () => { throw new Error('此预览不执行登录') },
    reconnect: async () => { throw new Error('此预览不建立外部连接') },
    cancel: async id => stop(id),
  }
  Object.defineProperty(window, 'termous', { configurable: true, value: { agentIntegrations: native } })
  return () => {
    for (const id of tasks.keys()) stop(id)
    Reflect.deleteProperty(window, 'termous')
  }
}
