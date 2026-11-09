import type { AgentTool } from '@earendil-works/pi-agent-core'
import { isImageResourceReference } from '#common/contracts'
import type { LocalToolCall, LocalToolContext } from '../contracts/localTools.ts'
import type { AgentMCPConnection } from '../contracts/mcpTools.ts'
import { resourceImage } from '../contracts/runtimeResourceImages.ts'
import { encodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { identifyTool, localToolSource } from '../contracts/toolSources.ts'
import { isRecord } from '../contracts/validation.ts'
import { localToolResultFailed, localToolResultWithContext, projectLocalToolResult } from '../tools/runtimeLocalToolResult.ts'

export function attachLocalTools(connection: AgentMCPConnection, context: LocalToolContext,
  call: (input: LocalToolCall, signal?: AbortSignal) => Promise<unknown>): AgentMCPConnection {
  const pending = new Set<string>()
  const names = new Map<string, string>()
  const tools = Object.entries(context.tools).map(([original, definition]) => {
    const name = encodeMCPToolName(original)
    names.set(name, original)
    return identifyTool({ name, label: original, description: definition.description, parameters: definition.inputSchema,
      executionMode: 'sequential', execute: async (id, args, signal) => {
        const result = localToolResultWithContext(await call({ tool_call_id: id, tool: original, arguments: args }, signal), args, context)
        const value = isRecord(result) && isRecord(result.value) ? result.value : result
        const task = isRecord(value) && isRecord(value.task) ? value.task : undefined
        if (task && typeof task.id === 'string') {
          if (task.status === 'queued' || task.status === 'running') pending.add(task.id)
          else pending.delete(task.id)
        }
        const image = isRecord(value) && isImageResourceReference(value.image_resource) ? value.image_resource : undefined
        const data = projectLocalToolResult(result)
        const isError = localToolResultFailed(data)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }, ...(image ? [resourceImage(image)] : [])], isError,
          details: { kind: 'mcp', originalToolName: original, readOnly: !/\.(?:execute|cancel|write|edit)$/u.test(original),
            result: { content: [], structuredContent: data, isError } } }
      },
    } satisfies AgentTool, localToolSource, original)
  })
  return { ...connection, tools: [...connection.tools, ...tools],
    originalName: name => names.get(name) ?? connection.originalName(name),
    readOnly: name => name.startsWith('termous.local.') ? !/\.(?:execute|cancel|write|edit)$/u.test(name) : connection.readOnly?.(name) ?? false,
    pendingWork: () => pending.size ? `Local commands are still active: ${[...pending].join(', ')}. Query or wait for these tasks before finishing; do not execute them again.` : connection.pendingWork?.(),
    close: async () => { pending.clear(); await connection.close() },
  }
}
