import type { TSchema } from 'typebox'
import { isRecord } from './validation.ts'

export interface WebSearchContext { tools: { 'termous.web.search': { description: string; inputSchema: TSchema } } }
export function isWebSearchContext(value: unknown): value is WebSearchContext {
  if (!isRecord(value) || !isRecord(value.tools) || Object.keys(value.tools).length !== 1) return false
  const tool = value.tools['termous.web.search']
  return isRecord(tool) && typeof tool.description === 'string' && tool.description.length <= 4096
    && isRecord(tool.inputSchema) && tool.inputSchema.type === 'object' && JSON.stringify(tool.inputSchema).length <= 16384
}
