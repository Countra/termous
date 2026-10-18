import assert from 'node:assert/strict'
import test from 'node:test'
import { clampDetachedBounds } from './geometry.ts'

test('移除显示器后窗口回到可用区域，小显示器不超出工作区', () => {
  assert.deepEqual(clampDetachedBounds({ x: 9000, y: -3000, width: 2000, height: 1200 }, { x: -1280, y: 0, width: 1280, height: 720 }),
    { x: -1280, y: 0, width: 1280, height: 720 })
  assert.deepEqual(clampDetachedBounds(undefined, { x: 0, y: 0, width: 1920, height: 1080 }), { x: 410, y: 140, width: 1100, height: 800 })
})
