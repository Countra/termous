import path from 'node:path'
import {
  agentSkillBundleFormatVersion,
  calculateAgentSkillBundleFingerprint,
  skillResourceURI,
  type AgentSkillCatalogEntry,
  type AgentSkillResource,
} from './skillBundle.ts'
import { AgentSkillBundleError } from './skillBundleError.ts'

export const agentSkillManifestFileName = 'manifest.json'

export interface AgentSkillManifestResource {
  uri: string
  path: string
  sha256: string
  size: number
  media_type: AgentSkillResource['media_type']
}

export interface AgentSkillProductionManifest {
  format_version: typeof agentSkillBundleFormatVersion
  fingerprint: string
  catalog: AgentSkillCatalogEntry[]
  resources: AgentSkillManifestResource[]
}

export function parseAgentSkillProductionManifest(content: string): AgentSkillProductionManifest {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new AgentSkillBundleError('manifest_invalid', error)
  }
  if (!isRecord(value)
    || !exactKeys(value, ['format_version', 'fingerprint', 'catalog', 'resources'])
    || value.format_version !== agentSkillBundleFormatVersion
    || typeof value.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || !Array.isArray(value.catalog)
    || value.catalog.length === 0
    || value.catalog.length > 64
    || !Array.isArray(value.resources)
    || value.resources.length < value.catalog.length
    || value.resources.length > 256) {
    throw new AgentSkillBundleError('manifest_invalid')
  }
  const catalog = value.catalog.map(parseCatalogEntry)
  const resources = value.resources.map(parseManifestResource)
  assertUnique(catalog.map((entry) => entry.name), 'manifest_catalog_duplicate')
  assertUnique(resources.map((resource) => resource.uri), 'manifest_resource_duplicate')
  assertUnique(resources.map((resource) => resource.path), 'manifest_resource_path_duplicate')
  for (const resource of resources) {
    validateResourceMapping(resource)
  }
  const resourceURIs = new Set(resources.map((resource) => resource.uri))
  if (catalog.some((entry) => !resourceURIs.has(entry.entry_uri))) {
    throw new AgentSkillBundleError('manifest_entry_missing')
  }
  const metadataFingerprint = calculateAgentSkillBundleFingerprint(catalog, resources.map((item) => ({
    uri: item.uri,
    sha256: item.sha256,
    size: item.size,
    media_type: item.media_type,
    content: '',
  })))
  if (metadataFingerprint !== value.fingerprint) {
    throw new AgentSkillBundleError('manifest_fingerprint_mismatch')
  }
  return {
    format_version: agentSkillBundleFormatVersion,
    fingerprint: value.fingerprint,
    catalog,
    resources,
  }
}

export function resolveAgentSkillManifestResourcePath(root: string, relativePath: string) {
  validateManifestRelativePath(relativePath)
  const resolved = path.resolve(root, ...relativePath.split('/'))
  if (!strictChildPath(resolved, root)) {
    throw new AgentSkillBundleError('resource_path_invalid')
  }
  return resolved
}

function parseCatalogEntry(value: unknown): AgentSkillCatalogEntry {
  if (!isRecord(value)
    || !exactKeys(value, ['name', 'description', 'entry_uri'])
    || typeof value.name !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name)
    || value.name.length > 64
    || typeof value.description !== 'string'
    || value.description.trim() === ''
    || Buffer.byteLength(value.description, 'utf8') > 4096
    || value.entry_uri !== skillResourceURI(value.name, 'SKILL.md')) {
    throw new AgentSkillBundleError('manifest_catalog_invalid')
  }
  return { name: value.name, description: value.description, entry_uri: value.entry_uri }
}

function parseManifestResource(value: unknown): AgentSkillManifestResource {
  if (!isRecord(value)
    || !exactKeys(value, ['uri', 'path', 'sha256', 'size', 'media_type'])
    || typeof value.uri !== 'string'
    || !validSkillURI(value.uri)
    || typeof value.path !== 'string'
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.size)
    || Number(value.size) < 0
    || Number(value.size) > 512 * 1024
    || (value.media_type !== 'text/markdown; charset=utf-8'
      && value.media_type !== 'application/yaml; charset=utf-8')) {
    throw new AgentSkillBundleError('manifest_resource_invalid')
  }
  validateManifestRelativePath(value.path)
  return {
    uri: value.uri,
    path: value.path,
    sha256: value.sha256,
    size: Number(value.size),
    media_type: value.media_type,
  }
}

function validateResourceMapping(resource: AgentSkillManifestResource) {
  const match = /^skill:\/\/([^/]+)\/(.+)$/.exec(resource.uri)
  if (!match || resource.path !== `${match[1]}/${match[2]}`) {
    throw new AgentSkillBundleError('manifest_resource_mapping_invalid')
  }
}

function validSkillURI(value: string) {
  if (value.includes('\\') || value.includes('\0')) {
    return false
  }
  const match = /^skill:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/.exec(value)
  if (!match) {
    return false
  }
  try {
    validateManifestRelativePath(match[2] ?? '')
    return true
  } catch {
    return false
  }
}

function assertUnique(values: string[], category: string) {
  if (new Set(values).size !== values.length) {
    throw new AgentSkillBundleError(category)
  }
}

function validateManifestRelativePath(value: string) {
  const segments = value.split('/')
  if (value === '' || value.includes('\\') || path.isAbsolute(value)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new AgentSkillBundleError('manifest_path_invalid')
  }
}

function strictChildPath(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '' && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const sortedExpected = [...expected].sort(compareASCII)
  const keys = Object.keys(value).sort(compareASCII)
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function compareASCII(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
