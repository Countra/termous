import type { AgentIntegrationSource, IntegrationCallReceipt, IntegrationToolSummary, IntegrationToolResult, IntegrationContentReference } from '#common/agent-integrations'
import type { ImageResourceReference } from '#common/contracts'

export interface IntegrationHostConfig {
  source: AgentIntegrationSource
  secret: { environment?: Record<string, string>; headers?: Record<string, string>; oauth?: unknown }
}

export interface IntegrationRunContext { run_id: string; generation: number; session_id: string; bearer: string }

export interface IntegrationToolDefinition extends IntegrationToolSummary { input_schema: Record<string, unknown> }

export interface IntegrationCorePort {
  verifyDispatch(context: IntegrationRunContext, id: string, signal?: AbortSignal): Promise<void>
  authorizeResource(context: IntegrationRunContext, source: string, revision: number, toolCallID: string, uri: string, signal?: AbortSignal): Promise<IntegrationCallReceipt>
  receipt(context: IntegrationRunContext, toolCallID: string, input?: {kind?: 'tool' | 'resource'; source_id: string; revision: number; tool: string; arguments: Record<string, unknown>}, signal?: AbortSignal): Promise<IntegrationCallReceipt | null>
  beginOAuth(source: string, revision: number, signal?: AbortSignal): Promise<IntegrationHostConfig>
  saveOAuth(source: string, revision: number, state: unknown, signal?: AbortSignal): Promise<void>
  skill(context: IntegrationRunContext, source: string, version: string, path: string, offset: number, toolCallID: string, signal?: AbortSignal): Promise<import('#common/agent-integrations').IntegrationSkillRead>
	tools(source: string, revision: number, signal?: AbortSignal): Promise<IntegrationToolSummary[]>
	tool(source: string, revision: number, name: string, signal?: AbortSignal): Promise<IntegrationToolDefinition>
	saveTools(source: string, revision: number, tools: IntegrationToolDefinition[], signal?: AbortSignal): Promise<void>
  config(source: string, revision: number, signal?: AbortSignal): Promise<IntegrationHostConfig>
  sources(context: IntegrationRunContext, signal?: AbortSignal): Promise<AgentIntegrationSource[]>
  authorize(context: IntegrationRunContext, definition: IntegrationToolDefinition, toolCallID: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<IntegrationCallReceipt>
  stageImage(context: IntegrationRunContext, call: string, index: number, data: string, mime: string, signal?: AbortSignal): Promise<ImageResourceReference>
  stageContent(context: IntegrationRunContext, call: string, data: string, mime: string, signal?: AbortSignal): Promise<IntegrationContentReference>
  readContent(context: IntegrationRunContext, id: string, offset: number, signal?: AbortSignal): Promise<{resource: IntegrationContentReference; data: string; next_offset: number; done: boolean}>
  settle(id: string, state: 'completed' | 'uncertain' | 'not_dispatched', result?: IntegrationToolResult, signal?: AbortSignal): Promise<void>
}
