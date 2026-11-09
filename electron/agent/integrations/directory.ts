import { createHash } from 'node:crypto'
import type { McpClient, Tool } from '@earendil-works/pi-mcp'
import type { IntegrationHostConfig, IntegrationToolDefinition } from '../contracts/integrations.ts'
import { validateIntegrationSchema } from './schema.ts'

export async function readDirectory(client: McpClient, config: IntegrationHostConfig, signal: AbortSignal, timeoutMs = 15_000): Promise<IntegrationToolDefinition[]> {
  if (!client.serverCapabilities?.tools) return []
  const result: IntegrationToolDefinition[] = []
  const cursors = new Set<string>()
  const names = new Set<string>()
  let cursor: string | undefined
  let bytes = 0
  do {
    const page = await client.request<{ tools: Tool[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {}, { signal, timeoutMs })
    if (!Array.isArray(page.tools)) throw new Error('INTEGRATION_DIRECTORY_INVALID')
    for (const tool of page.tools) {
      const raw = JSON.stringify(tool)
      bytes += Buffer.byteLength(raw)
      if (result.length >= 1024 || bytes > 4 * 1024 * 1024) throw new Error('INTEGRATION_DIRECTORY_TOO_LARGE')
      if (!tool.name || tool.name.length > 256 || names.has(tool.name)) throw new Error('INTEGRATION_TOOL_NAME_INVALID')
      names.add(tool.name)
      let unavailable: string | undefined
      try {
        validateIntegrationSchema(tool.inputSchema)
      } catch { unavailable = 'INTEGRATION_TOOL_SCHEMA_UNSUPPORTED' }
      result.push({ source_id: config.source.id, source_revision: config.source.revision, name: tool.name,
        title: tool.title?.slice(0, 512), description: tool.description?.slice(0, 8192), input_schema: tool.inputSchema,
        contract_hash: createHash('sha256').update(raw).digest('hex'), ...(unavailable ? { unavailable_reason: unavailable } : {}) })
    }
    cursor = page.nextCursor
    if (cursor && cursors.has(cursor)) throw new Error('INTEGRATION_DIRECTORY_CURSOR_INVALID')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return result
}
