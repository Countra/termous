import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { validateAgentSkillsBundleDirectory } from './validate-skills-bundle.mjs'

const formatVersion = 1
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const webDirectory = path.resolve(scriptDirectory, '..', '..')
const defaultSkillsDirectory = path.resolve(webDirectory, '..', 'termous-skills', 'skills')
const defaultBackendDirectory = path.resolve(webDirectory, '..', 'backend')
const defaultOutputDirectory = path.resolve(webDirectory, 'build', 'agent', 'skills')
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function prepareAgentSkillsBundle(options = {}) {
  const sourceDirectory = path.resolve(options.sourceDirectory ?? process.env.TERMOUS_SKILLS_DIR ?? defaultSkillsDirectory)
  const backendDirectory = path.resolve(options.backendDirectory ?? process.env.TERMOUS_CORE_DIR ?? defaultBackendDirectory)
  const outputDirectory = path.resolve(options.outputDirectory ?? defaultOutputDirectory)
  const skillsRepository = path.dirname(sourceDirectory)
  const validatorPath = path.join(skillsRepository, 'scripts', 'validate_skills.py')

  await assertCanonicalDirectory(sourceDirectory, 'Skills 源目录')
  await assertCanonicalDirectory(backendDirectory, 'Backend 目录')
  if (options.validate !== false) {
    await assertOrdinaryFile(validatorPath, skillsRepository, 'Skills 校验脚本')
    runSkillsValidator({
      backendDirectory,
      skillsRepository,
      validatorPath,
      spawn: options.spawn ?? spawnSync,
      python: options.python,
    })
  }

  const bundle = await collectBundle(sourceDirectory)
  const stagingDirectory = `${outputDirectory}.tmp-${process.pid}-${randomUUID()}`
  const backupDirectory = `${outputDirectory}.previous-${process.pid}-${randomUUID()}`
  await mkdir(path.dirname(outputDirectory), { recursive: true })
  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })
  try {
    for (const resource of bundle.resources) {
      const targetPath = path.join(stagingDirectory, ...resource.path.split('/'))
      await mkdir(path.dirname(targetPath), { recursive: true })
      await writeFile(targetPath, resource.content, 'utf8')
    }
    const manifest = {
      format_version: formatVersion,
      fingerprint: bundle.fingerprint,
      catalog: bundle.catalog,
      resources: bundle.resources.map(({ uri, path: resourcePath, sha256, size, media_type }) => ({
        uri,
        path: resourcePath,
        sha256,
        size,
        media_type,
      })),
    }
    await writeFile(path.join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await validateAgentSkillsBundleDirectory(stagingDirectory)
    await replaceDirectory(stagingDirectory, outputDirectory, backupDirectory)
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
  return { ...bundle, outputDirectory }
}

export function runSkillsValidator({ backendDirectory, skillsRepository, validatorPath, spawn, python }) {
  const executable = python ?? process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  const result = spawn(executable, [validatorPath, '--backend-root', backendDirectory], {
    cwd: skillsRepository,
    encoding: 'utf8',
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) {
    throw new Error(`无法启动 Skills 合同校验: ${result.error.message}`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`Skills 合同校验失败，退出码: ${result.status ?? 'unknown'}`)
  }
}

async function collectBundle(sourceDirectory) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true })
  if (entries.length === 0 || entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
    throw new Error('Skills 源目录只能包含普通 Skill 目录')
  }
  const catalog = []
  const resources = []
  for (const entry of entries.sort((left, right) => compareASCII(left.name, right.name))) {
    if (!skillNamePattern.test(entry.name)) {
      throw new Error(`Skill 名称不合法: ${entry.name}`)
    }
    const skillRoot = path.join(sourceDirectory, entry.name)
    const relativeFiles = await collectSkillFiles(skillRoot)
    const skillResources = []
    for (const relativePath of relativeFiles) {
      const absolutePath = path.join(skillRoot, ...relativePath.split('/'))
      const content = await readOrdinaryUTF8File(absolutePath, skillRoot)
      const resourcePath = `${entry.name}/${relativePath}`
      skillResources.push({
        uri: `skill://${entry.name}/${relativePath}`,
        path: resourcePath,
        sha256: sha256(content),
        size: Buffer.byteLength(content, 'utf8'),
        media_type: relativePath.endsWith('.yaml')
          ? 'application/yaml; charset=utf-8'
          : 'text/markdown; charset=utf-8',
        content,
      })
    }
    const skillEntry = skillResources.find((resource) => resource.path === `${entry.name}/SKILL.md`)
    if (!skillEntry) {
      throw new Error(`Skill 缺少 SKILL.md: ${entry.name}`)
    }
    catalog.push({
      name: entry.name,
      description: readSkillDescription(skillEntry.content, entry.name),
      entry_uri: skillEntry.uri,
    })
    resources.push(...skillResources)
  }
  if (catalog.length > 64 || resources.length > 256) {
    throw new Error('Agent Skills Bundle 超过 64 Skills 或 256 resources 上限')
  }
  resources.sort((left, right) => compareASCII(left.uri, right.uri))
  const totalBytes = resources.reduce((total, resource) => total + resource.size, 0)
  if (totalBytes > 4 * 1024 * 1024) {
    throw new Error('Agent Skills Bundle 超过 4 MiB 上限')
  }
  return {
    catalog,
    resources,
    fingerprint: calculateFingerprint(catalog, resources),
  }
}

async function collectSkillFiles(skillRoot) {
  const entries = await readdir(skillRoot, { withFileTypes: true })
  const names = new Set(entries.map((entry) => entry.name))
  if (!names.has('SKILL.md')
    || [...names].some((name) => name !== 'SKILL.md' && name !== 'references' && name !== 'agents')) {
    throw new Error(`Skill 目录包含未授权资源: ${path.basename(skillRoot)}`)
  }
  const files = ['SKILL.md']
  if (names.has('references')) {
    const referencesDirectory = path.join(skillRoot, 'references')
    await assertCanonicalDirectory(referencesDirectory, 'Skill references 目录')
    files.push(...await collectMarkdownFiles(referencesDirectory, 'references'))
  }
  if (names.has('agents')) {
    const agentsDirectory = path.join(skillRoot, 'agents')
    await assertCanonicalDirectory(agentsDirectory, 'Skill agents 目录')
    const agentEntries = await readdir(agentsDirectory, { withFileTypes: true })
    if (agentEntries.length !== 1 || agentEntries[0]?.name !== 'openai.yaml' || !agentEntries[0].isFile()) {
      throw new Error(`Skill agent metadata 不合法: ${path.basename(skillRoot)}`)
    }
    files.push('agents/openai.yaml')
  }
  return files.sort(compareASCII)
}

async function collectMarkdownFiles(directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => compareASCII(left.name, right.name))) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Skills 资源禁止符号链接: ${prefix}/${entry.name}`)
    }
    const relativePath = `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...await collectMarkdownFiles(path.join(directory, entry.name), relativePath))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(relativePath)
    } else {
      throw new Error(`Skill references 仅允许 Markdown: ${relativePath}`)
    }
  }
  return files
}

async function readOrdinaryUTF8File(filePath, root) {
  let handle = null
  try {
    handle = await open(filePath, 'r')
    const handleInfo = await handle.stat({ bigint: true })
    const pathInfo = await lstat(filePath, { bigint: true })
    const resolved = await realpath(filePath)
    if (!handleInfo.isFile()
      || !pathInfo.isFile()
      || pathInfo.isSymbolicLink()
      || handleInfo.size > BigInt(512 * 1024)
      || !sameFileIdentity(handleInfo, pathInfo)
      || !isChildPath(resolved, root)) {
      throw new Error(`Skill 资源必须是目录内的普通文件: ${path.relative(root, filePath)}`)
    }
    const content = await handle.readFile({ encoding: 'utf8' })
    const finalInfo = await lstat(filePath, { bigint: true })
    const finalResolved = await realpath(filePath)
    if (!finalInfo.isFile()
      || finalInfo.isSymbolicLink()
      || !sameFileIdentity(handleInfo, finalInfo)
      || !samePath(resolved, finalResolved)
      || !isChildPath(finalResolved, root)) {
      throw new Error(`Skill 资源在读取期间发生变化: ${path.relative(root, filePath)}`)
    }
    return content
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function assertOrdinaryFile(filePath, root, label) {
  const info = await lstat(filePath)
  const resolved = await realpath(filePath)
  if (!info.isFile() || info.isSymbolicLink() || !isChildPath(resolved, root)) {
    throw new Error(`${label}必须是目录内的普通文件`)
  }
}

async function assertCanonicalDirectory(directory, label) {
  const info = await lstat(directory)
  const resolved = await realpath(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(resolved, directory)) {
    throw new Error(`${label}必须是规范普通目录: ${directory}`)
  }
}

async function replaceDirectory(stagingDirectory, outputDirectory, backupDirectory) {
  let movedPrevious = false
  try {
    try {
      await rename(outputDirectory, backupDirectory)
      movedPrevious = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(stagingDirectory, outputDirectory)
    if (movedPrevious) await rm(backupDirectory, { recursive: true, force: true })
  } catch (error) {
    if (movedPrevious) {
      await rm(outputDirectory, { recursive: true, force: true })
      await rename(backupDirectory, outputDirectory)
    }
    throw error
  }
}

function readSkillDescription(content, expectedName) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content)
  const metadata = match ? parseYaml(match[1]) : null
  if (!metadata || metadata.name !== expectedName || typeof metadata.description !== 'string' || !metadata.description.trim()) {
    throw new Error(`Skill frontmatter 不合法: ${expectedName}`)
  }
  return metadata.description.trim()
}

function calculateFingerprint(catalog, resources) {
  return sha256(JSON.stringify({
    format_version: formatVersion,
    catalog: catalog.map(({ name, description, entry_uri }) => ({ name, description, entry_uri })),
    resources: resources.map(({ uri, sha256: hash, size, media_type }) => ({ uri, sha256: hash, size, media_type })),
  }))
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

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function compareASCII(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) {
  prepareAgentSkillsBundle().then((bundle) => {
    console.log(`已生成 Agent Skills Bundle: ${bundle.catalog.length} Skills / ${bundle.resources.length} resources`)
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
