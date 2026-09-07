import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { RuntimeContextImages } from './runtimeContextImages.ts'
import type { RuntimeBootstrap } from './workerCoreClient.ts'

const data = Buffer.from('image bytes').toString('base64')
const sha256 = createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex')
const image = { type: 'image' as const, data, mimeType: 'image/png' }

test('快照使用用户附件引用并完整保留其他原生内容，不改写原始消息', () => {
  const registry = new RuntimeContextImages({
    context: { estimated_tokens: 0, warning: false },
    messages: [userMessage()],
  })
  const raw: AgentMessage[] = [{ role: 'user', timestamp: 1, content: [
    { type: 'text', text: '检查图片' }, image,
  ] }]
  const before = structuredClone(raw)
  assert.deepEqual(registry.serialize(raw), [{ role: 'user', timestamp: 1, content: [
    { type: 'text', text: '检查图片' },
    { type: 'image_ref', attachment_id: 'aga_image', mime_type: 'image/png', sha256 },
  ] }])
  assert.deepEqual(raw, before)
})

test('工具图片记录原始结果 part 和内容索引，重启后可沿用来源', () => {
  const result: ToolResultMessage = {
    role: 'toolResult', timestamp: 2, toolCallId: 'call_one', toolName: 'inspect',
    content: [{ type: 'text', text: '结果' }, image], isError: false,
  }
  const registry = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
  registry.registerToolResult('agp_original', result)
  registry.registerToolResult('agp_later', result)
  const reference = {
    type: 'image_ref' as const, message_part_id: 'agp_original', content_index: 1,
    mime_type: 'image/png', sha256,
  }
  const expected = [{ ...result, content: [{ type: 'text', text: '结果' }, reference] }]
  assert.deepEqual(registry.serialize([result]), expected)
  const restored = new RuntimeContextImages({ context: {
    estimated_tokens: 0, warning: false,
    checkpoint: { summary: '历史', estimated_tokens: 0, boundary_message_sequence: 1,
      retained_tail: [result], image_sources: [reference] },
  }, messages: [] })
  assert.deepEqual(restored.serialize([result]), expected)
})

test('无法引用或非规范图片明确失败，不静默删掉 retainedTail', () => {
  const registry = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
  assert.throws(() => registry.serialize([{ role: 'user', timestamp: 1, content: [image] }]),
    /AGENT_CONTEXT_IMAGE_SOURCE_MISSING/u)
  for (const invalid of ['', 'not-base64', data + '\n']) {
    assert.throws(() => registry.serialize([{ role: 'user', timestamp: 1,
      content: [{ ...image, data: invalid }] }]), /AGENT_CONTEXT_IMAGE_INVALID/u)
  }
})

function userMessage(): RuntimeBootstrap['messages'][number] {
  return {
    id: 'agm_user', role: 'user', sequence: 1, status: 'completed',
    created_at: '2026-09-05T00:00:00Z', parts: [],
    attachments: [{ id: 'aga_image', kind: 'image', mime_type: 'image/png', content_base64: data }],
  }
}
