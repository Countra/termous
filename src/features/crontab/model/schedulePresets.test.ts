import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCrontabExpression,
  crontabWeekdayOrder,
  createCrontabScheduleDraft,
  hasPlausibleCrontabExpression,
} from './schedulePresets.ts'

test('每周计划按星期一到星期日展示', () => {
  assert.deepEqual(crontabWeekdayOrder, [1, 2, 3, 4, 5, 6, 0])
})

test('常用计划和 Cron 表达式可稳定往返', () => {
  for (const expression of [
    '* * * * *',
    '15 * * * *',
    '30 2 * * *',
    '45 3 * * 5',
    '5 4 12 * *',
    '@reboot',
  ]) {
    assert.equal(buildCrontabExpression(createCrontabScheduleDraft(expression)), expression)
  }
})

test('扩展表达式保留为自定义模式且只做结构预检', () => {
  const expression = '*/10 8-18 * * 1-5'
  const draft = createCrontabScheduleDraft(expression)
  assert.equal(draft.mode, 'custom')
  assert.equal(buildCrontabExpression(draft), expression)
  assert.equal(hasPlausibleCrontabExpression(expression), true)
  assert.equal(hasPlausibleCrontabExpression('@daily'), true)
  assert.equal(hasPlausibleCrontabExpression('@every'), false)
  assert.equal(hasPlausibleCrontabExpression('* * *'), false)
})
