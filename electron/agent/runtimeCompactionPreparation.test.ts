import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { prepareRuntimeCompaction } from './runtimeCompactionPreparation.ts'
import { serializeRuntimeConversation } from './runtimeCompactionGeneration.ts'
import { compactionTestAssistant, compactionTestUser } from './runtimeCompactionTestFixture.ts'

test('多工具结果与中间消息交错时不切断调用组，摘要与尾部合并仍等于原始消息', () => {
  const raw: AgentMessage[] = [
    compactionTestUser('原始目标'.repeat(4000)),
    { ...compactionTestAssistant(''), content: [
      { type: 'toolCall', id: 'a', name: 'first', arguments: {} },
      { type: 'toolCall', id: 'b', name: 'second', arguments: {} },
    ] },
    { role: 'toolResult', toolCallId: 'a', toolName: 'first', content: [{ type: 'text', text: '结果'.repeat(3000) }], isError: false, timestamp: 3 },
    compactionTestAssistant('中间进展'),
    { role: 'toolResult', toolCallId: 'b', toolName: 'second', content: [{ type: 'text', text: '第二个结果' }], isError: false, timestamp: 4 },
    compactionTestUser('接着处理'),
  ]
  for (const keepRecentTokens of [1, 16, 1000, 4000, 10000]) {
    const prepared = prepareRuntimeCompaction(raw, undefined, { reserveTokens: 512, keepRecentTokens })!
    assert.deepEqual([...prepared.messagesToSummarize, ...prepared.turnPrefixMessages, ...prepared.retainedTail], raw)
    const calls = new Set(prepared.retainedTail.flatMap((message) => message.role === 'assistant'
      ? message.content.filter((part) => part.type === 'toolCall').map((part) => part.id) : []))
    for (const message of prepared.retainedTail) {
      if (message.role === 'toolResult') assert.ok(calls.has(message.toolCallId))
    }
    assert.equal(prepared.retainedTail[prepared.retainedTail.length - 1], raw[raw.length - 1])
  }
})

test('未返回的工具调用不会因后来的消息被裁剪，等待结果仍能关联原调用', () => {
  const call: AgentMessage = { ...compactionTestAssistant(''), content: [
    { type: 'toolCall', id: 'pending', name: 'remote_operation', arguments: {} },
  ] }
  const raw = [compactionTestUser('之前的任务'.repeat(2000)), call, compactionTestUser('取消后观察结果')]
  const prepared = prepareRuntimeCompaction(raw, undefined, { reserveTokens: 512, keepRecentTokens: 1 })!
  assert.ok(prepared.retainedTail.includes(call))
})

test('末尾工具组超过近期预算时保留整个组，仍可压缩组之前的历史', () => {
  const call: AgentMessage = { ...compactionTestAssistant(''), content: [
    { type: 'toolCall', id: 'large-result', name: 'read', arguments: {} },
  ] }
  const result: AgentMessage = {
    role: 'toolResult', toolCallId: 'large-result', toolName: 'read',
    content: [{ type: 'text', text: 'r'.repeat(14000) }], isError: false, timestamp: 3,
  }
  const raw = [compactionTestUser('已确认的历史'.repeat(3000)), call, result]
  const prepared = prepareRuntimeCompaction(raw, undefined, { reserveTokens: 1600, keepRecentTokens: 3200 })!
  assert.deepEqual(prepared.retainedTail, [call, result])
  assert.deepEqual([...prepared.messagesToSummarize, ...prepared.turnPrefixMessages], raw.slice(0, 1))
})

test('工具组内插入的用户消息不能成为两次摘要请求的分界', () => {
  const raw: AgentMessage[] = [
    compactionTestUser('最初目标'),
    { ...compactionTestAssistant(''), content: [
      { type: 'toolCall', id: 'interleaved', name: 'inspect', arguments: {} },
    ] },
    compactionTestUser('工具执行时补充要求'),
    { role: 'toolResult', toolCallId: 'interleaved', toolName: 'inspect',
      content: [{ type: 'text', text: '原调用的结果' }], isError: false, timestamp: 3 },
    compactionTestAssistant('最近的完整回复'),
  ]
  const prepared = prepareRuntimeCompaction(raw, undefined, { reserveTokens: 512, keepRecentTokens: 1 })!
  assert.deepEqual(prepared.messagesToSummarize, [])
  assert.deepEqual(prepared.turnPrefixMessages, raw.slice(0, 4))
  assert.deepEqual(prepared.retainedTail, raw.slice(4))
})

test('恢复时合并旧尾部与新消息，拒绝越界 checkpoint 且无新增历史不重复压缩', () => {
  const retained = compactionTestUser('仍待处理')
  const checkpoint = { summary: '旧约束', retainedTail: [retained], coveredRawLength: 0, timestamp: 1, tokensBefore: 200 }
  const settings = { reserveTokens: 512, keepRecentTokens: 1000 }
  assert.equal(prepareRuntimeCompaction([], checkpoint, settings), undefined)
  const added = compactionTestUser('补充目标')
  const result = prepareRuntimeCompaction([added], checkpoint, settings)!
  assert.deepEqual(result.retainedTail, [retained, added])
  assert.equal(result.previousSummary, '旧约束')
  for (const coveredRawLength of [-1, 0.5, 2, NaN]) {
    assert.throws(() => prepareRuntimeCompaction([added], { ...checkpoint, coveredRawLength }, settings), /BOUNDARY_INVALID/u)
  }
})

test('摘要排除思考和图片正文，保留可见内容、工具身份和错误状态且不改原文', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: [{ type: 'text', text: '查看画面' }, { type: 'image', data: 'private-image-body', mimeType: 'image/png' }], timestamp: 1 },
    { ...compactionTestAssistant(''), content: [
      { type: 'thinking', thinking: 'private-thinking-body' },
      { type: 'text', text: '检查桌面' },
      { type: 'toolCall', id: 'call-1', name: 'capture', arguments: { attachment_id: 'desktop-1' } },
    ] },
    { role: 'toolResult', toolCallId: 'call-1', toolName: 'capture', content: [{ type: 'text', text: '连接已经关闭' }], isError: true, timestamp: 3 },
  ]
  const original = structuredClone(messages)
  const text = serializeRuntimeConversation(messages)
  assert.doesNotMatch(text, /private-image-body|private-thinking-body/u)
  for (const expected of ['查看画面', '检查桌面', 'capture', 'call-1', 'desktop-1', 'error', '连接已经关闭']) {
    assert.ok(text.includes(expected))
  }
  assert.deepEqual(messages, original)
})

test('长工具结果截断后仍保留图片引用，摘要不复制图片正文', () => {
  const text = serializeRuntimeConversation([{
    role: 'toolResult', toolCallId: 'capture-1', toolName: 'capture', isError: false, timestamp: 1,
    content: [
      { type: 'text', text: 'x'.repeat(3000) },
      { type: 'image', data: 'private-image-body', mimeType: 'image/png' },
    ],
  }])
  assert.match(text, /termous-image:\/\/tool\/capture-1\/1/)
  assert.match(text, /truncated/)
  assert.doesNotMatch(text, /private-image-body/)
})
