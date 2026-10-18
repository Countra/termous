import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeAgentMessagePart } from './agentRuntimeProtocol.ts'
import { agentFixtureTime } from './agentRuntimeTestFixtures.ts'

const image = { content_index: 1, mime_type: 'image/png', size_bytes: 30331 }
const part = (images: unknown) => ({
  id: 'part', message_id: 'message', kind: 'tool_result', sequence: 2, revision: 3,
  created_at: agentFixtureTime, updated_at: agentFixtureTime,
  content: { tool_result: { tool_call_id: 'capture', tool_name: 'termous.desktops.capture',
    content: '[内容已截断]', is_error: false, images } },
})

test('工具摘要被截断时，独立图片元数据仍完整且不携带正文', () => {
  const decoded = decodeAgentMessagePart(part([image]))
  assert.equal(decoded.kind, 'tool_result')
  if (decoded.kind !== 'tool_result') throw new Error('missing result')
  assert.deepEqual(decoded.tool_result.images, [image])
  assert.equal(decoded.tool_result.content, '[内容已截断]')
  assert.equal(decoded.revision, 3)
  assert.equal('data' in decoded.tool_result.images![0]!, false)
})

test('工具图片拒绝重复或非法索引、未知格式和超限大小', () => {
  for (const invalid of [null, {}, [image, image], [{ ...image, content_index: -1 }],
    [{ ...image, content_index: 0.5 }], [{ ...image, mime_type: 'image/svg+xml' }],
    [{ ...image, size_bytes: 0 }], [{ ...image, size_bytes: 10 * 1024 * 1024 + 1 }]]) {
    assert.throws(() => decodeAgentMessagePart(part(invalid)))
  }
  assert.doesNotThrow(() => decodeAgentMessagePart(part(undefined)))
})
