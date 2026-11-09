import assert from 'node:assert/strict'
import test from 'node:test'
import { AutomationPointerMotion } from './automationPointerMotion.ts'

test('首次坐标直接对齐，后续移动平滑减速并准确到位', () => {
  const motion = new AutomationPointerMotion()
  motion.moveTo({ x: 10, y: 20 }, 0, 'smooth')
  assert.deepEqual(motion.sample(0), { x: 10, y: 20, remaining: 0 })
  motion.moveTo({ x: 500, y: 300 }, 1000, 'smooth')
  const a = motion.sample(1040)!
  const b = motion.sample(1080)!
  const c = motion.sample(1120)!
  assert.ok(a.x > 10 && a.x < b.x && b.x < c.x && c.x < 500)
  assert.ok(b.x - a.x > c.x - b.x)
  assert.deepEqual(motion.sample(1180), { x: 500, y: 300, remaining: 0 })
})

test('途中改向从当前展示位置衔接，六十毫秒内追上最新目标且不回播', () => {
  const motion = new AutomationPointerMotion()
  motion.moveTo({ x: 0, y: 0 }, 0, 'instant')
  motion.moveTo({ x: 800, y: 400 }, 1000, 'smooth')
  const current = motion.sample(1050)!
  motion.moveTo({ x: 100, y: 200 }, 1050, 'smooth')
  assert.equal(motion.sample(1050)!.x, current.x)
  assert.equal(motion.sample(1050)!.y, current.y)
  assert.deepEqual(motion.sample(1110), { x: 100, y: 200, remaining: 0 })
  assert.deepEqual(motion.sample(5000), { x: 100, y: 200, remaining: 0 })
})

test('重复落点不重置进度，连续移动与拖拽保持短时跟随', () => {
  const motion = new AutomationPointerMotion()
  motion.moveTo({ x: 0, y: 0 }, 0, 'instant')
  motion.moveTo({ x: 500, y: 400 }, 1000, 'responsive')
  motion.moveTo({ x: 500, y: 400 }, 1030, 'responsive')
  assert.deepEqual(motion.sample(1060), { x: 500, y: 400, remaining: 0 })
  motion.moveTo({ x: 900, y: 800 }, 1100, 'smooth')
  assert.deepEqual(motion.sample(1160), { x: 900, y: 800, remaining: 0 })
})

test('立即对齐和重置取消在途动画，同一坐标也可以立即完成', () => {
  const motion = new AutomationPointerMotion()
  motion.moveTo({ x: 0, y: 0 }, 0, 'instant')
  motion.moveTo({ x: 800, y: 400 }, 1000, 'smooth')
  motion.moveTo({ x: 800, y: 400 }, 1010, 'instant')
  assert.deepEqual(motion.sample(1010), { x: 800, y: 400, remaining: 0 })
  motion.moveTo({ x: 100, y: 50 }, 2000, 'smooth')
  motion.reset()
  assert.equal(motion.sample(2001), null)
  motion.moveTo({ x: 20, y: 30 }, 2002, 'smooth')
  assert.deepEqual(motion.sample(2002), { x: 20, y: 30, remaining: 0 })
})

test('每一帧都有新目标时仍持续前进，停止更新后及时追上终点', () => {
  const motion = new AutomationPointerMotion()
  motion.moveTo({ x: 0, y: 0 }, 0, 'instant')
  motion.sample(0)
  let previous = 0
  for (let index = 1; index <= 12; index++) {
    const now = index * 33
    motion.moveTo({ x: index * 20, y: index * 10 }, now, 'responsive')
    const current = motion.sample(now)!
    if (index > 1) assert.ok(current.x > previous, `第 ${index} 帧停滞于 ${current.x}`)
    assert.ok(current.x <= index * 20)
    previous = current.x
  }
  assert.deepEqual(motion.sample(12 * 33 + 60), { x: 240, y: 120, remaining: 0 })
})
