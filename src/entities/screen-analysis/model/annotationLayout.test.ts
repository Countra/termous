import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hitCandidates, layoutLabels, overlaps, type Rect } from './annotationLayout.ts'

test('公共布局样例保持与 Core 相同的编号、位置和引线锚点', () => {
  const fixture = JSON.parse(readFileSync(new URL('./testdata/label-layout.json', import.meta.url), 'utf8'))
  assert.deepEqual(layoutLabels(fixture.items, fixture.width, fixture.height, 'auto'), fixture.expected)
})

test('拥挤时只省略编号，所有编号模式不改写输入', () => {
  const items = Array.from({ length: 30 }, (_, id) => ({ id, box: [0, 0, 30, 30] as Rect }))
  const before = structuredClone(items)
  const placed = layoutLabels(items, 80, 80, 'auto')
  assert(placed.length > 0 && placed.length < items.length)
  for (let i = 0; i < placed.length; i++) for (const next of placed.slice(i + 1)) assert(!overlaps(placed[i].box, next.box))
  assert.equal(layoutLabels(items, 80, 80, 'all').length, 30)
  assert.equal(layoutLabels(items, 80, 80, 'none').length, 0)
  assert.deepEqual(items, before)
})

test('重叠命中优先当前选择，其余按面积排序，并保留右下排他边界', () => {
  const items = [
    { id: 8, kind: 'region' as const, bbox_xyxy: [0, 0, 100, 100] as Rect, center_xy: [49, 49] as [number, number] },
    { id: 2, kind: 'text' as const, bbox_xyxy: [10, 10, 30, 30] as Rect, center_xy: [19, 19] as [number, number] },
  ]
  assert.deepEqual(hitCandidates(items, 12, 12).map(i => i.id), [2, 8])
  assert.deepEqual(hitCandidates(items, 12, 12, 8).map(i => i.id), [8, 2])
  assert.deepEqual(hitCandidates(items, 30, 30).map(i => i.id), [8])
})
