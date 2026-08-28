import assert from 'node:assert/strict'
import test from 'node:test'
import { formatForwardDateTime, formatForwardDuration } from './forwardTiming.ts'

test('端口转发运行时长覆盖非法时间与负时差', () => {
  assert.equal(formatForwardDuration('invalid', Date.now()), '--')
  assert.equal(formatForwardDuration('2026-08-07T10:00:01.000Z', Date.parse('2026-08-07T10:00:00.000Z')), '0:00')
})

test('端口转发运行时长按分钟、小时和天边界格式化', () => {
  const startedAt = '2026-08-07T00:00:00.000Z'

  assert.equal(formatForwardDuration(startedAt, Date.parse('2026-08-07T00:00:59.000Z')), '0:59')
  assert.equal(formatForwardDuration(startedAt, Date.parse('2026-08-07T00:01:00.000Z')), '1:00')
  assert.equal(formatForwardDuration(startedAt, Date.parse('2026-08-07T01:00:00.000Z')), '1:00:00')
  assert.equal(formatForwardDuration(startedAt, Date.parse('2026-08-08T00:00:00.000Z')), '1d 00:00:00')
})

test('端口转发开始时间按本地年月日时分秒稳定补零', () => {
  const startedAt = new Date(2026, 7, 9, 6, 5, 4).toISOString()

  assert.equal(formatForwardDateTime(startedAt), '2026-08-09 06:05:04')
  assert.equal(formatForwardDateTime('invalid'), '')
})
