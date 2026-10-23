import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAnalysisMediaRequest } from './analysis-media.ts'

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
