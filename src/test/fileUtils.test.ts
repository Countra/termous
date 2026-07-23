import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSeconds } from '../features/files/fileUtils.ts'

test('传输时间按秒、分和小时进位格式化', () => {
  assert.equal(formatSeconds(0.2), '1s')
  assert.equal(formatSeconds(59.2), '1m 0s')
  assert.equal(formatSeconds(146 * 60 + 44), '2h 26m 44s')
  assert.equal(formatSeconds(3599.2), '1h 0m 0s')
})

test('传输时间对缺失和无效值返回占位符', () => {
  assert.equal(formatSeconds(), '-')
  assert.equal(formatSeconds(0), '-')
  assert.equal(formatSeconds(-1), '-')
  assert.equal(formatSeconds(Number.POSITIVE_INFINITY), '-')
  assert.equal(formatSeconds(Number.NaN), '-')
})
