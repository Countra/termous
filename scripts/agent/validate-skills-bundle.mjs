import { createHash } from 'node:crypto'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

const formatVersion = 1

export async function validateAgentSkillsBundleDirectory(rootDirectory) {
  const root = path.resolve(rootDirectory)
  await assertCanonicalDirectory(root)
  const manifestContent = await readVerifiedFile(root, path.join(root, 'manifest.json'))
  const manifest = parseManifest(manifestContent)
  const actualFiles = await listFiles(root)
  const expectedFiles = new Set(['manifest.json', ...manifest.resources.map((resource) => resource.path)])
  if (actualFiles.length !== expectedFiles.size
    || actualFiles.some((filePath) => !expectedFiles.has(filePath))) {
    throw new Error('AGENT_SKILLS_MANIFEST_FILE_SET_MISMATCH')
  }

  let totalBytes = 0
  for (const resource of manifest.resources) {
    const content = await readVerifiedFile(root, path.join(root, ...resource.path.split('/')))
    const size = Buffer.byteLength(content, 'utf8')
    if (size !== resource.size || sha256(content) !== resource.sha256) {
      throw new Error('AGENT_SKILLS_RESOURCE_INTEGRITY_FAILED')
    }
    totalBytes += size
  }
  if (totalBytes > 4 * 1024 * 1024) {
    throw new Error('AGENT_SKILLS_BUNDLE_TOO_LARGE')
  }
  return manifest
}

export function parseAgentSkillsManifest(content) {
  return parseManifest(content)
}

function parseManifest(content) {
  let value
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new Error('AGENT_SKILLS_MANIFEST_INVALID', { cause: error })
  }
  if (!isRecord(value)
    || !exactKeys(value, ['format_version', 'fingerprint', 'catalog', 'resources'])
    || value.format_version !== formatVersion
    || typeof value.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || !Array.isArray(value.catalog)
    || value.catalog.length === 0
    || value.catalog.length > 64
    || !Array.isArray(value.resources)
    || value.resources.length < value.catalog.length
    || value.resources.length > 256) {
    throw new Error('AGENT_SKILLS_MANIFEST_INVALID')
  }
  const catalog = value.catalog.map(parseCatalogEntry).sort((left, right) => compareASCII(left.name, right.name))
  const resources = value.resources.map(parseResource).sort((left, right) => compareASCII(left.uri, right.uri))
  assertUnique(catalog.map((entry) => entry.name), 'AGENT_SKILLS_CATALOG_DUPLICATE')
  assertUnique(resources.map((resource) => resource.uri), 'AGENT_SKILLS_RESOURCE_DUPLICATE')
  assertUnique(resources.map((resource) => resource.path), 'AGENT_SKILLS_RESOURCE_PATH_DUPLICATE')
  const resourceURIs = new Set(resources.map((resource) => resource.uri))
  if (catalog.some((entry) => !resourceURIs.has(entry.entry_uri))) {
    throw new Error('AGENT_SKILLS_ENTRY_MISSING')
  }
  const fingerprint = calculateFingerprint(catalog, resources)
  if (fingerprint !== value.fingerprint) {
    throw new Error('AGENT_SKILLS_MANIFEST_FINGERPRINT_MISMATCH')
  }
  return { format_version: formatVersion, fingerprint, catalog, resources }
}

function parseCatalogEntry(value) {
  if (!isRecord(value)
    || !exactKeys(value, ['name', 'description', 'entry_uri'])
    || typeof value.name !== 'string'
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name)
    || value.name.length > 64
    || typeof value.description !== 'string'
    || value.description.trim() === ''
    || Buffer.byteLength(value.description, 'utf8') > 4096
    || value.entry_uri !== `skill://${value.name}/SKILL.md`) {
    throw new Error('AGENT_SKILLS_CATALOG_INVALID')
  }
  return { name: value.name, description: value.description, entry_uri: value.entry_uri }
}

function parseResource(value) {
  if (!isRecord(value)
    || !exactKeys(value, ['uri', 'path', 'sha256', 'size', 'media_type'])
    || typeof value.uri !== 'string'
    || !validSkillURI(value.uri)
    || typeof value.path !== 'string'
    || !validRelativePath(value.path)
    || typeof value.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.size)
    || value.size < 0
    || value.size > 512 * 1024
    || (value.media_type !== 'text/markdown; charset=utf-8'
      && value.media_type !== 'application/yaml; charset=utf-8')) {
    throw new Error('AGENT_SKILLS_RESOURCE_INVALID')
  }
  const uriPath = value.uri.replace(/^skill:\/\/[^/]+\//, '')
  const skillName = /^skill:\/\/([^/]+)\//.exec(value.uri)?.[1]
  if (value.path !== `${skillName}/${uriPath}`) {
    throw new Error('AGENT_SKILLS_RESOURCE_MAPPING_INVALID')
  }
  return {
    uri: value.uri,
    path: value.path,
    sha256: value.sha256,
    size: value.size,
    media_type: value.media_type,
  }
}

async function listFiles(root) {
  const files = []
  const pending = [{ directory: root, prefix: '' }]
  while (pending.length > 0) {
    const current = pending.pop()
    const entries = await readdir(current.directory, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = current.prefix ? `${current.prefix}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        throw new Error('AGENT_SKILLS_SYMBOLIC_LINK_REJECTED')
      }
      if (entry.isDirectory()) {
        pending.push({ directory: path.join(current.directory, entry.name), prefix: relativePath })
      } else if (entry.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error('AGENT_SKILLS_FILE_TYPE_INVALID')
      }
    }
  }
  return files.sort(compareASCII)
}

async function readVerifiedFile(root, filePath) {
  let handle = null
  try {
    handle = await open(filePath, 'r')
    const handleInfo = await handle.stat({ bigint: true })
    const pathInfo = await lstat(filePath, { bigint: true })
    const resolved = await realpath(filePath)
    if (!handleInfo.isFile()
      || !pathInfo.isFile()
      || pathInfo.isSymbolicLink()
      || !sameIdentity(handleInfo, pathInfo)
      || !isChildPath(resolved, root)) {
      throw new Error('AGENT_SKILLS_FILE_INVALID')
    }
    const content = await handle.readFile({ encoding: 'utf8' })
    const finalInfo = await lstat(filePath, { bigint: true })
    const finalResolved = await realpath(filePath)
    if (!finalInfo.isFile()
      || finalInfo.isSymbolicLink()
      || !sameIdentity(handleInfo, finalInfo)
      || !samePath(resolved, finalResolved)
      || !isChildPath(finalResolved, root)) {
      throw new Error('AGENT_SKILLS_FILE_CHANGED_DURING_READ')
    }
    return content
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function assertCanonicalDirectory(directory) {
  const info = await lstat(directory)
  const resolved = await realpath(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(resolved, directory)) {
    throw new Error('AGENT_SKILLS_ROOT_INVALID')
  }
}

function calculateFingerprint(catalog, resources) {
  return sha256(JSON.stringify({
    format_version: formatVersion,
    catalog: catalog.map(({ name, description, entry_uri }) => ({ name, description, entry_uri })),
    resources: resources.map(({ uri, sha256: hash, size, media_type }) => ({ uri, sha256: hash, size, media_type })),
  }))
}

function validSkillURI(value) {
  if (value.includes('\\') || value.includes('\0')) return false
  const match = /^skill:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/.exec(value)
  return Boolean(match && validRelativePath(match[2]))
}

function validRelativePath(value) {
  const segments = value.split('/')
  return value !== '' && !value.includes('\\') && !path.isAbsolute(value)
    && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function assertUnique(values, code) {
  if (new Set(values).size !== values.length) throw new Error(code)
}

function exactKeys(value, expected) {
  const keys = Object.keys(value).sort(compareASCII)
  const sortedExpected = [...expected].sort(compareASCII)
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function isChildPath(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function samePath(left, right) {
  const normalizedLeft = path.normalize(path.resolve(left))
  const normalizedRight = path.normalize(path.resolve(right))
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function compareASCII(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
