import assert from 'node:assert/strict'
import test from 'node:test'
import { createSkillResourceTool, skillCatalogPrompt } from './skillResourceTool.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'

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
