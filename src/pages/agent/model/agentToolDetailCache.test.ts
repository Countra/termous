import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentMessagePart } from '#entities/agent'
import { AgentToolDetailCache } from './agentToolDetailCache.ts'

test('流式更新复用已完成工具详情，结果变化后重新脱敏且不保留旧正文', () => {
  let reads = 0
  const call: Extract<AgentMessagePart, { kind: 'tool_call' }> = {
    id: 'call', message_id: 'message', sequence: 1, revision: 1, created_at: '', updated_at: '',
    kind: 'tool_call', tool_call: { tool_call_id: 'tool', tool_name: 'observe',
      arguments: { get query() { reads++; return 'observe' }, password: 'private' } },
  }
  const result: Extract<AgentMessagePart, { kind: 'tool_result' }> = {
    ...call, id: 'result', sequence: 2, kind: 'tool_result', response_failure: undefined,
    tool_result: { tool_call_id: 'tool', tool_name: 'observe', content: [{ type: 'text', text: 'first' }], is_error: false },
  }
  const cache = new AgentToolDetailCache()
  const first = cache.detail(call, result)
  for (let index = 0; index < 1000; index++) assert.equal(cache.detail(call, result), first)
  assert.equal(reads, 1)
  assert.ok(!first.includes('private'))
  const updated = { ...result, revision: 2, tool_result: { ...result.tool_result, content: [{ type: 'text', text: 'second' }] } }
  const next = cache.detail(call, updated)
  assert.equal(reads, 2)
  assert.ok(next.includes('second'))
  assert.ok(!next.includes('first'))
  assert.ok(cache.detail(undefined, updated).includes('second'))
})
