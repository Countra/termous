import type { TSchema } from 'typebox'
import { isRecord } from './validation.ts'

export interface LocalToolContext {
  directory: { path: string; managed: boolean; revision: number }
  environment: { platform: string; default_shell: string; shells: Array<{ name: string; executable: string }> }
  unavailable_reason?: string
  tools: Record<string, { description: string; inputSchema: TSchema }>
}

export function isLocalToolContext(value: unknown): value is LocalToolContext {
  if (!isRecord(value) || !isRecord(value.directory) || typeof value.directory.path !== 'string'
    || typeof value.directory.managed !== 'boolean' || !Number.isSafeInteger(value.directory.revision)
    || !isRecord(value.environment) || typeof value.environment.platform !== 'string'
    || typeof value.environment.default_shell !== 'string' || !Array.isArray(value.environment.shells)
    || value.environment.shells.length > 8 || !value.environment.shells.every(shell => isRecord(shell)
      && typeof shell.name === 'string' && typeof shell.executable === 'string')
    || value.unavailable_reason !== undefined && typeof value.unavailable_reason !== 'string'
    || !isRecord(value.tools) || Object.keys(value.tools).length > 32) return false
  return Object.entries(value.tools).every(([name, tool]) => /^termous\.local\.[a-z_.]+$/u.test(name)
    && isRecord(tool) && typeof tool.description === 'string' && isRecord(tool.inputSchema) && tool.inputSchema.type === 'object')
}

export interface LocalToolCall { tool_call_id: string; tool: string; arguments: unknown }
