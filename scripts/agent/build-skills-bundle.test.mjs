import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareAgentSkillsBundle } from './build-skills-bundle.mjs'
import { parseAgentSkillsManifest, validateAgentSkillsBundleDirectory } from './validate-skills-bundle.mjs'
import { AgentSkillBundleSource } from '../../electron/agent/skillBundleSource.ts'
import { calculateAgentSkillBundleFingerprint, createAgentSkillBundleSnapshot } from '../../electron/agent/skillBundle.ts'
import { parseAgentSkillProductionManifest } from '../../electron/agent/skillBundleManifest.ts'
import { SkillInstaller } from '../../electron/skills/installer.ts'

test('生产构建复制允许资源并生成稳定 manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-agent-skills-build-'))
  const sourceDirectory = path.join(root, 'termous-skills', 'skills')
  const backendDirectory = path.join(root, 'backend')
  const outputDirectory = path.join(root, 'web', 'build', 'agent', 'skills')
  try {
    await writeSkill(sourceDirectory)
    await mkdir(backendDirectory, { recursive: true })
    const first = await prepareAgentSkillsBundle({
      sourceDirectory,
      backendDirectory,
      outputDirectory,
      validate: false,
    })
    const firstManifest = await readFile(path.join(outputDirectory, 'manifest.json'), 'utf8')
    const second = await prepareAgentSkillsBundle({
      sourceDirectory,
      backendDirectory,
      outputDirectory,
      validate: false,
    })
    const secondManifest = await readFile(path.join(outputDirectory, 'manifest.json'), 'utf8')

    assert.equal(first.fingerprint, second.fingerprint)
    assert.equal(firstManifest, secondManifest)
    assert.equal((await validateAgentSkillsBundleDirectory(outputDirectory)).resources.length, 3)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产资源验证拒绝篡改和未登记文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-agent-skills-verify-'))
  const sourceDirectory = path.join(root, 'termous-skills', 'skills')
  const backendDirectory = path.join(root, 'backend')
  const outputDirectory = path.join(root, 'output')
  try {
    await writeSkill(sourceDirectory)
    await mkdir(backendDirectory, { recursive: true })
    await prepareAgentSkillsBundle({ sourceDirectory, backendDirectory, outputDirectory, validate: false })
    await writeFile(path.join(outputDirectory, 'termous-test', 'SKILL.md'), 'tampered', 'utf8')
    await assert.rejects(
      validateAgentSkillsBundleDirectory(outputDirectory),
      /AGENT_SKILLS_RESOURCE_INTEGRITY_FAILED/,
    )

    await prepareAgentSkillsBundle({ sourceDirectory, backendDirectory, outputDirectory, validate: false })
    await writeFile(path.join(outputDirectory, 'extra.md'), 'extra', 'utf8')
    await assert.rejects(
      validateAgentSkillsBundleDirectory(outputDirectory),
      /AGENT_SKILLS_MANIFEST_FILE_SET_MISMATCH/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Python 资源经开发读取、生产构建与安装保持完整且不执行', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-skills-python-'))
  const sourceDirectory = path.join(root, 'skills')
  const backendDirectory = path.join(root, 'backend')
  const outputDirectory = path.join(root, 'bundle')
  const targetDirectory = path.join(root, 'installed')
  const script = 'raise RuntimeError("resource must not execute during packaging or installation")\n'
  try {
    await writeSkill(sourceDirectory)
    await mkdir(backendDirectory)
    await mkdir(targetDirectory)
    await mkdir(path.join(sourceDirectory, 'termous-test', 'scripts'))
    await writeFile(path.join(sourceDirectory, 'termous-test', 'scripts', 'entry.py'), script)
    const development = await new AgentSkillBundleSource({ mode: 'development', rootDirectory: sourceDirectory }).snapshot()
    await prepareAgentSkillsBundle({ sourceDirectory, backendDirectory, outputDirectory, validate: false })
    const source = new AgentSkillBundleSource({ mode: 'production', rootDirectory: outputDirectory })
    const production = await source.snapshot()
    assert.equal(production.fingerprint, development.fingerprint)
    const resource = production.resources.find((item) => item.uri.endsWith('/scripts/entry.py'))
    assert.equal(resource?.media_type, 'text/x-python; charset=utf-8')
    assert.equal(resource?.content, script)
    for (const [relativePath, mediaType] of [
      ['references/entry.py', 'text/x-python; charset=utf-8'],
      ['scripts/entry.ps1', 'text/x-python; charset=utf-8'],
      ['scripts/entry.py', 'text/markdown; charset=utf-8'],
    ]) {
      const invalidResources = production.resources.map((item) => item === resource
        ? { ...item, uri: `skill://termous-test/${relativePath}`, media_type: mediaType }
        : item)
      const manifest = JSON.stringify({
        format_version: production.format_version,
        fingerprint: calculateAgentSkillBundleFingerprint(production.catalog, invalidResources),
        catalog: production.catalog,
        resources: invalidResources.map(({ uri, sha256, size, media_type }) => ({
          uri, sha256, size, media_type, path: uri.slice('skill://'.length),
        })),
      })
      assert.throws(() => createAgentSkillBundleSnapshot(production.catalog, invalidResources), /AGENT_SKILLS_RESOURCE_INVALID/)
      assert.throws(() => parseAgentSkillsManifest(manifest), /AGENT_SKILLS_RESOURCE_INVALID/)
      assert.throws(() => parseAgentSkillProductionManifest(manifest), (error) => error.category === 'manifest_resource_invalid')
    }
    const installer = new SkillInstaller(source, outputDirectory)
    const plan = await installer.prepare(targetDirectory, 'custom', 1)
    const result = await installer.install(plan.id, 'skip', 1)
    assert.equal(result.items[0]?.status, 'installed')
    assert.equal(await readFile(path.join(targetDirectory, 'termous-test', 'scripts', 'entry.py'), 'utf8'), script)
    await writeFile(path.join(outputDirectory, 'termous-test', 'scripts', 'entry.py'), 'tampered')
    assert.equal((await source.inspect()).error_category, 'resource_integrity_failed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scripts 只接受 Python 源码，拒绝其他格式和目录链接', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-skills-python-boundaries-'))
  const sourceDirectory = path.join(root, 'skills')
  const backendDirectory = path.join(root, 'backend')
  const outputDirectory = path.join(root, 'bundle')
  try {
    await writeSkill(sourceDirectory)
    await mkdir(backendDirectory)
    const scripts = path.join(sourceDirectory, 'termous-test', 'scripts')
    await mkdir(scripts)
    await writeFile(path.join(scripts, 'entry.ps1'), 'exit 0')
    await assert.rejects(prepareAgentSkillsBundle({ sourceDirectory, backendDirectory, outputDirectory, validate: false }), /仅允许 \.py/)
    const source = new AgentSkillBundleSource({ mode: 'development', rootDirectory: sourceDirectory })
    assert.equal((await source.inspect()).error_category, 'resource_file_type_invalid')
    await rm(scripts, { recursive: true })
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'entry.py'), 'pass')
    if (!await createDirectoryLink(context, outside, scripts)) return
    await assert.rejects(prepareAgentSkillsBundle({ sourceDirectory, backendDirectory, outputDirectory, validate: false }), /Skill scripts 目录必须是规范普通目录/)
    assert.equal((await source.inspect()).error_category, 'resource_directory_invalid')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产构建拒绝 references 目录符号链接', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-agent-skills-references-link-'))
  const sourceDirectory = path.join(root, 'termous-skills', 'skills')
  const backendDirectory = path.join(root, 'backend')
  const outputDirectory = path.join(root, 'output')
  try {
    await writeSkill(sourceDirectory)
    await mkdir(backendDirectory, { recursive: true })
    const target = path.join(root, 'linked-references')
    await rm(path.join(sourceDirectory, 'termous-test', 'references'), { recursive: true })
    await mkdir(target)
    await writeFile(path.join(target, 'guide.md'), '# Guide', 'utf8')
    if (!await createDirectoryLink(context, target, path.join(sourceDirectory, 'termous-test', 'references'))) return

    await assert.rejects(
      prepareAgentSkillsBundle({ sourceDirectory, backendDirectory, outputDirectory, validate: false }),
      /Skill references 目录必须是规范普通目录/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产构建拒绝 agents 目录符号链接', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-agent-skills-agents-link-'))
  const sourceDirectory = path.join(root, 'termous-skills', 'skills')
  const backendDirectory = path.join(root, 'backend')
  const outputDirectory = path.join(root, 'output')
  try {
    await writeSkill(sourceDirectory)
    await mkdir(backendDirectory, { recursive: true })
    const target = path.join(root, 'linked-agents')
    await rm(path.join(sourceDirectory, 'termous-test', 'agents'), { recursive: true })
    await mkdir(target)
    await writeFile(path.join(target, 'openai.yaml'), 'interface:\n  display_name: Test\n', 'utf8')
    if (!await createDirectoryLink(context, target, path.join(sourceDirectory, 'termous-test', 'agents'))) return

    await assert.rejects(
      prepareAgentSkillsBundle({ sourceDirectory, backendDirectory, outputDirectory, validate: false }),
      /Skill agents 目录必须是规范普通目录/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeSkill(sourceDirectory) {
  const skillRoot = path.join(sourceDirectory, 'termous-test')
  await mkdir(path.join(skillRoot, 'references'), { recursive: true })
  await mkdir(path.join(skillRoot, 'agents'), { recursive: true })
  await writeFile(path.join(skillRoot, 'SKILL.md'), [
    '---',
    'name: termous-test',
    'description: Test Agent skill',
    '---',
    '',
    '# Test',
  ].join('\n'), 'utf8')
  await writeFile(path.join(skillRoot, 'references', 'guide.md'), '# Guide', 'utf8')
  await writeFile(path.join(skillRoot, 'agents', 'openai.yaml'), [
    'interface:',
    '  display_name: Test',
  ].join('\n'), 'utf8')
}

async function createDirectoryLink(context, target, linkPath) {
  try {
    await symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      context.skip('当前系统不允许创建测试用目录链接')
      return false
    }
    throw error
  }
}
