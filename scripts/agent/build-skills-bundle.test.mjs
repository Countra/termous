import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareAgentSkillsBundle } from './build-skills-bundle.mjs'
import { validateAgentSkillsBundleDirectory } from './validate-skills-bundle.mjs'

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
