import assert from 'node:assert/strict'
import test from 'node:test'
import { agentDetachedCommands, canTransferAgentDetachedFiles, isAgentDetachedBinary, isAgentDetachedCommand, isAgentDetachedNoArgumentCommand } from './agent-detached.ts'

test('无参数命令仍严格拒绝外部传入的多余参数，可选参数命令保留参数', () => {
  for (const name of agentDetachedCommands.filter(isAgentDetachedNoArgumentCommand)) {
    assert(isAgentDetachedCommand({ name, args: [] }), name)
    assert(!isAgentDetachedCommand({ name, args: [{ type: 'click' }] }), name)
  }
  assert(!isAgentDetachedNoArgumentCommand('workspace.onCreateSession'))
  assert(!isAgentDetachedNoArgumentCommand('archive.onSelect'))
})

test('助手命令只接受已声明的能力与参数', () => {
  assert(isAgentDetachedCommand({ name: 'workspace.onSend', args: ['hello', ['attachment-1']] }))
  assert(!isAgentDetachedCommand({ name: 'gateway.deleteEverything', args: [] }))
  assert(!isAgentDetachedCommand({ name: 'workspace.onDeleteSession', args: [] }))
  assert(!isAgentDetachedCommand({ name: 'workspace.onReplaceResourceBinding', args: [{ kind: 'unknown' }] }))
  assert(!isAgentDetachedCommand({ name: 'workspace.onDraftChange', args: ['hello'], inputSequence: -1 }))
})

test('二进制接收有独立数量和大小边界', () => {
  const file = { name: 'fixture.txt', type: 'text/plain', lastModified: 1, bytes: new ArrayBuffer(4) }
  assert(isAgentDetachedBinary({ kind: 'attach', owner: 'new:draft', files: [file] }))
  assert(!isAgentDetachedBinary({ kind: 'attach', owner: 'new:draft', files: Array(9).fill(file) }))
  assert(!isAgentDetachedBinary({ kind: 'attach', owner: 'new:draft', files: [{ ...file, bytes: new ArrayBuffer(10 * 1024 * 1024 + 1) }] }))
})

test('发送前文件校验与二进制接收边界一致，包括空文件和非法元数据', () => {
  const base = { name: 'fixture.txt', type: 'text/plain', lastModified: 1, size: 4 }
  for (const file of [base, { ...base, size: 0 }, { ...base, name: '' }, { ...base, name: 'a'.repeat(257) },
    { ...base, type: 'a'.repeat(101) }, { ...base, lastModified: NaN }]) {
    assert.equal(canTransferAgentDetachedFiles([file]), isAgentDetachedBinary({
      kind: 'attach', owner: 'new:draft', files: [{ ...file, bytes: new ArrayBuffer(file.size) }],
    }))
  }
  assert(!canTransferAgentDetachedFiles([]))
})
