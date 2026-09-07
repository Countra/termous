import { createHash } from 'node:crypto'

export const agentSkillBundleFormatVersion = 1 as const
export const readSkillResourceToolName = 'read_skill_resource'

export interface AgentSkillCatalogEntry {
  name: string
  description: string
  entry_uri: string
}

export interface AgentSkillResource {
  uri: string
  sha256: string
  size: number
  media_type: 'text/markdown; charset=utf-8' | 'application/yaml; charset=utf-8'
  content: string
}

export interface AgentSkillBundleSnapshot {
  format_version: typeof agentSkillBundleFormatVersion
  fingerprint: string
  catalog: readonly AgentSkillCatalogEntry[]
  resources: readonly AgentSkillResource[]
}

export function createAgentSkillBundleSnapshot(
  catalogInput: AgentSkillCatalogEntry[],
  resourcesInput: AgentSkillResource[],
): AgentSkillBundleSnapshot {
  const catalog = catalogInput
    .map((entry) => ({ ...entry }))
    .sort((left, right) => compareASCII(left.name, right.name))
  const resources = resourcesInput
    .map((resource) => ({ ...resource }))
    .sort((left, right) => compareASCII(left.uri, right.uri))
  assertSnapshotEntries(catalog, resources)
  const fingerprint = calculateAgentSkillBundleFingerprint(catalog, resources)
  return Object.freeze({
    format_version: agentSkillBundleFormatVersion,
    fingerprint,
    catalog: Object.freeze(catalog.map((entry) => Object.freeze(entry))),
    resources: Object.freeze(resources.map((resource) => Object.freeze(resource))),
  })
}

export function isAgentSkillBundleSnapshot(value: unknown): value is AgentSkillBundleSnapshot {
  if (!isRecord(value)
    || value.format_version !== agentSkillBundleFormatVersion
    || !Array.isArray(value.catalog)
    || !Array.isArray(value.resources)) {
    return false
  }
  try {
    const snapshot = createAgentSkillBundleSnapshot(
      value.catalog as AgentSkillCatalogEntry[],
      value.resources as AgentSkillResource[],
    )
    return value.fingerprint === snapshot.fingerprint
  } catch {
    return false
  }
}

export function calculateAgentSkillBundleFingerprint(
  catalog: readonly AgentSkillCatalogEntry[],
  resources: readonly AgentSkillResource[],
) {
  const canonical = JSON.stringify({
    format_version: agentSkillBundleFormatVersion,
    catalog: catalog.map(({ name, description, entry_uri }) => ({
      name,
      description,
      entry_uri,
    })),
    resources: resources.map(({ uri, sha256, size, media_type }) => ({
      uri,
      sha256,
      size,
      media_type,
    })),
  })
  return sha256(canonical)
}

export function skillResourceURI(skillName: string, relativePath: string) {
  return `skill://${skillName}/${relativePath}`
}

function assertSnapshotEntries(
  catalog: AgentSkillCatalogEntry[],
  resources: AgentSkillResource[],
) {
  if (catalog.length === 0 || catalog.length > 64 || resources.length < catalog.length
    || resources.length > 256) {
    throw new Error('AGENT_SKILLS_SNAPSHOT_INVALID')
  }
  const names = new Set<string>()
  for (const entry of catalog) {
    if (!validSkillName(entry.name)
      || names.has(entry.name)
      || typeof entry.description !== 'string'
      || entry.description.trim() === ''
      || Buffer.byteLength(entry.description, 'utf8') > 4096
      || entry.entry_uri !== skillResourceURI(entry.name, 'SKILL.md')) {
      throw new Error('AGENT_SKILLS_CATALOG_INVALID')
    }
    names.add(entry.name)
  }
  const uris = new Set<string>()
  let totalBytes = 0
  for (const resource of resources) {
    if (!validSkillURI(resource.uri, names)
      || uris.has(resource.uri)
      || !validSha256(resource.sha256)
      || !Number.isSafeInteger(resource.size)
      || resource.size < 0
      || resource.size > 512 * 1024
      || (resource.media_type !== 'text/markdown; charset=utf-8'
        && resource.media_type !== 'application/yaml; charset=utf-8')
      || typeof resource.content !== 'string') {
      throw new Error('AGENT_SKILLS_RESOURCE_INVALID')
    }
    const contentBytes = Buffer.byteLength(resource.content, 'utf8')
    if (contentBytes !== resource.size || sha256(resource.content) !== resource.sha256) {
      throw new Error('AGENT_SKILLS_RESOURCE_INTEGRITY_FAILED')
    }
    totalBytes += contentBytes
    if (totalBytes > 4 * 1024 * 1024) {
      throw new Error('AGENT_SKILLS_BUNDLE_TOO_LARGE')
    }
    uris.add(resource.uri)
  }
  for (const entry of catalog) {
    if (!uris.has(entry.entry_uri)) {
      throw new Error('AGENT_SKILLS_ENTRY_MISSING')
    }
  }
}

function validSkillURI(value: unknown, names: Set<string>) {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) {
    return false
  }
  const match = /^skill:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/.exec(value)
  if (!match || !names.has(match[1] ?? '')) {
    return false
  }
  const segments = (match[2] ?? '').split('/')
  return segments.length > 0
    && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function validSkillName(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && value.length <= 64
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function compareASCII(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
