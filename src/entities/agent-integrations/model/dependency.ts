import type { MCPDependency } from '#common/agent-integrations'

export function decodeDependency(value: unknown): MCPDependency {
  const record = (input: unknown): input is Record<string, unknown> => typeof input === 'object' && input !== null && !Array.isArray(input)
  if (!record(value) || typeof value.id !== 'string' || !/^prep_[a-f0-9]{32}$/u.test(value.id)
    || typeof value.source_id !== 'string' || !Number.isSafeInteger(value.revision)
    || !['preview', 'preparing', 'verifying', 'ready', 'failed', 'cancelled', 'uncertain'].includes(String(value.state))
    || !record(value.package) || !['name', 'version', 'entry', 'integrity'].every(key => typeof value.package === 'object' && value.package !== null && typeof (value.package as Record<string, unknown>)[key] === 'string')
    || !Array.isArray(value.package.arguments) || !value.package.arguments.every(item => typeof item === 'string')
    || !record(value.runtime) || typeof value.runtime.node !== 'string') throw new Error('INTEGRATION_RESPONSE_INVALID')
  return value as unknown as MCPDependency
}
