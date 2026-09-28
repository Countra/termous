import assert from 'node:assert/strict'
import test from 'node:test'
import { fitImageScale, zoomImageView, type ImageView } from './imageViewport.ts'

const fitView: ImageView = { scale: null, rotation: 0, offset: { x: 0, y: 0 } }

test('大图从适应窗口缩小时沿用屏幕比例，不跳回原始尺寸', () => {
  const scale = fitImageScale({ width: 5761, height: 3240 }, { width: 1000, height: 500 }, 0)
  const smaller = zoomImageView(fitView, scale, 1 / 1.2, { x: 0, y: 0 })
  assert.ok(smaller.scale! < scale)
  assert.ok(smaller.scale! * 5761 < 1000)
  assert.ok(Math.abs(zoomImageView(smaller, scale, 1.2, { x: 0, y: 0 }).scale! - scale) < 1e-10)
})

test('旋转后按交换的边界适配，四次旋转回到原比例', () => {
  const image = { width: 2000, height: 1000 }
  const stage = { width: 1000, height: 500 }
  assert.equal(fitImageScale(image, stage, 90), 464 / 2000)
  assert.equal(fitImageScale(image, stage, -90), 464 / 2000)
  assert.equal(fitImageScale(image, stage, 360), fitImageScale(image, stage, 0))
})

test('缩放保持光标所指图像位置，已有拖拽偏移同比调整', () => {
  const view = { ...fitView, scale: 0.5, offset: { x: 40, y: -20 } }
  const anchor = { x: 160, y: 70 }
  const zoomed = zoomImageView(view, 0.5, 1.2, anchor)
  assert.equal((anchor.x - zoomed.offset.x) / zoomed.scale!, (anchor.x - view.offset.x) / view.scale)
  assert.equal((anchor.y - zoomed.offset.y) / zoomed.scale!, (anchor.y - view.offset.y) / view.scale)
})

test('小图不自动放大，超大图适应比例可低于百分之十', () => {
  assert.equal(fitImageScale({ width: 40, height: 20 }, { width: 1000, height: 500 }, 0), 1)
  const scale = fitImageScale({ width: 10000, height: 10000 }, { width: 500, height: 500 }, 0)
  assert.ok(scale < 0.1)
  assert.equal(zoomImageView(fitView, scale, 1.2, { x: 0, y: 0 }).scale, scale * 1.2)
  assert.equal(zoomImageView(fitView, scale, 0.5, { x: 0, y: 0 }).scale, scale * 0.5)
})

test('缩放上限和下限不会继续移动图像', () => {
  for (const scale of [0.01, 6]) {
    const view = { ...fitView, scale, offset: { x: 2, y: -2 } }
    assert.deepEqual(zoomImageView(view, 0.5, scale === 6 ? 2 : 0.5, { x: 40, y: 20 }), view)
  }
})

test('窗口与旋转改变适配比例后，缩小不会被动态下限反向放大', () => {
  const view = { ...fitView, scale: 0.08 }
  assert.equal(zoomImageView(view, 0.2, 0.5, { x: 0, y: 0 }).scale, 0.04)
  assert.equal(zoomImageView(fitView, 0.005, 0.5, { x: 0, y: 0 }), fitView)
})
