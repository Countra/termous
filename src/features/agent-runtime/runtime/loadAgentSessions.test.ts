import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentSessionPage } from '#entities/agent'
import { agentSessionFixture } from '../model/agentRuntimeTestFixtures.ts'
import { loadAgentSessions } from './loadAgentSessions.ts'

test('会话分页保留查询条件，跨页重复条目按最高 revision 合并', async () => {
  const original = agentSessionFixture({ revision: 1, title: '旧标题' })
  const latest = { ...original, revision: 3, title: '新标题' }
  const pages: AgentSessionPage[] = [
    { items: [latest], next_cursor: 'next' },
    { items: [original, agentSessionFixture({ id: 'second' })] },
  ]
  const actual = await loadAgentSessions({ sessions: async (options) => {
    assert.equal(options?.query, 'SSH%_')
    assert.equal(options?.archived, false)
    assert.equal(options?.limit, 200)
    assert.equal(options?.cursor, pages.length === 2 ? undefined : 'next')
    return pages.shift()!
  } }, { archived: false, query: 'SSH%_' })
  assert.equal(actual.length, 2)
  assert.deepEqual(actual[0], latest)
})

test('会话分页拒绝归档范围混入、循环 cursor 和超过 100 页', async () => {
  await assert.rejects(loadAgentSessions({ sessions: async () => ({ items: [agentSessionFixture()] }) }, { archived: true }), { code: 'AGENT_SESSION_PAGE_INVALID' })
  await assert.rejects(loadAgentSessions({ sessions: async () => ({ items: [agentSessionFixture({ archived_at: '2026-09-05T00:00:00Z' })] }) }, { archived: false }), { code: 'AGENT_SESSION_PAGE_INVALID' })
  let requests = 0
  await assert.rejects(loadAgentSessions({ sessions: async () => {
    requests += 1
    return { items: [], next_cursor: 'same' }
  } }), { code: 'AGENT_SESSION_CURSOR_INVALID' })
  assert.equal(requests, 2)
  requests = 0
  await assert.rejects(loadAgentSessions({ sessions: async () => ({ items: [], next_cursor: String(++requests) }) }), { code: 'AGENT_SESSION_PAGE_LIMIT' })
  assert.equal(requests, 100)
})

test('网关忽略取消仍不能接受迟到结果或启动下一页', async () => {
  const controller = new AbortController()
  let resolve!: (value: AgentSessionPage) => void
  let requests = 0
  const pending = loadAgentSessions({ sessions: async () => {
    requests += 1
    return new Promise<AgentSessionPage>((done) => { resolve = done })
  } }, { signal: controller.signal })
  controller.abort()
  resolve({ items: [agentSessionFixture()], next_cursor: 'later' })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(requests, 1)
})
