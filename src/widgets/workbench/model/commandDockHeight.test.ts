import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampCommandDockHeight,
  commandDockHeightLimits,
  parseCommandDockHeight,
  resolveCommandDockHeightBounds,
} from './commandDockHeight.ts'

test('命令台高度偏好使用稳定默认值并限制持久化输入', () => {
  assert.equal(parseCommandDockHeight(undefined), commandDockHeightLimits.default)
  assert.equal(parseCommandDockHeight(Number.NaN), commandDockHeightLimits.default)
  assert.equal(parseCommandDockHeight(120), commandDockHeightLimits.min)
  assert.equal(parseCommandDockHeight(900), commandDockHeightLimits.max)
  assert.equal(parseCommandDockHeight(318.6), 319)
})

test('命令台动态上限为主终端保留最小可用高度', () => {
  assert.deepEqual(resolveCommandDockHeightBounds(560, 262), { min: 200, max: 520 })
  assert.deepEqual(resolveCommandDockHeightBounds(240, 262), { min: 200, max: 262 })
  assert.deepEqual(resolveCommandDockHeightBounds(180, 180), { min: 120, max: 120 })
  assert.deepEqual(resolveCommandDockHeightBounds(100, 100), { min: 0, max: 0 })
})

test('命令台高度钳制会取整并同时遵守有效上下限', () => {
  assert.equal(clampCommandDockHeight(248.7, 200, 400), 249)
  assert.equal(clampCommandDockHeight(180, 200, 400), 200)
  assert.equal(clampCommandDockHeight(460, 200, 400), 400)
})
