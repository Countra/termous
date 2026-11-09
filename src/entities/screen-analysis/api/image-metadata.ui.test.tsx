import { expect, it } from 'vitest'
import { parseAnalysisImageMetadata } from './image-metadata'

const legacy = { analysis_id: 'record', layer: 'elements', original: { width: 100, height: 100, coordinate_space: 'original_pixels' },
  width: 100, height: 100, crop: [0, 0, 100, 100], matched_count: 3, drawn_count: 3, limited_by_inference: false }
const parse = (extra: object) => parseAnalysisImageMetadata(JSON.stringify({ ...legacy, ...extra }), 'record')

it('兼容旧元数据，编号省略不改变匹配和绘制数量', () => {
  expect(parse({})).toEqual(legacy)
  expect(parse({ label_mode: 'auto', labeled_count: 2, unlabeled_count: 1 })).toMatchObject({ matched_count: 3, drawn_count: 3 })
  expect(parse({ label_mode: 'all', labeled_count: 3, unlabeled_count: 0 }).labeled_count).toBe(3)
  expect(parse({ label_mode: 'none', labeled_count: 0, unlabeled_count: 3 }).labeled_count).toBe(0)
  expect(parse({ matched_count: 0, drawn_count: 0, label_mode: 'auto', labeled_count: 0, unlabeled_count: 0 }).drawn_count).toBe(0)
})

it('拒绝不完整、非法模式及不一致的编号统计', () => {
  for (const extra of [
    { label_mode: 'auto' }, { labeled_count: 2, unlabeled_count: 1 },
    { label_mode: 'unknown', labeled_count: 2, unlabeled_count: 1 },
    { label_mode: ['auto'], labeled_count: 2, unlabeled_count: 1 },
    { label_mode: 'auto', labeled_count: null, unlabeled_count: 3 },
    { label_mode: 'auto', labeled_count: -1, unlabeled_count: 4 },
    { label_mode: 'auto', labeled_count: 1.5, unlabeled_count: 1.5 },
    { label_mode: 'auto', labeled_count: 2, unlabeled_count: 2 },
    { label_mode: 'none', labeled_count: 1, unlabeled_count: 2 },
  ]) expect(() => parse(extra)).toThrow('画面分析图片元数据无效')
})
