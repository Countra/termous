import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { BuiltinToolAdapter } from '../../contracts/toolCapabilities.ts'
import { toolProperties } from './contracts.ts'
import { isRecord } from '../../contracts/validation.ts'

const hidden = new Set(['client_request_id', 'grant_id', 'takeover', 'connection_generation', 'expected_connection_generation', 'source_connection_generation', 'target_connection_generation'])

export function builtinSchema(tool: AgentTool, adapter: BuiltinToolAdapter): AgentTool['parameters'] {
  const properties = { ...toolProperties(tool) }
  const managed = new Set(adapter.managed)
  const raw: unknown = tool.parameters
  const required = isRecord(raw) && Array.isArray(raw.required) ? raw.required : []
  for (const field of managed) if (hidden.has(field)) delete properties[field]
  if (managed.has('items[].expected_updated_at') && isRecord(properties.items) && isRecord(properties.items.items)) {
    const item = properties.items.items
    properties.items = { ...properties.items, items: { ...item, required: Array.isArray(item.required) ? item.required.filter((v) => v !== 'expected_updated_at') : [] } }
  }
  if (adapter.adapter === 'operation') properties.tool_call_id = { type: 'string', minLength: 1, maxLength: 256, description: 'The original pointer, keyboard, clipboard, or resize tool call ID. Query its outcome; never replay an uncertain action.' }
  return { ...tool.parameters, properties, required: [
    ...required.filter((field) => !managed.has(String(field))),
    ...(adapter.adapter === 'operation' ? ['tool_call_id'] : []),
  ] }
}
