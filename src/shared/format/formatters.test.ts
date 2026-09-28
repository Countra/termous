import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDate } from './formatters.ts'

test('缺失及 Go 零时间不显示为真实日期，Unix epoch 仍正常显示', () => {
  for (const value of [undefined, '', 'invalid', '0001-01-01T00:00:00Z', '0001-01-01T00:00:00.000+00:00']) {
    assert.equal(formatDate(value), '-')
  }
  assert.equal(formatDate('1970-01-01T00:00:00Z'), new Date(0).toLocaleString())
})
