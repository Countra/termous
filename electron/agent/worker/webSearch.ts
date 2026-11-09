import type { AgentTool } from '@earendil-works/pi-agent-core'
import { isWebSearchResult, type WebSearchRequest } from '#common/contracts'
import type { AgentMCPConnection } from '../contracts/mcpTools.ts'
import type { WebSearchContext } from '../contracts/webSearch.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { identifyTool, termousToolSource } from '../contracts/toolSources.ts'
import { isRecord } from '../contracts/validation.ts'

export function attachWebSearch(connection: AgentMCPConnection, context: WebSearchContext,
  search: (request: WebSearchRequest, signal?: AbortSignal) => Promise<unknown>): AgentMCPConnection {
  const original = 'termous.web.search'
  const name = encodeMCPToolName(original)
  const definition = context.tools[original]
  const tool = identifyTool({ name, label: original, description: definition.description, parameters: definition.inputSchema,
    executionMode: 'sequential', execute: async (_id, input, signal) => {
      const result = await search(input as WebSearchRequest, signal)
      if (isRecord(result) && isRecord(result.error) && typeof result.error.code === 'string'
        && result.error.code.length <= 128 && typeof result.error.message === 'string' && result.error.message.length <= 2048) {
        const failure = { code: result.error.code, message: result.error.message }
        return { content: [{ type: 'text' as const, text: JSON.stringify(failure) }], isError: true,
          details: { kind: 'mcp', originalToolName: original, readOnly: true,
            result: { content: [], structuredContent: failure, isError: true } } }
      }
      if (!isWebSearchResult(result)) throw new Error('AGENT_SEARCH_RESPONSE_INVALID')
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: { kind: 'mcp', originalToolName: original, readOnly: true,
          result: { content: [], structuredContent: result, isError: false } } }
    },
  } satisfies AgentTool, termousToolSource, original)
  return { ...connection, tools: [...connection.tools, tool],
    originalName: key => key === name ? original : connection.originalName(key),
    readOnly: key => key === original || (connection.readOnly?.(key) ?? false) }
}
