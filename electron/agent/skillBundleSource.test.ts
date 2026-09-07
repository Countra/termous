import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  agentSkillBundleFormatVersion,
  calculateAgentSkillBundleFingerprint,
  skillResourceURI,
  type AgentSkillCatalogEntry,
  type AgentSkillResource,
} from './skillBundle.ts'
import { AgentSkillBundleError } from './skillBundleError.ts'
import { AgentSkillBundleSource } from './skillBundleSource.ts'

const skillName = 'termous-test'
const skillDescription = '用于验证 Agent Skills 资源边界。'

test('开发模式每次 Run 重新读取且旧快照保持不可变', async () => {
  const root = await createTempDirectory()
  try {
    const entryPath = await writeDevelopmentSkill(root, '# Version 1')
    const source = new AgentSkillBundleSource({ mode: 'development', rootDirectory: root })
    const first = await source.snapshot()

    await writeFile(entryPath, skillContent('# Version 2'), 'utf8')
    const second = await source.snapshot()

    assert.notEqual(first.fingerprint, second.fingerprint)
    assert.match(first.resources[0]?.content ?? '', /Version 1/)
    assert.match(second.resources[0]?.content ?? '', /Version 2/)
    assert.equal(Object.isFrozen(first), true)
    assert.equal(Object.isFrozen(first.resources), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('开发模式拒绝 Skill 白名单之外的文件', async () => {
  const root = await createTempDirectory()
  try {
    await writeDevelopmentSkill(root, '# Skill')
    await writeFile(path.join(root, skillName, 'secret.txt'), 'not allowed', 'utf8')
    const status = await new AgentSkillBundleSource({
      mode: 'development',
      rootDirectory: root,
    }).inspect()

    assert.equal(status.status, 'outdated')
    assert.equal(status.error_category, 'skill_layout_invalid')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产模式校验 manifest、hash、size 与未登记文件', async () => {
  const root = await createTempDirectory()
  try {
    await writeProductionBundle(root)
    const source = new AgentSkillBundleSource({ mode: 'production', rootDirectory: root })
    const snapshot = await source.snapshot()
    assert.equal(snapshot.catalog[0]?.name, skillName)

    const resourcePath = path.join(root, skillName, 'SKILL.md')
    await writeFile(resourcePath, skillContent('# Tampered'), 'utf8')
    await assert.rejects(source.snapshot(), hasCategory('resource_integrity_failed'))

    await writeProductionBundle(root)
    await writeFile(path.join(root, 'unlisted.md'), 'unexpected', 'utf8')
    await assert.rejects(source.snapshot(), hasCategory('manifest_file_set_mismatch'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产 manifest 拒绝路径穿越', async () => {
  const root = await createTempDirectory()
  try {
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({
      format_version: agentSkillBundleFormatVersion,
      fingerprint: 'a'.repeat(64),
      catalog: [{ name: skillName, description: skillDescription, entry_uri: skillResourceURI(skillName, 'SKILL.md') }],
      resources: [{
        uri: skillResourceURI(skillName, 'SKILL.md'),
        path: '../outside.md',
        sha256: 'b'.repeat(64),
        size: 1,
        media_type: 'text/markdown; charset=utf-8',
      }],
    }), 'utf8')
    const source = new AgentSkillBundleSource({ mode: 'production', rootDirectory: root })
    await assert.rejects(source.snapshot(), hasCategory('manifest_path_invalid'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产 manifest 在读取资源前拒绝数量超限', async () => {
  const root = await createTempDirectory()
  try {
    const catalog = Array.from({ length: 65 }, (_, index) => ({
      name: `termous-test-${index}`,
      description: skillDescription,
      entry_uri: skillResourceURI(`termous-test-${index}`, 'SKILL.md'),
    }))
    await writeManifest(root, catalog, catalog.map((entry) => ({
      uri: entry.entry_uri,
      path: `${entry.name}/SKILL.md`,
      sha256: 'a'.repeat(64),
      size: 1,
      media_type: 'text/markdown; charset=utf-8' as const,
    })))

    const source = new AgentSkillBundleSource({ mode: 'production', rootDirectory: root })
    await assert.rejects(source.snapshot(), hasCategory('manifest_invalid'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产 manifest 拒绝重复名称、URI 和路径', async () => {
  const root = await createTempDirectory()
  const entryURI = skillResourceURI(skillName, 'SKILL.md')
  const baseCatalog: AgentSkillCatalogEntry[] = [{
    name: skillName,
    description: skillDescription,
    entry_uri: entryURI,
  }]
  const baseResource = {
    uri: entryURI,
    path: `${skillName}/SKILL.md`,
    sha256: 'a'.repeat(64),
    size: 1,
    media_type: 'text/markdown; charset=utf-8' as const,
  }
  try {
    await writeManifest(root, [...baseCatalog, ...baseCatalog], [baseResource, {
      ...baseResource,
      uri: skillResourceURI(skillName, 'references/guide.md'),
      path: `${skillName}/references/guide.md`,
    }])
    await assert.rejects(
      new AgentSkillBundleSource({ mode: 'production', rootDirectory: root }).snapshot(),
      hasCategory('manifest_catalog_duplicate'),
    )

    await writeManifest(root, baseCatalog, [baseResource, {
      ...baseResource,
      path: `${skillName}/references/guide.md`,
    }])
    await assert.rejects(
      new AgentSkillBundleSource({ mode: 'production', rootDirectory: root }).snapshot(),
      hasCategory('manifest_resource_duplicate'),
    )

    await writeManifest(root, baseCatalog, [baseResource, {
      ...baseResource,
      uri: skillResourceURI(skillName, 'references/guide.md'),
    }])
    await assert.rejects(
      new AgentSkillBundleSource({ mode: 'production', rootDirectory: root }).snapshot(),
      hasCategory('manifest_resource_path_duplicate'),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产 manifest 拒绝 fingerprint 合法但 URI 与路径错配', async () => {
  const root = await createTempDirectory()
  try {
    const catalog: AgentSkillCatalogEntry[] = [{
      name: skillName,
      description: skillDescription,
      entry_uri: skillResourceURI(skillName, 'SKILL.md'),
    }]
    await writeManifest(root, catalog, [{
      uri: skillResourceURI(skillName, 'SKILL.md'),
      path: `${skillName}/references/guide.md`,
      sha256: 'a'.repeat(64),
      size: 1,
      media_type: 'text/markdown; charset=utf-8',
    }])

    const source = new AgentSkillBundleSource({ mode: 'production', rootDirectory: root })
    await assert.rejects(source.snapshot(), hasCategory('manifest_resource_mapping_invalid'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('生产模式拒绝指向包外文件的符号链接', async (context) => {
  const root = await createTempDirectory()
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.md`)
  try {
    await writeProductionBundle(root)
    const resourcePath = path.join(root, skillName, 'SKILL.md')
    await rm(resourcePath)
    await writeFile(outside, skillContent('# Outside'), 'utf8')
    try {
      await symlink(outside, resourcePath, 'file')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        context.skip('当前系统不允许创建测试用符号链接')
        return
      }
      throw error
    }
    const source = new AgentSkillBundleSource({ mode: 'production', rootDirectory: root })
    await assert.rejects(source.snapshot(), hasCategory('symbolic_link_rejected'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { force: true })
  }
})

async function createTempDirectory() {
  return mkdtemp(path.join(tmpdir(), 'termous-agent-skills-'))
}

async function writeDevelopmentSkill(root: string, body: string) {
  const skillRoot = path.join(root, skillName)
  await mkdir(path.join(skillRoot, 'agents'), { recursive: true })
  await mkdir(path.join(skillRoot, 'references'), { recursive: true })
  const entryPath = path.join(skillRoot, 'SKILL.md')
  await writeFile(entryPath, skillContent(body), 'utf8')
  await writeFile(path.join(skillRoot, 'references', 'guide.md'), '# Guide', 'utf8')
  await writeFile(path.join(skillRoot, 'agents', 'openai.yaml'), 'interface:\n  display_name: Test\n', 'utf8')
  return entryPath
}

async function writeProductionBundle(root: string) {
  await rm(root, { recursive: true, force: true })
  await mkdir(path.join(root, skillName), { recursive: true })
  const content = skillContent('# Production')
  const relativePath = `${skillName}/SKILL.md`
  await writeFile(path.join(root, ...relativePath.split('/')), content, 'utf8')
  const catalog: AgentSkillCatalogEntry[] = [{
    name: skillName,
    description: skillDescription,
    entry_uri: skillResourceURI(skillName, 'SKILL.md'),
  }]
  const resources: AgentSkillResource[] = [{
    uri: skillResourceURI(skillName, 'SKILL.md'),
    sha256: sha256(content),
    size: Buffer.byteLength(content, 'utf8'),
    media_type: 'text/markdown; charset=utf-8',
    content,
  }]
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({
    format_version: agentSkillBundleFormatVersion,
    fingerprint: calculateAgentSkillBundleFingerprint(catalog, resources),
    catalog,
    resources: resources.map(({ uri, sha256: hash, size, media_type }) => ({
      uri,
      path: relativePath,
      sha256: hash,
      size,
      media_type,
    })),
  }, null, 2)}\n`, 'utf8')
}

async function writeManifest(
  root: string,
  catalog: AgentSkillCatalogEntry[],
  resources: Array<{
    uri: string
    path: string
    sha256: string
    size: number
    media_type: AgentSkillResource['media_type']
  }>,
) {
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({
    format_version: agentSkillBundleFormatVersion,
    fingerprint: calculateAgentSkillBundleFingerprint(catalog, resources.map((resource) => ({
      ...resource,
      content: '',
    }))),
    catalog,
    resources,
  }, null, 2)}\n`, 'utf8')
}

function skillContent(body: string) {
  return `---\nname: ${skillName}\ndescription: ${skillDescription}\n---\n\n${body}\n`
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hasCategory(category: string) {
  return (error: unknown) => error instanceof AgentSkillBundleError && error.category === category
}
