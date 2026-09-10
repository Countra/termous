import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalizeMcpFileToolName } from './mcp-file-tools.ts'

test('文件工具历史兼容仅匹配明确旧名，不接受猜测工具或修改新名称', () => {
  for (const [oldName, newName] of [
    ['termous.sftp.sessions.connect', 'termous.files.sessions.connect'],
    ['termous.sftp.files.read_text', 'termous.files.read_text'],
    ['termous.sftp.files.batch_rename.presets.list', 'termous.files.batch_rename.presets.list'],
    ['termous.sftp.files.name_search.capability', 'termous.files.name_search.capability'],
    ['termous.sftp.files.delete.cancel', 'termous.files.delete.cancel'],
    ['termous.sftp.transfers.remote_copy', 'termous.files.transfers.remote_copy'],
  ]) {
    assert.equal(canonicalizeMcpFileToolName(oldName!), newName)
    assert.equal(canonicalizeMcpFileToolName(newName!), newName)
  }
  for (const name of ['termous.hosts.list', 'read_skill_resource', '', '__proto__',
    'termous.sftp.files.local_browse', 'termous.sftp.files.delete.start.extra', 'termous.sftp.files.rename ']) {
    assert.equal(canonicalizeMcpFileToolName(name), name)
  }
})
