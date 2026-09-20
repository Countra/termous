import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeAuditDetails, decodeAuditEvent, decodeAuditPage, decodeAuditStatus } from './auditProtocol.ts'

const event = { id: 'one', occurred_at: '2026-09-20T00:00:00Z', received_at: '2026-09-20T00:00:01Z', source: 'mcp', producer: 'mcp_server', level: 'info', type: 'tool', action: 'termous.hosts.list', scope: 'hosts', outcome: 'succeeded', actor_id: 'client', actor_name: 'Client', correlation_id: 'call', duration_ms: 2, summary: '', details_version: 1 }

test('版本化详情与未知版本安全回退', () => {
  assert.equal(decodeAuditDetails(decodeAuditEvent({ ...event, details: { result: { status: 'done' } } })).kind, 'tool')
  const unknown = decodeAuditEvent({ ...event, details_version: 2, details: { html: '<script>alert(1)</script>' } })
  assert.equal(decodeAuditDetails(unknown).kind, 'unknown')
  assert.equal(decodeAuditPage({ items: [event], next_cursor: 'next' }).items.length, 1)
})

test('非法来源、深层或过大 JSON、非法状态计数不进入页面', () => {
  assert.throws(() => decodeAuditEvent({ ...event, source: 'spoofed' }))
  assert.throws(() => decodeAuditEvent({ ...event, details: { text: 'a'.repeat(17000) } }))
  let value: unknown = {}
  for (let index = 0; index < 20; index++) value = { value }
  assert.throws(() => decodeAuditEvent({ ...event, details: value }))
  assert.throws(() => decodeAuditPage({ items: Array.from({ length: 201 }, () => event) }))
  assert.throws(() => decodeAuditStatus({ state: 'ready', queued: -1 }))
})

test('接受排序查询的长游标，仍拒绝超过接口上限的游标', () => {
  assert.equal(decodeAuditPage({ items: [event], next_cursor: 'a'.repeat(4096) }).next_cursor?.length, 4096)
  assert.throws(() => decodeAuditPage({ items: [], next_cursor: 'a'.repeat(4097) }))
})
