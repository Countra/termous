import { TermousApiTransport } from '#shared/api'
import { decodeDependency } from '#entities/agent-integrations'
import type { MCPDependencyOutput } from '#common/agent-integrations'
import { decodeIntegrationSource, decodeIntegrationSources, decodeSkillPreview, type AgentIntegrationsGateway, type AgentIntegrationSource, type MCPIntegrationInput, type IntegrationPolicy, type IntegrationToolSummary } from '#entities/agent-integrations'

const base = '/api/v1/agent/integrations'
export class AgentIntegrationsClient extends TermousApiTransport implements AgentIntegrationsGateway {
  dependency(source: string, revision: number, signal?: AbortSignal) {
    return this.request(`${base}/${encodeURIComponent(source)}/dependency?revision=${revision}`, { signal }).then(value => value === null ? null : decodeDependency(value))
  }
  previewDependency(source: string, revision: number, signal?: AbortSignal) {
    return this.request(`${base}/${encodeURIComponent(source)}/dependency/preview`, { method: 'POST', body: { revision }, signal, timeoutMs: 30_000 }).then(decodeDependency)
  }
  confirmDependency(source: string, revision: number, token: string, signal?: AbortSignal) {
    return this.request(`${base}/${encodeURIComponent(source)}/dependency/confirm`, { method: 'POST', body: { revision, token }, signal }).then(decodeIntegrationSource)
  }
  async cancelDependency(source: string, revision: number, signal?: AbortSignal) {
    await this.request(`${base}/${encodeURIComponent(source)}/dependency/cancel`, { method: 'POST', body: { revision }, signal })
  }
  dependencyOutput(source: string, revision: number, stdout: number, stderr: number, signal?: AbortSignal) {
    return this.request<MCPDependencyOutput>(`${base}/${encodeURIComponent(source)}/dependency/output?${new URLSearchParams({ revision: String(revision), stdout: String(stdout), stderr: String(stderr) })}`, { signal })
  }
  skillDependencies(source: string, version: string, signal?: AbortSignal) {
    return this.request<string[]>(`${base}/${encodeURIComponent(source)}/skill-dependencies?${new URLSearchParams({version})}`, {signal})
  }
  permissions(source:string,revision:number,signal?:AbortSignal) { return this.request<Array<{tool:string;trusted:boolean}>>(`${base}/${encodeURIComponent(source)}/permissions?revision=${revision}`,{signal}) }
  async setPermission(source:string,revision:number,tool:string,trusted:boolean,signal?:AbortSignal) {
    await this.request(`${base}/${encodeURIComponent(source)}/permissions`,{method:'PUT',body:{revision,tool,trusted},signal})
  }
  sources(signal?: AbortSignal) { return this.request(base, { signal }).then(decodeIntegrationSources) }
  saveMCP(input: MCPIntegrationInput, id?: string, signal?: AbortSignal) {
    return this.request(id ? `${base}/${encodeURIComponent(id)}/mcp` : `${base}/mcp`, { method: id ? 'PUT' : 'POST', body: input, signal }).then(decodeIntegrationSource)
  }
  previewMCP(text: string, signal?: AbortSignal) { return this.request<MCPIntegrationInput[]>(`${base}/mcp/preview`, {method: 'POST', body: JSON.parse(text.replace(/^\uFEFF/u, '')), signal}) }
  enabled(source: AgentIntegrationSource, enabled: boolean, signal?: AbortSignal) {
    return this.request(`${base}/${encodeURIComponent(source.id)}`, {method: 'PATCH', body: { expected_revision: source.revision, enabled }, signal}).then(decodeIntegrationSource)
  }
  async remove(source: AgentIntegrationSource, signal?: AbortSignal) { await this.request(`${base}/${encodeURIComponent(source.id)}`, {method: 'DELETE', body: { expected_revision: source.revision }, signal}) }
  previewSkill(files: File[], signal?: AbortSignal) {
    const form = new FormData()
    for (const file of files) form.append(file.webkitRelativePath || file.name, file)
    return this.request(`${base}/skills/preview`, { method: 'POST', body: form, signal, timeoutMs: 60_000 }).then(decodeSkillPreview)
  }
  publishSkill(token: string, source?: AgentIntegrationSource, signal?: AbortSignal) {
    return this.request(`${base}/skills/publish`, { method: 'POST', body: {token, source_id: source?.id ?? '', expected_revision: source?.revision ?? 0}, signal }).then(decodeIntegrationSource)
  }
  skillFile(source: string, version: string, path: string, signal?: AbortSignal, preview = false) {
    return this.requestBlob(`${base}/${encodeURIComponent(source)}/skill-file?${new URLSearchParams({version, path, preview:String(preview)})}`, {signal})
  }
  tools(source: string, revision: number, signal?: AbortSignal) {
    return this.request<IntegrationToolSummary[]>(`${base}/${encodeURIComponent(source)}/tools?revision=${revision}`, {signal})
  }
  policies(session: string, signal?: AbortSignal) { return this.request<IntegrationPolicy[]>(`/api/v1/agent/sessions/${encodeURIComponent(session)}/integrations`, {signal}) }
  async setPolicy(session: string, policy: IntegrationPolicy, signal?: AbortSignal) {
    await this.request(`/api/v1/agent/sessions/${encodeURIComponent(session)}/integrations`, {method: 'PUT',body:policy,signal})
  }
}
