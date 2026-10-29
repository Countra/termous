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
