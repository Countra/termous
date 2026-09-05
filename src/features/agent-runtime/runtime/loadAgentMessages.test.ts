import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessage, AgentMessagePage } from '#entities/agent'
import { agentMessageFixture } from '../model/agentRuntimeTestFixtures.ts'
import { loadAgentMessages } from './loadAgentMessages.ts'

const message = (sequence: number) => agentMessageFixture({ id: `message-${sequence}`, sequence })

test('历史读取保留所有分页内容，并复用调用方的错误类型', async () => {
  const pages = [{ items: [message(1)], next_after_sequence: 1 }, { items: [message(2)] }]
  const cursors: number[] = []
  const actual = await loadAgentMessages({ messages: async (_id, options) => {
    cursors.push(options?.afterSequence ?? 0)
    return pages.shift()!
  } }, 'ags-session')
  assert.deepEqual(cursors, [0, 1])
  assert.deepEqual(actual.map(({ sequence }) => sequence), [1, 2])
  class CustomError extends Error {}
  await assert.rejects(loadAgentMessages({ messages: async () => ({ items: [{ ...message(1), session_id: 'other' }] }) },
    'ags-session', 0, undefined, (code) => new CustomError(code)), CustomError)
})

test('历史读取拒绝重复消息、重复序号、跨页重复用量和无效游标', async () => {
  const duplicateUsage: AgentMessage = {
    ...message(1),
    turn_usage: {
      run_id: 'run-one',
      usage: { input_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 1, estimated: false },
    },
  }
  const cases: Array<{ pages: AgentMessagePage[]; code: string }> = [
    { pages: [{ items: [message(1), message(1)] }], code: 'AGENT_MESSAGE_PAGE_INVALID' },
    { pages: [{ items: [message(1), { ...message(2), sequence: 1 }] }], code: 'AGENT_MESSAGE_PAGE_INVALID' },
    { pages: [{ items: [duplicateUsage], next_after_sequence: 1 }, { items: [{ ...message(2), turn_usage: duplicateUsage.turn_usage }] }], code: 'AGENT_MESSAGE_TURN_USAGE_DUPLICATE' },
    { pages: [{ items: [message(1)], next_after_sequence: 1 }, { items: [], next_after_sequence: 1 }], code: 'AGENT_MESSAGE_CURSOR_INVALID' },
  ]
  for (const { pages, code } of cases) {
    await assert.rejects(loadAgentMessages({ messages: async () => pages.shift()! }, 'ags-session'), { code })
  }
})

test('历史读取达到分页上限或已取消时停止，不继续请求后续页面', async () => {
  let requests = 0
  await assert.rejects(loadAgentMessages({ messages: async () => {
    requests += 1
    return { items: [], next_after_sequence: requests }
  } }, 'ags-session'), { code: 'AGENT_MESSAGE_PAGE_LIMIT' })
  assert.equal(requests, 100)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(loadAgentMessages({ messages: async () => {
    requests += 1
    return { items: [] }
  } }, 'ags-session', 0, controller.signal), { name: 'AbortError' })
  assert.equal(requests, 100)
})
