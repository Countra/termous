import { createHash } from 'node:crypto'
import { createAgentSkillBundleSnapshot } from './skillBundle.ts'

const content = [
  '---',
  'name: termous-test',
  'description: Test skill',
  '---',
  '',
  '# Test',
].join('\n')

export function testAgentSkillBundle() {
  return createAgentSkillBundleSnapshot(
    [{
      name: 'termous-test',
      description: 'Test skill',
      entry_uri: 'skill://termous-test/SKILL.md',
    }],
    [{
      uri: 'skill://termous-test/SKILL.md',
      sha256: createHash('sha256').update(content).digest('hex'),
      size: Buffer.byteLength(content, 'utf8'),
      media_type: 'text/markdown; charset=utf-8',
      content,
    }],
  )
}
