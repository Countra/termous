import assert from 'node:assert/strict'
import test from 'node:test'
import { moveSelection, resizeHandles, resizeSelection } from './selection.ts'

const size = { width: 1280, height: 720 }
const region = { x: 200, y: 100, width: 320, height: 180 }

test('移动选区保留尺寸，按原始像素取整并限制在画面边界内', () => {
  assert.deepEqual(moveSelection(region, { x: 20.4, y: -30.6 }, size), { ...region, x: 220, y: 69 })
  assert.deepEqual(moveSelection(region, { x: -2000, y: 2000 }, size), { ...region, x: 0, y: 540 })
  assert.deepEqual(moveSelection({ x: 0, y: 0, ...size }, { x: 300, y: -300 }, size), { x: 0, y: 0, ...size })
  assert.deepEqual(region, { x: 200, y: 100, width: 320, height: 180 })
})

test('八个缩放手柄只移动对应边，对边保持固定', () => {
  for (const handle of resizeHandles) {
    const next = resizeSelection(region, handle, { x: 10, y: 20 }, size)
    assert.equal(next.x, handle.includes('w') ? 210 : 200)
    assert.equal(next.y, handle.includes('n') ? 120 : 100)
    assert.equal(next.x + next.width, handle.includes('e') ? 530 : 520)
    assert.equal(next.y + next.height, handle.includes('s') ? 300 : 280)
  }
})

test('调整边框不能越界或翻转，允许精确覆盖最后一列与一行像素', () => {
  assert.deepEqual(resizeSelection(region, 'nw', { x: -5000, y: -5000 }, size), { x: 0, y: 0, width: 520, height: 280 })
  assert.deepEqual(resizeSelection(region, 'se', { x: 5000, y: 5000 }, size), { ...region, width: 1080, height: 620 })
  assert.deepEqual(resizeSelection(region, 'nw', { x: 5000, y: 5000 }, size), { x: 519, y: 279, width: 1, height: 1 })
  assert.deepEqual(resizeSelection(region, 'se', { x: -5000, y: -5000 }, size), { ...region, width: 1, height: 1 })
})
