import assert from 'node:assert/strict'
import test from 'node:test'
import { agentToolImageReference, isAgentToolImageReference } from './agent-images.ts'

test('图片引用可安全写入 Markdown，包含协议特殊字符的调用标识不改变结构', () => {
  const reference = agentToolImageReference("call('中文')/x|y", 2)!
  assert.equal(isAgentToolImageReference(reference), true)
  assert.doesNotMatch(reference, /[()'|]/u)
  assert.equal(reference.split('/').length, 5)
  assert.equal(agentToolImageReference('', 0), undefined)
  assert.equal(agentToolImageReference('a', -1), undefined)
  assert.equal(agentToolImageReference('a', Number.MAX_SAFE_INTEGER + 1), undefined)
  assert.equal(agentToolImageReference('a'.repeat(513), 0), undefined)
  assert.equal(agentToolImageReference('\uD800', 0), undefined)
})

test('拒绝外部地址、路径、非规范或损坏的图片引用', () => {
  for (const value of ['https://example.test/image.png', 'file:///image.png', 'data:image/png;base64,eA==',
    'termous-image://tool/a/01', 'termous-image://tool/a/-1', 'termous-image://tool/a/0?x=1',
    'termous-image://tool/../0', 'termous-image://tool/%xx/0', 'termous-image://tool/a/1/0']) {
    assert.equal(isAgentToolImageReference(value), false, value)
  }
})
