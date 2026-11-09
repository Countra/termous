import assert from 'node:assert/strict'
import test from 'node:test'
import { indicatorBounds, sameBounds } from './geometry.ts'

test('负坐标屏幕边缘保持徽标和状态条在 DIP 工作区内', () => {
  const area = { x: -1536, y: -100, width: 1536, height: 824 }
  for (const point of [{ x: -1, y: 723 }, { x: -1536, y: -100 }, { x: -600, y: 0 }]) {
    const bounds = indicatorBounds(point, area)
    for (const r of [bounds.bar, bounds.badge]) {
      assert.ok(r.x >= area.x && r.y >= area.y)
      assert.ok(r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height)
    }
  }
})
test('同屏移动只改变徽标，跨屏按新工作区重新定位状态条', () => {
  const area = { x: 0, y: 0, width: 1280, height: 720 }
  const a = indicatorBounds({ x: 50, y: 50 }, area)
  const b = indicatorBounds({ x: 900, y: 400 }, area)
  assert.ok(sameBounds(a.bar, b.bar))
  assert.ok(!sameBounds(a.badge, b.badge))
  const other = indicatorBounds({ x: 1400, y: 50 }, { ...area, x: 1280 })
  assert.ok(!sameBounds(a.bar, other.bar))
})
