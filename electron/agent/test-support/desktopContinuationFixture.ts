import type { Tool } from '@modelcontextprotocol/client'
import { mapMCPTools } from '../tools/mcpClientAdapter.ts'
import type { AgentMCPConnection } from '../contracts/mcpTools.ts'

export const continuationHost = { kind: 'host_desktop' as const, instance_id: 'core-1', host: { id: 'screen', kind: 'screen' as const, title: '', generation: 1 } }
const string = { type: 'string' }
const integer = { type: 'integer' }
const definition = (name: string, properties: Record<string, unknown>, required: string[] = [], readOnly = true): Tool => ({
  name: `termous.desktops.${name}`, description: name, inputSchema: { type: 'object', properties: properties as Tool['inputSchema']['properties'], required, additionalProperties: false },
  annotations: { readOnlyHint: readOnly },
})
export const continuationTools = [
  definition('sources', { kind: string }, ['kind']), definition('list', {}),
  definition('get', { attachment_id: string, session_id: string, wait_ms: integer }),
  definition('attach', { target: { type: 'object' }, session_id: string, connection_generation: integer, client_request_id: string }, ['client_request_id'], false),
  definition('capture', { attachment_id: string }, ['attachment_id']),
  definition('detach', { attachment_id: string, client_request_id: string }, ['attachment_id', 'client_request_id'], false),
  definition('pointer.click', { attachment_id: string, grant_id: string, client_request_id: string, screenshot_id: string, x: integer, y: integer }, ['attachment_id', 'grant_id', 'client_request_id', 'screenshot_id', 'x', 'y'], false),
]

export function continuationMCP(respond: (name: string, args: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const mapped = mapMCPTools(continuationTools, async (tool, args) => {
    calls.push({ name: tool.name, args: structuredClone(args) })
    const data = await respond(tool.name, args)
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: Boolean(data.error) }
  })
  const mcp: AgentMCPConnection = { tools: mapped.tools, originalName: name => mapped.originalNames.get(name) ?? null,
    readOnly: name => continuationTools.find(tool => tool.name === name)?.annotations?.readOnlyHint === true, close: async () => {} }
  return { calls, mcp }
}
