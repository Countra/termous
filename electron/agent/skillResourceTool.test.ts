import assert from 'node:assert/strict'
import test from 'node:test'
import { createSkillResourceTool, skillCatalogPrompt } from './skillResourceTool.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'
import { createAgentSkillBundleSnapshot } from './skillBundle.ts'

test('内部 Skill Tool 只接受当前 Run 快照内的精确 URI', async () => {
  const snapshot = testAgentSkillBundle()
  const tool = createSkillResourceTool(snapshot)
  const expected = snapshot.resources[0]
  const result = await tool.execute('call-1', { uri: expected?.uri }, undefined)

  assert.equal(result.content[0]?.type, 'text')
  assert.equal(result.content[0]?.type === 'text' ? result.content[0].text : '', expected?.content)
  assert.deepEqual(result.details, {
    kind: 'skill_resource',
    uri: expected?.uri,
    sha256: expected?.sha256,
    size: expected?.size,
  })
  await assert.rejects(
    tool.execute('call-2', { uri: `${expected?.uri}/../SKILL.md` }, undefined),
    /AGENT_SKILL_RESOURCE_NOT_FOUND/,
  )
})

test('System Prompt 仅包含 Catalog，不泄露正文或本地路径', () => {
  const snapshot = testAgentSkillBundle()
  const prompt = skillCatalogPrompt(snapshot)

  assert.match(prompt, /termous-test/)
  assert.match(prompt, /skill:\/\/termous-test\/SKILL\.md/)
  assert.equal(prompt.includes(snapshot.resources[0]?.content ?? ''), false)
  assert.equal(prompt.includes(process.cwd()), false)
})

test('旧文件 Skill URI 仅回退到当前快照对应资源，并返回真实新 URI 与指纹', async () => {
  const base = testAgentSkillBundle()
  const resource = { ...base.resources[0]!, uri: 'skill://termous-files/SKILL.md' }
  const entry = { ...base.catalog[0]!, name: 'termous-files', entry_uri: resource.uri }
  const tool = createSkillResourceTool(createAgentSkillBundleSnapshot([entry], [resource]))
  const result = await tool.execute('call-legacy', { uri: 'skill://termous-sftp/SKILL.md' }, undefined)
  assert.deepEqual(result.details, { kind: 'skill_resource', uri: resource.uri, sha256: resource.sha256, size: resource.size })
  assert.deepEqual(result.content, [{ type: 'text', text: resource.content }])
  for (const uri of ['skill://termous-sftp-extra/SKILL.md', 'skill://termous-sftp/../termous-files/SKILL.md',
    'skill://termous-sftp/references/missing.md', 'skill://termous-sftp/SKILL.md/../SKILL.md']) {
    await assert.rejects(tool.execute('call-invalid', { uri }, undefined), /AGENT_SKILL_RESOURCE_NOT_FOUND/)
  }
  const legacyResource = { ...resource, uri: 'skill://termous-sftp/SKILL.md' }
  const legacyEntry = { ...entry, name: 'termous-sftp', entry_uri: legacyResource.uri }
  const mixed = createSkillResourceTool(createAgentSkillBundleSnapshot([entry, legacyEntry], [resource, legacyResource]))
  const exact = await mixed.execute('call-exact', { uri: legacyResource.uri }, undefined)
  assert.equal((exact.details as { uri: string }).uri, legacyResource.uri)
})
