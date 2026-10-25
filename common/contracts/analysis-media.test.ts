import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAnalysisMediaRequest } from './analysis-media.ts'

test('几何查询兼容无参调用并支持 OCR 筛选，但拒绝分页和图片变换', () => {
  assert(isAnalysisMediaRequest({ operation: 'geometry', id: 'record' }))
  assert(isAnalysisMediaRequest({ operation: 'geometry', id: 'record', query: { layer: 'ocr', q: '连接', text_gt: .5, bbox: [0, 0, 100, 200] } }))
  for (const query of [{ cursor: 'next' }, { limit: 20 }, { sort: 'spatial' }, { crop: [0, 0, 10, 10] }, { max_side: 1600 }]) {
    assert(!isAnalysisMediaRequest({ operation: 'geometry', id: 'record', query }))
  }
})

test('独立窗口分析协议只接受有界业务请求，不接受路径或身份', () => {
  assert.equal(isAnalysisMediaRequest({ operation: 'submit', input: { request_id: 'retry', source: { kind: 'preview', id: 'preview' } } }), true)
  assert.equal(isAnalysisMediaRequest({ operation: 'spans', id: 'record', query: { text_min: .2, text_max: .5, bbox: [0, 0, 20, 20] } }), true)
  for (const value of [
    { operation: 'get', id: 'record', url: 'http://localhost/private' },
    { operation: 'image', id: 'record', image: '../original' },
    { operation: 'submit', input: { request_id: 'r', source: { kind: 'preview', id: 'p', actor: 'admin' } } },
    { operation: 'submit', input: { request_id: 'r', source: { kind: 'analysis', id: 'p' }, parameters: { confidence: NaN } } },
    { operation: 'submit', input: { request_id: 'r', source: { kind: 'preview', id: 'p' }, parameters: { confidence: .2 } } },
    { operation: 'elements', id: 'r', query: { text_min: Infinity } },
    { operation: 'elements', id: 'r', query: { q: 'a'.repeat(2049) } },
  ]) assert.equal(isAnalysisMediaRequest(value), false)
})

test('独立窗口允许模式覆盖和筛选图读取，拒绝图片分页及未知字段', () => {
  assert.equal(isAnalysisMediaRequest({ operation: 'full', id: 'record' }), true)
  assert.equal(isAnalysisMediaRequest({ operation: 'submit', input: { request_id: 'ocr', source: { kind: 'preview', id: 'p' }, parameters: { detector_enabled: false, ocr_enabled: true } } }), true)
  assert.equal(isAnalysisMediaRequest({ operation: 'render', id: 'record', query: { layer: 'ocr', text_gt: .5, element_ids: [1, 2], span_ids: [4], crop: [0, 0, 500, 300], max_side: 256 } }), true)
  for (const query of [{ limit: 20 }, { cursor: 'page' }, { sort: 'spatial' }, { crop: [0, 0, NaN, 10] }, { text_gt: Infinity }, { path: 'original' }]) {
    assert.equal(isAnalysisMediaRequest({ operation: 'render', id: 'record', query }), false)
  }
  assert.equal(isAnalysisMediaRequest({ operation: 'submit', input: { request_id: 'off', source: { kind: 'preview', id: 'p' }, parameters: { detector_enabled: false, ocr_enabled: false } } }), false)
})
