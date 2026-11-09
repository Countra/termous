import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeLocalApproval } from './localApproval.ts'

test('本地审批不能继承文件长期授权，并拒绝缺失的变更正文', () => {
  const input = { session_id: 'session', tool: 'termous.local.files.write', directory: 'C:\\work', path: 'C:\\work\\a.txt', after: '你好', after_bytes: 6, remember_allowed: true }
  assert.equal(decodeLocalApproval(input).remember_allowed, false)
  assert.throws(() => decodeLocalApproval({ ...input, after: undefined }))
  assert.throws(() => decodeLocalApproval({ ...input, after_bytes: 2 }))
})

test('命令审批必须包含实际执行文件、Shell 和完整命令', () => {
  const input = { session_id: 'session', tool: 'termous.local.commands.execute', directory: 'C:\\work', shell: 'cmd', executable: 'C:\\Windows\\System32\\cmd.exe', command: 'echo test', remember_allowed: true }
  assert.equal(decodeLocalApproval(input).remember_allowed, true)
  assert.throws(() => decodeLocalApproval({ ...input, executable: undefined }))
  assert.throws(() => decodeLocalApproval({ ...input, tool: 'external.command' }))
})

test('大文件审批只接受固定版本的轻量审阅引用，未知版本不能退化为空正文', () => {
  const review = { version: 1, id: 'review', digest: 'a'.repeat(64), before_sha256: 'b'.repeat(64), after_sha256: 'c'.repeat(64), change_count: 2, coarse: false }
  const value = { session_id: 'session', tool: 'termous.local.files.edit', directory: 'C:/work', path: 'C:/work/a.txt', before_bytes: 64 * 1024 * 1024, after_bytes: 64 * 1024 * 1024, review }
  assert.equal(decodeLocalApproval(value).review?.digest, review.digest)
  assert.throws(() => decodeLocalApproval({ ...value, review: { ...review, version: 2 } }))
  assert.throws(() => decodeLocalApproval({ ...value, review: undefined }))
  assert.throws(() => decodeLocalApproval({ ...value, after: 'unexpected body' }))
})
