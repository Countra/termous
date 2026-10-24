import assert from 'node:assert/strict'
import test from 'node:test'
import { agentMessageFixture, agentTextPartFixture } from '../model/agentRuntimeTestFixtures.ts'
import { loadAgentMessageText } from './loadAgentMessageText.ts'

test('完整复制逐页读取正文，相同错误文本的不同尝试均保留', async () => {
  const message = agentMessageFixture()
  let requests = 0
  const result = await loadAgentMessageText({ messages: async () => {
    const page = ++requests
    return { items: [{ ...message, parts: [agentTextPartFixture({ text: `page ${page}`, sequence: page,
      response_failure: { attempt_id: `attempt${page}`, error_message: 'same error' } })] }], has_newer: page < 3, after_cursor: `cursor${page}` }
  } }, message)
  assert.equal(requests, 3)
  assert.equal(result, 'page 1\n\nsame error\n\npage 2\n\nsame error\n\npage 3\n\nsame error')
})

test('取消或重复游标结束复制，不继续积累正文', async () => {
  const controller = new AbortController()
  let requests = 0
  await assert.rejects(loadAgentMessageText({ messages: async () => {
    requests++; controller.abort()
    return { items: [agentMessageFixture()], has_newer: true, after_cursor: 'next' }
  } }, agentMessageFixture(), controller.signal), /abort/iu)
  assert.equal(requests, 1)
  await assert.rejects(loadAgentMessageText({ messages: async () => ({ items: [agentMessageFixture()], has_newer: true, after_cursor: 'same' }) }, agentMessageFixture()), /CURSOR_INVALID/u)
})
