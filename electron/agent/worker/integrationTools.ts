import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type, type TSchema } from 'typebox'
import type { AgentMCPConnection, MCPToolDetails } from '../contracts/mcpTools.ts'
import { externalToolName, externalToolSource, identifyTool } from '../contracts/toolSources.ts'
import type { IntegrationDirectory, IntegrationDefinition } from '../contracts/integrationIPC.ts'
import type { IntegrationToolResult } from '#common/agent-integrations'
import { WorkerIntegrationProxy } from './integrationProxy.ts'
import { integrationResourceTools } from './integrationResourceTools.ts'
import { readIntegrationDirectory } from './integrationDirectory.ts'

function createIntegrationToolBundle(directory: IntegrationDirectory, proxy: WorkerIntegrationProxy) {
  const summaries = new Map(directory.tools.map(summary => {
    const source = externalToolSource(summary.source_id)
    return [externalToolName(source, summary.name), { summary, source }] as const
  }))
  const tools = [...summaries].map(([name, { summary, source }]) => identifyTool({
    name, label: summary.title ?? summary.name, description: summary.description ?? summary.name,
    parameters: Type.Object({}, { additionalProperties: false }), executionMode: 'sequential',
    execute: async (id, args, signal) => {
      const result = await proxy.request<IntegrationToolResult>({ action: 'call', source: source.id, revision: summary.source_revision,
        name: summary.name, tool_call_id: id, arguments: args as Record<string, unknown> }, signal)
      return { content: [...result.content, {type:'text' as const,text:JSON.stringify({source:source.id,operation:result.operation,connection_generation:result.connection_generation})}], isError: result.isError === true, details: { kind: 'mcp', originalToolName: `${source.id}::${summary.name}`,
        result: { isError: result.isError === true, content: [] }, operation: result.operation,
        connection_generation: result.connection_generation } satisfies MCPToolDetails & { operation?: string; connection_generation?: string } }
    },
  } satisfies AgentTool, source, summary.name))

  return {summaries,tools:[...tools,...integrationResourceTools(directory,proxy)]}
}

export function attachIntegrationTools(builtin: AgentMCPConnection, directory: IntegrationDirectory, proxy: WorkerIntegrationProxy): AgentMCPConnection {
  let bundle=createIntegrationToolBundle(directory,proxy)
  let fingerprint=directory.fingerprint
  const connection:AgentMCPConnection={ ...builtin, tools: [...builtin.tools,...bundle.tools],
    originalName: name => { const entry = bundle.summaries.get(name); return entry ? `${entry.source.id}::${entry.summary.name}` : builtin.originalName(name) },
    refreshTools:async signal=>{
      const next=await readIntegrationDirectory(proxy,signal,fingerprint)
      if ('unchanged' in next) return
      const removed=bundle.tools.map(tool=>tool.name)
      bundle=createIntegrationToolBundle(next,proxy)
      fingerprint=next.fingerprint
      connection.tools=[...builtin.tools,...bundle.tools]
      return {removed,tools:bundle.tools}
    },
    loadTool: async (name, signal) => {
      const entry = bundle.summaries.get(name)
      if (!entry) return builtin.loadTool?.(name, signal)
      if (entry.summary.unavailable_reason) throw new Error(entry.summary.unavailable_reason)
      const definition = await proxy.request<IntegrationDefinition>({ action: 'definition', source: entry.source.id, revision: entry.summary.source_revision, name: entry.summary.name }, signal)
      if (definition.contract_hash !== entry.summary.contract_hash || definition.unavailable_reason) throw new Error('INTEGRATION_TOOL_CHANGED')
      return definition.input_schema as TSchema
    },
    close: async () => { proxy.close(); await builtin.close() },
  }
  return connection
}
