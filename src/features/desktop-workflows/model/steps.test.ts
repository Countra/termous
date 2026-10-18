import assert from 'node:assert/strict'
import test from 'node:test'
import { copyStep, editStep, findStep, insertStep, moveStep, newStep } from './steps.ts'
import { imagePoint, imageRegion } from './coordinates.ts'
import { blankImage, setStepImage, setStepTarget } from './images.ts'

test('嵌套步骤复制重新分配全部标识，排序和删除保持分支边界', () => {
  const branch = newStep('if'); const a = newStep('delay'); const b = newStep('keyboard.text')
  const source = insertStep([branch], a, branch.id)
  const both = insertStep(source, b, branch.id, 'else')
  const copied = copyStep(both, branch.id)
  assert.equal(copied.length, 2)
  assert.notEqual(copied[1]!.id, branch.id)
  assert.notEqual(copied[1]!.steps![0]!.id, a.id)
  assert.notEqual(copied[1]!.else![0]!.id, b.id)
  assert.equal(findStep(both, a.id)?.kind, 'delay')
  const moved = moveStep([a, b], b.id, -1)
  assert.equal(moved[0]!.id, b.id)
  assert.equal(editStep(both, a.id, () => undefined)[0]!.steps!.length, 0)
  assert.equal(both[0]!.steps!.length, 1)
})

test('截图缩放和裁剪始终使用原始像素并限制边界', () => {
  const rect = { left: 20, top: 50, width: 960, height: 540 }
  assert.deepEqual(imagePoint({ x: 500, y: 320 }, rect, { width: 3840, height: 2160 }), { x: 1920, y: 1080 })
  assert.deepEqual(imagePoint({ x: 2000, y: -100 }, rect, { width: 3840, height: 2160 }), { x: 3839, y: 0 })
  assert.deepEqual(imageRegion({ x: 45, y: 30 }, { x: 20, y: 10 }), { x: 20, y: 10, width: 26, height: 21 })
})

test('跨多个位置拖动采用插入排序，保留中间步骤顺序和分支边界', () => {
  const a = newStep('delay'); const b = newStep('keyboard.text'); const c = newStep('capture'); const d = newStep('keyboard.key')
  const source = [a, b, c, d]
  assert.deepEqual(moveStep(source, a.id, 3).map(step => step.id), [b.id, c.id, d.id, a.id])
  assert.deepEqual(moveStep(source, d.id, -3).map(step => step.id), [d.id, a.id, b.id, c.id])
  assert.deepEqual(moveStep(source, a.id, -1), source)
  const branch = { ...newStep('if'), steps: source, else: [newStep('capture')] }
  const [moved] = moveStep([branch], b.id, 2)
  assert.deepEqual(moved!.steps!.map(step => step.id), [a.id, c.id, d.id, b.id])
  assert.deepEqual(moved!.else, branch.else)
  assert.deepEqual(source.map(step => step.id), [a.id, b.id, c.id, d.id])
})

test('图像定位移除旧坐标绑定，但保留动作参数和拖动起点绑定', () => {
  const step = { ...newStep('pointer.click'), bindings: { x: 'px', y: 'py', count: 'clicks' } }
  assert.deepEqual(setStepImage(step, 'target', blankImage()).bindings, { count: 'clicks' })
  assert.deepEqual(setStepTarget(step, 'target', { kind: 'image' }).bindings, { count: 'clicks' })
  assert.deepEqual(setStepImage(step, 'end_target', blankImage()).bindings, step.bindings)
  assert.deepEqual(step.bindings, { x: 'px', y: 'py', count: 'clicks' })
})
