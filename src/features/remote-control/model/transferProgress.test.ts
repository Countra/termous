import assert from 'node:assert/strict'
import { test } from 'node:test'
import { transferPercent, uploadStage } from './transferProgress.ts'

test('上传总进度包含目标写入，只有最终保存成功才能达到 100%', () => {
  assert.equal(transferPercent('running', 100, 50, 0), 25)
  assert.equal(transferPercent('running', 100, 100, 0), 50)
  assert.equal(transferPercent('publishing', 100, 100, 50), 75)
  for (const state of ['publishing', 'uncertain', 'failed', 'paused']) {
    assert.equal(transferPercent(state, 100, 100, 100), 99)
  }
  assert.equal(transferPercent('completed', 100, 100, 100), 100)
  assert.equal(transferPercent('running', 0, 0, 0), 0)
  assert.equal(transferPercent('completed', 0, 0, 0), 100)
  assert.equal(transferPercent('running', 100, 20), 20)
  assert.equal(uploadStage('running', 100, 0), 'sendingToHost')
  assert.equal(uploadStage('received', 100, 0), 'writingTarget')
  assert.equal(uploadStage('publishing', 100, 50), 'writingTarget')
  assert.equal(uploadStage('publishing', 100, 100), 'confirming')
})
