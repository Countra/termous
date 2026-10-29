import type { AgentIntegrationSource, IntegrationCallReceipt, IntegrationToolSummary, IntegrationToolResult, IntegrationContentReference } from '#common/agent-integrations'
import type { ImageResourceReference } from '#common/contracts'
import type { IntegrationCorePort, IntegrationHostConfig, IntegrationRunContext, IntegrationToolDefinition } from '../contracts/integrations.ts'
import { validateCoreBaseURL } from '../contracts/supervisorCore.ts'

export interface IntegrationCoreConfig { baseURL: string; token: string; supervisor: string }

export class IntegrationCoreClient implements IntegrationCorePort {
  private readonly configuration: IntegrationCoreConfig
  private readonly fetchImplementation: typeof fetch
  constructor(configuration: IntegrationCoreConfig, fetchImplementation: typeof fetch = globalThis.fetch) {
    this.configuration = configuration
    this.fetchImplementation = fetchImplementation
    validateCoreBaseURL(configuration.baseURL)
  }

  config(source: string, revision: number, signal?: AbortSignal) { return this.request<IntegrationHostConfig>('config', { source_id: source, revision }, undefined, signal) }
  verifiedConfig(source: string, revision: number, signal?: AbortSignal) { return this.request<IntegrationHostConfig>('config', { source_id: source, revision, verify_launch: true }, undefined, signal, 30_000) }
  receipt(context: IntegrationRunContext, toolCallID: string, input?: {kind?: 'tool' | 'resource'; source_id: string; revision: number; tool: string; arguments: Record<string, unknown>}, signal?: AbortSignal) {
    return this.request<IntegrationCallReceipt | null>('receipt', {tool_call_id:toolCallID,...input}, context.bearer, signal)
  }
  beginOAuth(source: string, revision: number, signal?: AbortSignal) { return this.request<IntegrationHostConfig>('oauth', { source_id: source, revision, begin: true }, undefined, signal) }
  async saveOAuth(source: string, revision: number, state: unknown, signal?: AbortSignal) { await this.request('oauth', { source_id: source, revision, state }, undefined, signal) }
  async supervise(pid: number, release = false) { await this.request('process', { pid, release }) }
  async superviseGroup(pid: number, release: boolean) { await this.request('process', { pid, parent_pid: process.pid, release }) }
  skill(context: IntegrationRunContext, source: string, version: string, path: string, offset: number, toolCallID: string, signal?: AbortSignal) {
    return this.request<import('#common/agent-integrations').IntegrationSkillRead>('skill', {source_id: source, version, path, offset,tool_call_id:toolCallID}, context.bearer, signal)
  }
  sources(context: IntegrationRunContext, signal?: AbortSignal) { return this.request<AgentIntegrationSource[]>('sources', {}, context.bearer, signal) }
  tools(source: string, revision: number, signal?: AbortSignal) { return this.request<IntegrationToolSummary[]>('tools', { source_id: source, revision }, undefined, signal) }
  tool(source: string, revision: number, name: string, signal?: AbortSignal) { return this.request<IntegrationToolDefinition>('tools', { source_id: source, revision, name }, undefined, signal) }
  async saveTools(source: string, revision: number, tools: IntegrationToolDefinition[], signal?: AbortSignal) { await this.request('catalog', { source_id: source, revision, tools }, undefined, signal) }
  authorize(context: IntegrationRunContext, tool: IntegrationToolDefinition, toolCallID: string, args: Record<string, unknown>, signal?: AbortSignal) {
    // 审批等待由审批期限和用户取消控制，不使用普通请求的 15 秒超时。
    return this.request<IntegrationCallReceipt>('authorize', { source_id: tool.source_id, revision: tool.source_revision, tool: tool.name,
      contract_hash: tool.contract_hash, tool_call_id: toolCallID, arguments: args }, context.bearer, signal, 0)
  }
  authorizeResource(context: IntegrationRunContext, source: string, revision: number, toolCallID: string, uri: string, signal?: AbortSignal) {
    return this.request<IntegrationCallReceipt>('authorize', {kind:'resource',source_id:source,revision,tool:'resources/read',tool_call_id:toolCallID,arguments:{uri}}, context.bearer, signal, 0)
  }
  stageImage(context: IntegrationRunContext, call: string, index: number, data: string, mime: string, signal?: AbortSignal) {
    return this.request<ImageResourceReference>('content', {call_id: call, image: true, index, data, mime_type: mime}, context.bearer, signal)
  }
  stageContent(context: IntegrationRunContext, call: string, data: string, mime: string, signal?: AbortSignal) {
    return this.request<IntegrationContentReference>('content', {call_id: call, image: false, index: 0, data, mime_type: mime}, context.bearer, signal)
  }
  readContent(context: IntegrationRunContext, id: string, offset: number, signal?: AbortSignal) {
    return this.request<{resource: IntegrationContentReference; data: string; next_offset: number; done: boolean}>('content/read', {id,offset}, context.bearer, signal)
  }
  async verifyDispatch(context: IntegrationRunContext, id: string, signal?: AbortSignal) { await this.request('verify-dispatch', {id}, context.bearer, signal) }
  async settle(id: string, state: 'completed' | 'uncertain' | 'not_dispatched', result?: IntegrationToolResult, signal?: AbortSignal) { await this.request('settle', { id, state, result }, undefined, signal) }

  private async request<T>(operation: string, body: unknown, bearer?: string, signal?: AbortSignal, timeout = 15_000): Promise<T> {
    const deadline = timeout ? AbortSignal.timeout(timeout) : undefined
    const combined = signal && deadline ? AbortSignal.any([signal, deadline]) : signal ?? deadline
    const response = await this.fetchImplementation(new URL(`/api/v1/agent/integration-host/${operation}`, this.configuration.baseURL), {
      method: 'POST', signal: combined, redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Termous-Token': this.configuration.token,
        'X-Termous-Integration-Host': this.configuration.supervisor, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const value = await readCoreJSON(response) as { error?: { code?: string } }
      throw new Error(value.error?.code ?? 'INTEGRATION_CORE_UNAVAILABLE')
    }
    return await readCoreJSON(response) as T
  }
}

export async function readCoreJSON(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('INTEGRATION_CORE_RESPONSE_INVALID')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > 8 * 1024 * 1024) throw new Error('INTEGRATION_CORE_RESPONSE_TOO_LARGE')
      chunks.push(next.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { try { await reader.cancel() } finally { reader.releaseLock() } }
}
