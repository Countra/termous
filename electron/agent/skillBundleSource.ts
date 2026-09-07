import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import type { AgentSkillsBundleStatus } from '#common/contracts'
import { parse as parseYaml } from 'yaml'
import {
  createAgentSkillBundleSnapshot,
  skillResourceURI,
  type AgentSkillBundleSnapshot,
  type AgentSkillCatalogEntry,
  type AgentSkillResource,
} from './skillBundle.ts'
import { AgentSkillBundleError, stableSkillBundleErrorCategory } from './skillBundleError.ts'
import {
  agentSkillManifestFileName,
  parseAgentSkillProductionManifest,
  resolveAgentSkillManifestResourcePath,
} from './skillBundleManifest.ts'

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface AgentSkillBundleSourcePort {
  inspect(): Promise<AgentSkillsBundleStatus>
  snapshot(): Promise<AgentSkillBundleSnapshot>
}

export interface AgentSkillBundleSourceOptions {
  mode: 'development' | 'production'
  rootDirectory: string
}

export class AgentSkillBundleSource implements AgentSkillBundleSourcePort {
  private readonly mode: AgentSkillBundleSourceOptions['mode']
  private readonly rootDirectory: string

  constructor(options: AgentSkillBundleSourceOptions) {
    this.mode = options.mode
    this.rootDirectory = path.resolve(options.rootDirectory)
  }

  async inspect(): Promise<AgentSkillsBundleStatus> {
    try {
      const snapshot = await this.snapshot()
      return {
        status: 'ready',
        fingerprint: snapshot.fingerprint,
        skill_count: snapshot.catalog.length,
        resource_count: snapshot.resources.length,
      }
    } catch (error) {
      const category = stableSkillBundleErrorCategory(error)
      return {
        status: category === 'bundle_missing'
          ? 'missing'
          : category === 'bundle_unavailable'
            ? 'unavailable'
            : 'outdated',
        fingerprint: '',
        skill_count: 0,
        resource_count: 0,
        error_category: category,
      }
    }
  }

  async snapshot() {
    await assertCanonicalDirectory(this.rootDirectory, 'root_invalid')
    return this.mode === 'development'
      ? this.readDevelopmentSnapshot()
      : this.readProductionSnapshot()
  }

  private async readDevelopmentSnapshot() {
    const entries = await readdir(this.rootDirectory, { withFileTypes: true })
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareASCII)
    if (directories.length === 0 || entries.some((entry) => !entry.isDirectory())) {
      throw new AgentSkillBundleError('development_layout_invalid')
    }
    const catalog: AgentSkillCatalogEntry[] = []
    const resources: AgentSkillResource[] = []
    for (const skillName of directories) {
      if (!skillNamePattern.test(skillName)) {
        throw new AgentSkillBundleError('skill_name_invalid')
      }
      const skillRoot = path.join(this.rootDirectory, skillName)
      await assertCanonicalDirectory(skillRoot, 'skill_directory_invalid')
      const relativeFiles = await listDevelopmentSkillFiles(skillRoot)
      const skillResources = await Promise.all(relativeFiles.map((relativePath) =>
        readResource(skillRoot, skillName, relativePath)))
      const entry = skillResources.find((resource) =>
        resource.uri === skillResourceURI(skillName, 'SKILL.md'))
      if (!entry) {
        throw new AgentSkillBundleError('skill_entry_missing')
      }
      catalog.push({
        name: skillName,
        description: readSkillDescription(entry.content, skillName),
        entry_uri: entry.uri,
      })
      resources.push(...skillResources)
    }
    return createAgentSkillBundleSnapshot(catalog, resources)
  }

  private async readProductionSnapshot() {
    const manifestPath = path.join(this.rootDirectory, agentSkillManifestFileName)
    const manifestContent = await readOrdinaryUTF8File(
      this.rootDirectory,
      manifestPath,
      'manifest_invalid',
    )
    const manifest = parseAgentSkillProductionManifest(manifestContent)
    const diskFiles = await listAllFiles(this.rootDirectory)
    const expectedPaths = new Set([agentSkillManifestFileName, ...manifest.resources.map((item) => item.path)])
    if (diskFiles.length !== expectedPaths.size
      || diskFiles.some((relativePath) => !expectedPaths.has(relativePath))) {
      throw new AgentSkillBundleError('manifest_file_set_mismatch')
    }
    const resources = await Promise.all(manifest.resources.map(async (item) => {
      const absolutePath = resolveAgentSkillManifestResourcePath(this.rootDirectory, item.path)
      const content = await readOrdinaryUTF8File(
        this.rootDirectory,
        absolutePath,
        'resource_invalid',
      )
      if (Buffer.byteLength(content, 'utf8') !== item.size
        || sha256(content) !== item.sha256) {
        throw new AgentSkillBundleError('resource_integrity_failed')
      }
      return {
        uri: item.uri,
        sha256: item.sha256,
        size: item.size,
        media_type: item.media_type,
        content,
      } satisfies AgentSkillResource
    }))
    const snapshot = createAgentSkillBundleSnapshot(manifest.catalog, resources)
    if (snapshot.fingerprint !== manifest.fingerprint) {
      throw new AgentSkillBundleError('manifest_fingerprint_mismatch')
    }
    return snapshot
  }
}

async function listDevelopmentSkillFiles(skillRoot: string) {
  const rootEntries = await readdir(skillRoot, { withFileTypes: true })
  const rootNames = new Set(rootEntries.map((entry) => entry.name))
  if (!rootNames.has('SKILL.md')
    || [...rootNames].some((name) => name !== 'SKILL.md' && name !== 'references' && name !== 'agents')) {
    throw new AgentSkillBundleError('skill_layout_invalid')
  }
  const files = ['SKILL.md']
  if (rootNames.has('references')) {
    files.push(...await listFilesBelow(skillRoot, 'references', '.md'))
  }
  if (rootNames.has('agents')) {
    const agentFiles = await listFilesBelow(skillRoot, 'agents', '.yaml')
    if (agentFiles.length !== 1 || agentFiles[0] !== 'agents/openai.yaml') {
      throw new AgentSkillBundleError('agent_metadata_invalid')
    }
    files.push(...agentFiles)
  }
  return files.sort(compareASCII)
}

async function listFilesBelow(root: string, relativeDirectory: string, extension?: string) {
  const directory = path.join(root, ...relativeDirectory.split('/'))
  await assertCanonicalDirectory(directory, 'resource_directory_invalid')
  const result: string[] = []
  const visit = async (absoluteDirectory: string, prefix: string) => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => compareASCII(left.name, right.name))) {
      const relativePath = `${prefix}/${entry.name}`
      const absolutePath = path.join(absoluteDirectory, entry.name)
      if (entry.isSymbolicLink()) {
        throw new AgentSkillBundleError('symbolic_link_rejected')
      }
      if (entry.isDirectory()) {
        await assertCanonicalDirectory(absolutePath, 'resource_directory_invalid')
        await visit(absolutePath, relativePath)
      } else if (entry.isFile() && (!extension || entry.name.endsWith(extension))) {
        result.push(relativePath)
      } else {
        throw new AgentSkillBundleError('resource_file_type_invalid')
      }
    }
  }
  await visit(directory, relativeDirectory)
  return result
}

async function listAllFiles(root: string) {
  const result: string[] = []
  const visit = async (absoluteDirectory: string, prefix: string) => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => compareASCII(left.name, right.name))) {
      if (entry.isSymbolicLink()) {
        throw new AgentSkillBundleError('symbolic_link_rejected')
      }
      const absolutePath = path.join(absoluteDirectory, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await assertCanonicalDirectory(absolutePath, 'resource_directory_invalid')
        await visit(absolutePath, relativePath)
      } else if (entry.isFile()) {
        result.push(relativePath)
      } else {
        throw new AgentSkillBundleError('resource_file_type_invalid')
      }
    }
  }
  await visit(root, '')
  return result.sort(compareASCII)
}

async function readResource(root: string, skillName: string, relativePath: string) {
  const absolutePath = path.join(root, ...relativePath.split('/'))
  const content = await readOrdinaryUTF8File(root, absolutePath, 'resource_invalid')
  return {
    uri: skillResourceURI(skillName, relativePath),
    sha256: sha256(content),
    size: Buffer.byteLength(content, 'utf8'),
    media_type: relativePath.endsWith('.yaml')
      ? 'application/yaml; charset=utf-8'
      : 'text/markdown; charset=utf-8',
    content,
  } satisfies AgentSkillResource
}

async function readOrdinaryUTF8File(root: string, filePath: string, category: string) {
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(filePath, 'r')
    const handleInfo = await handle.stat({ bigint: true })
    const pathInfo = await lstat(filePath, { bigint: true })
    if (!handleInfo.isFile()
      || !pathInfo.isFile()
      || pathInfo.isSymbolicLink()
      || handleInfo.size > BigInt(512 * 1024)
      || !sameFileIdentity(handleInfo, pathInfo)) {
      throw new AgentSkillBundleError(category)
    }
    const resolved = await realpath(filePath)
    if (!samePath(resolved, filePath) || !strictChildPath(resolved, root)) {
      throw new AgentSkillBundleError('resource_path_invalid')
    }
    const content = await handle.readFile({ encoding: 'utf8' })
    const finalPathInfo = await lstat(filePath, { bigint: true })
    const finalResolved = await realpath(filePath)
    if (!finalPathInfo.isFile()
      || finalPathInfo.isSymbolicLink()
      || !sameFileIdentity(handleInfo, finalPathInfo)
      || !samePath(finalResolved, filePath)
      || !strictChildPath(finalResolved, root)) {
      throw new AgentSkillBundleError('resource_changed_during_read')
    }
    return content
  } catch (error) {
    if (error instanceof AgentSkillBundleError) {
      throw error
    }
    throw new AgentSkillBundleError(
      (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
        ? category
        : 'bundle_unavailable',
      error,
    )
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function assertCanonicalDirectory(directory: string, category: string) {
  try {
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new AgentSkillBundleError(category)
    }
    const resolved = await realpath(directory)
    if (!samePath(resolved, directory)) {
      throw new AgentSkillBundleError(category)
    }
  } catch (error) {
    if (error instanceof AgentSkillBundleError) {
      throw error
    }
    throw new AgentSkillBundleError(
      (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
        ? category === 'root_invalid' ? 'bundle_missing' : category
        : 'bundle_unavailable',
      error,
    )
  }
}

function readSkillDescription(content: string, expectedName: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content)
  if (!match) {
    throw new AgentSkillBundleError('skill_frontmatter_invalid')
  }
  let value: unknown
  try {
    value = parseYaml(match[1] ?? '')
  } catch (error) {
    throw new AgentSkillBundleError('skill_frontmatter_invalid', error)
  }
  if (!isRecord(value)
    || value.name !== expectedName
    || typeof value.description !== 'string'
    || value.description.trim() === '') {
    throw new AgentSkillBundleError('skill_frontmatter_invalid')
  }
  return value.description.trim()
}

function strictChildPath(candidate: string, root: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '' && relative !== '..'
    && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function samePath(left: string, right: string) {
  const normalizedLeft = path.normalize(path.resolve(left))
  const normalizedRight = path.normalize(path.resolve(right))
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
}

function compareASCII(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
