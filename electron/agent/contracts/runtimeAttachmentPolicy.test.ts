import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeRuntimeAttachment,
  isRuntimeMessageAttachmentList,
} from './runtimeAttachmentPolicy.ts'

test('Runtime 附件列表接受精确边界并拒绝聚合超限与重复 ID', () => {
  const chunk = Buffer.alloc(256 * 1024, 0x61).toString('base64')
  const attachment = (id: string, contentBase64 = chunk) => ({
    id,
    kind: 'text' as const,
    mime_type: 'text/plain',
    content_base64: contentBase64,
  })

  assert.equal(isRuntimeMessageAttachmentList([
    attachment('aga_one'),
    attachment('aga_two'),
  ]), true)
  assert.equal(isRuntimeMessageAttachmentList([
    attachment('aga_one'),
    attachment('aga_two'),
    attachment('aga_three', 'YQ=='),
  ]), false)
  assert.equal(isRuntimeMessageAttachmentList([
    attachment('aga_same', 'YQ=='),
    attachment('aga_same', 'Yg=='),
  ]), false)
})

test('Runtime 图片解码复核声明 MIME 与文件 magic', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(decodeRuntimeAttachment({
    id: 'aga_png',
    kind: 'image',
    mime_type: 'image/png',
    content_base64: png.toString('base64'),
  }).byteLength, 8)
  assert.throws(() => decodeRuntimeAttachment({
    id: 'aga_mismatch',
    kind: 'image',
    mime_type: 'image/jpeg',
    content_base64: png.toString('base64'),
  }), /AGENT_RUNTIME_ATTACHMENT_INVALID/u)
})
