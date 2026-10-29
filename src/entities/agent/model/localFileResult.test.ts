import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readLocalFileResult } from './localFileResult.ts'
import type { AgentToolResultPart } from './types.ts'

const result = (name: string, value: unknown): AgentToolResultPart => ({ tool_call_id: 'call', tool_name: name, is_error: false, content: [{ type: 'text', text: JSON.stringify(value) }] })

test('本地文件预览遵循原有正文预算，不把外部同名工具或失败当作成功', () => {
  const read = result('termous.local.files.read', { path: 'C:/test.txt', text: 'a'.repeat(3999) + '😀done', offset: 20, next_offset: 4027, size_bytes: 5000, truncated: true })
  const projected = readLocalFileResult(read)
  assert.equal(projected?.text?.length, 3999)
  assert.equal(projected?.partial, true)
  assert.equal(projected?.previewLimited, true)
  assert.equal(readLocalFileResult({ ...read, tool_name: 'external::termous.local.files.read' }), undefined)
  assert.equal(readLocalFileResult({ ...read, is_error: true }), undefined)
  assert.equal(readLocalFileResult(result('termous.local.files.read', { path: 'C:/image.png', size_bytes: 100, offset: 0,
    next_offset: 100, truncated: false, mime_type: 'image/png', image_resource: { id: 'image' } })), undefined)
  assert.equal(readLocalFileResult(result('termous.local.files.read', { path: 'C:/empty.txt', size_bytes: 0, offset: 0,
    next_offset: 0, truncated: false }))?.text, '')
  assert.equal(readLocalFileResult(result('termous.local.files.edit', { state: 'uncertain', value: { path: 'x', size_bytes: 3, created: false } })), undefined)
  assert.equal(readLocalFileResult(result('termous.local.files.edit', { state: 'completed', value: { path: 'x', size_bytes: 3, created: false } }))?.action, 'edit')
})
