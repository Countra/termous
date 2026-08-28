import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentAttachmentLimits,
  AgentAttachmentSelectionError,
  validateAgentAttachmentSelection,
} from './agentAttachmentPolicy.ts'

test('附件策略按文件签名识别 PNG、JPEG 和 WebP，并规范缺失的 MIME', async () => {
  const fixtures = [
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    ['image/webp', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
  ] as const

  for (const [mimeType, bytes] of fixtures) {
    const [selection] = await validateAgentAttachmentSelection([], [file(new Uint8Array(bytes), 'image.bin')])
    assert.equal(selection?.kind, 'image')
    assert.equal(selection?.file.type, mimeType)
  }
})

test('附件策略拒绝声明 MIME 与图片签名不一致', async () => {
  await assert.rejects(
    validateAgentAttachmentSelection([], [file([0xff, 0xd8, 0xff], 'image.png', 'image/png')]),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_IMAGE_SIGNATURE',
  )
  await assert.rejects(
    validateAgentAttachmentSelection([], [file([1, 2, 3], 'image.png', 'image/png')]),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_IMAGE_SIGNATURE',
  )
})

test('附件策略仅接受无 NUL 的有效 UTF-8 文本', async () => {
  const [selection] = await validateAgentAttachmentSelection([], [file(new TextEncoder().encode('有效文本'), 'note.txt', 'text/plain')])
  assert.equal(selection?.kind, 'text')

  await assert.rejects(
    validateAgentAttachmentSelection([], [file([0xc3, 0x28], 'invalid.txt', 'text/plain')]),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_TEXT_ENCODING',
  )
  await assert.rejects(
    validateAgentAttachmentSelection([], [file([0x61, 0, 0x62], 'nul.txt', 'text/plain')]),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_TEXT_ENCODING',
  )
})

test('附件策略执行数量、单文件和分类总量限制', async () => {
  await assert.rejects(
    validateAgentAttachmentSelection([], Array.from({ length: 9 }, (_, index) => file([index], `${index}.txt`))),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_LIMIT_COUNT',
  )
  await assert.rejects(
    validateAgentAttachmentSelection([], [file(new Uint8Array(agentAttachmentLimits.maximumTextBytes + 1), 'large.txt')]),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_LIMIT_TEXT',
  )
  await assert.rejects(
    validateAgentAttachmentSelection(
      [{ kind: 'text', size_bytes: agentAttachmentLimits.maximumTextTotalBytes }],
      [file([0x61], 'extra.txt')],
    ),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_LIMIT_TEXT_TOTAL',
  )
  await assert.rejects(
    validateAgentAttachmentSelection(
      [{ kind: 'image', size_bytes: agentAttachmentLimits.maximumImageTotalBytes }],
      [file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'extra.png')],
    ),
    (error: unknown) => errorCode(error) === 'AGENT_ATTACHMENT_LIMIT_IMAGE_TOTAL',
  )
})

function file(content: BlobPart | number[], name: string, type = '') {
  const part = Array.isArray(content) ? new Uint8Array(content) : content
  return new File([part], name, { type, lastModified: 1 })
}

function errorCode(error: unknown) {
  return error instanceof AgentAttachmentSelectionError ? error.code : undefined
}
