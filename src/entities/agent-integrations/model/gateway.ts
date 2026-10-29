import type { AgentIntegrationSource, MCPIntegrationInput, SkillImportPreview, IntegrationToolSummary } from '#common/agent-integrations'

export interface IntegrationPolicy { source_id: string; disabled: boolean; skill_version?: string }
export interface IntegrationSelection {
  sources: Array<{id: string; name: string; kind: 'mcp' | 'skill'; enabled: boolean; version?: string; description?: string; allow_implicit?: boolean}>
  policies: IntegrationPolicy[]
}
export interface AgentIntegrationsGateway {
  dependency(source: string, revision: number, signal?: AbortSignal): Promise<import('#common/agent-integrations').MCPDependency | null>
  previewDependency(source: string, revision: number, signal?: AbortSignal): Promise<import('#common/agent-integrations').MCPDependency>
  confirmDependency(source: string, revision: number, token: string, signal?: AbortSignal): Promise<AgentIntegrationSource>
  cancelDependency(source: string, revision: number, signal?: AbortSignal): Promise<void>
  dependencyOutput(source: string, revision: number, stdout: number, stderr: number, signal?: AbortSignal): Promise<import('#common/agent-integrations').MCPDependencyOutput>
  skillDependencies(source: string, version: string, signal?: AbortSignal): Promise<string[]>
  permissions(source: string, revision: number, signal?: AbortSignal): Promise<Array<{tool:string;trusted:boolean}>>
  setPermission(source: string, revision: number, tool: string, trusted: boolean, signal?: AbortSignal): Promise<void>
  sources(signal?: AbortSignal): Promise<AgentIntegrationSource[]>
  saveMCP(input: MCPIntegrationInput, id?: string, signal?: AbortSignal): Promise<AgentIntegrationSource>
  previewMCP(text: string, signal?: AbortSignal): Promise<MCPIntegrationInput[]>
  enabled(source: AgentIntegrationSource, enabled: boolean, signal?: AbortSignal): Promise<AgentIntegrationSource>
  remove(source: AgentIntegrationSource, signal?: AbortSignal): Promise<void>
  previewSkill(files: File[], signal?: AbortSignal): Promise<SkillImportPreview>
  publishSkill(token: string, source?: AgentIntegrationSource, signal?: AbortSignal): Promise<AgentIntegrationSource>
  skillFile(source: string, version: string, path: string, signal?: AbortSignal, preview?: boolean): Promise<Blob>
  tools(source: string, revision: number, signal?: AbortSignal): Promise<IntegrationToolSummary[]>
  policies(session: string, signal?: AbortSignal): Promise<IntegrationPolicy[]>
  setPolicy(session: string, policy: IntegrationPolicy, signal?: AbortSignal): Promise<void>
}
