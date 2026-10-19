import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cloudDeadlineRemaining } from './deadline.ts'

test('云端期限仅随单调耗时递减，与本机日期无关', () => {
  for (const server_time of ['2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
    const value = { server_time }
    const expires = new Date(Date.parse(server_time) + 60_000).toISOString()
    assert.equal(cloudDeadlineRemaining(value, expires, 100), 60_000)
    assert.equal(cloudDeadlineRemaining(value, expires, 30_100), 30_000)
    assert.equal(cloudDeadlineRemaining(value, expires, 60_100), 0)
  }
})

test('缺少或无效的云端时间不能授予本地操作资格', () => {
  assert.equal(cloudDeadlineRemaining({ server_time: '' }, '2099-01-01T00:00:00Z'), 0)
  assert.equal(cloudDeadlineRemaining(undefined, '2099-01-01T00:00:00Z'), 0)
})
