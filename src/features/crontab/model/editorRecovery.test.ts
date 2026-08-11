import assert from 'node:assert/strict'
import test from 'node:test'
import type { CrontabJob } from '#entities/crontab'
import { findReloadedCrontabJob } from './editorRecovery.ts'

const original: CrontabJob = {
  id: 'job-old',
  line_number: 4,
  enabled: true,
  schedule_kind: 'standard',
  expression: '0 2 * * *',
  command: '/usr/bin/backup',
  editable: true,
  warnings: [],
}

test('重新加载后仅为完全一致的原任务更新临时 Job ID', () => {
  const reloaded = { ...original, id: 'job-new' }
  assert.equal(findReloadedCrontabJob(original, [reloaded]), reloaded)
})

test('任务内容、位置或可编辑性变化后拒绝重绑定草稿', () => {
  for (const changed of [
    { ...original, id: 'job-new', line_number: 5 },
    { ...original, id: 'job-new', command: '/usr/bin/changed' },
    { ...original, id: 'job-new', enabled: false },
    { ...original, id: 'job-new', editable: false },
  ]) {
    assert.equal(findReloadedCrontabJob(original, [changed]), null)
  }
})
