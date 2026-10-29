import type { AgentIntegrationSource, SkillImportPreview, ImportedSkillManifest } from '#common/agent-integrations'

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function invalid(): never { throw new Error('INTEGRATION_RESPONSE_INVALID') }
function manifest(value: unknown): ImportedSkillManifest {
  if (!record(value) || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/u.test(value.version) || typeof value.name !== 'string'
    || typeof value.description !== 'string' || typeof value.allow_implicit !== 'boolean' || !Array.isArray(value.files) || value.files.length > 256) return invalid()
  for (const file of value.files) if (!record(file) || typeof file.path !== 'string' || typeof file.mime_type !== 'string'
    || !record(file.object) || typeof file.object.sha256 !== 'string' || !Number.isSafeInteger(file.object.size_bytes)) return invalid()
  return value as unknown as ImportedSkillManifest
}
export function decodeIntegrationSource(value: unknown): AgentIntegrationSource {
  if (!record(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || !['mcp', 'skill'].includes(String(value.kind))
    || typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return invalid()
  if (value.kind === 'skill') manifest(value.skill)
  if (value.kind === 'mcp' && (!record(value.mcp) || !['stdio', 'http'].includes(String(value.mcp.transport)))) return invalid()
  return value as unknown as AgentIntegrationSource
}
export function decodeIntegrationSources(value: unknown) {
  if (!Array.isArray(value) || value.length > 128) return invalid()
  return value.map(decodeIntegrationSource)
}
export function decodeSkillPreview(value: unknown): SkillImportPreview {
  if (!record(value) || typeof value.token !== 'string' || !Array.isArray(value.warnings) || !value.warnings.every(item => typeof item === 'string')) return invalid()
  return { token: value.token, warnings: value.warnings, manifest: manifest(value.manifest) }
}
