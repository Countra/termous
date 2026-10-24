import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeContext, getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai/utils/transcript'
import type { ImageContent, Message, ToolResultMessage } from '@earendil-works/pi-ai'
import { runtimeToolImageContext } from './runtimeToolImageContext.ts'

const image: ImageContent = { type: 'image', mimeType: 'image/png', data: 'fixture-pixels' }
const result = (id: string, content: ToolResultMessage['content']): ToolResultMessage => ({
  role: 'toolResult', toolCallId: id, toolName: 'capture', content, isError: false, timestamp: 10,
})

test('纯文字及用户上传图片不改变原上下文对象', () => {
  for (const messages of [[], [result('text', [{ type: 'text', text: '完成' }])],
    [{ role: 'user', content: [image], timestamp: 1 }]] satisfies Message[][]) {
    const context = normalizeContext({ messages })
    assert.equal(runtimeToolImageContext(context), context)
  }
})

test('多工具结果后集中附图，保留系统声明、来源、图片对象及原始文字', () => {
  const second: ImageContent = { ...image, mimeType: 'image/jpeg', data: 'second-pixels' }
  const first = result('call-a', [{ type: 'text', text: '原始截图元数据' }, image, second])
  const last = result('call-b', [second])
  const context = normalizeContext({ systemPrompt: '原始规则', tools: [{ name: 'capture', description: '截图', parameters: {} }],
    messages: [first, { role: 'system', content: '声明更新', toolsAdded: [{ name: 'state', description: '状态', parameters: {} }], timestamp: 2 }, last] })
  const original = structuredClone(context)
  const projected = runtimeToolImageContext(context)
  assert.equal(getCurrentSystemPrompt(projected.messages), getCurrentSystemPrompt(context.messages))
  assert.deepEqual(getCurrentTools(projected.messages), getCurrentTools(context.messages))
  assert.deepEqual(projected.messages.map(message => message.role), ['system', 'toolResult', 'system', 'toolResult', 'user'])
  assert.deepEqual(projected.messages[1]!.content, [{ type: 'text', text: '原始截图元数据' }])
  assert.deepEqual(projected.messages[3]!.content, [{ type: 'text', text: '(see attached tool images)' }])
  const attachments = projected.messages[4]!.content
  assert.ok(Array.isArray(attachments))
  assert.equal(attachments[1], image)
  assert.equal(attachments[2], second)
  assert.equal(attachments[4], second)
  assert.match(JSON.stringify(attachments[0]), /call-a/u)
  assert.match(JSON.stringify(attachments[3]), /call-b/u)
  assert.deepEqual(context, original)
  assert.equal(runtimeToolImageContext(projected), projected)
})

test('分轮图片不能漂移到下一轮，纯图片失败结果保留失败标记和占位', () => {
  const first = { ...result('failed-capture', [image]), isError: true }
  const context = normalizeContext({ messages: [first,
    { role: 'user', content: '后续要求', timestamp: 11 }, result('next-capture', [image])] })
  const projected = runtimeToolImageContext(context)
  assert.deepEqual(projected.messages.map(message => message.role), ['toolResult', 'user', 'user', 'toolResult', 'user'])
  assert.equal(projected.messages[0]!.role === 'toolResult' && projected.messages[0].isError, true)
  assert.equal(projected.messages[2], context.messages[1])
  assert.match(JSON.stringify(projected.messages[1]), /failed-capture/u)
  assert.doesNotMatch(JSON.stringify(projected.messages[1]), /next-capture/u)
  assert.match(JSON.stringify(projected.messages[4]), /next-capture/u)
})
