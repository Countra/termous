import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeMcpApproval } from './approval.ts'

function decode(operation: Record<string, unknown>, state = 'pending') {
  return decodeMcpApproval({ id: 'approval', revision: 1, client_id: 'client', client_name: 'Agent', client_request_id: 'request', kind: 'desktop_workflow', state, created_at: 'now', updated_at: 'now', expires_at: 'later', operation: { domain: 'desktop_workflow', ...operation } })
}
test('配置导入和模板导出不伪造脚本版本，运行和删除仍严格校验', () => {
  assert.deepEqual(decode({ action: 'import', local_paths: ['D:/工作流.json'] }).operation?.local_paths, ['D:/工作流.json'])
  assert.equal(decode({ action: 'export_template', resource_id: 'template', local_target: 'D:/图片.png', mode: 'png', overwrite_policy: 'skip' }).operation?.script_id, undefined)
  assert.equal(decode({ action: 'export', script_id: 'script', script_version: 2, local_target: 'D:/导出', mode: 'directory', overwrite_policy: 'skip' }).operation?.script_version, 2)
  for (const operation of [
    { action: 'run' }, { action: 'delete' }, { action: 'import', local_paths: [] },
    { action: 'export', script_id: 'script', script_version: 0, local_target: 'D:/out', mode: 'zip', overwrite_policy: 'skip' },
    { action: 'export_template', local_target: 'D:/out.png', mode: 'png', overwrite_policy: 'skip' },
    { action: 'export', script_id: 'script', script_version: 2, local_target: 'D:/out', mode: 'directory', overwrite_policy: 'overwrite' },
  ]) assert.throws(() => decode(operation))
})

test('交换审批终态允许后端清理文件路径，待批准和派发中仍要求完整范围', () => {
  for (const operation of [
    { action: 'import' },
    { action: 'export', script_id: 'script', script_version: 2, mode: 'zip', overwrite_policy: 'skip' },
    { action: 'export_template', resource_id: 'template', mode: 'png', overwrite_policy: 'overwrite' },
  ]) {
    for (const state of ['approved', 'rejected', 'cancelled', 'expired', 'dispatch_conflict']) {
      const result = decode(operation, state).operation!
      assert.deepEqual(result.local_paths, [])
      assert.equal(result.local_target, undefined)
    }
    for (const state of ['pending', 'dispatching']) assert.throws(() => decode(operation, state))
  }
})

test('交换审批拒绝混入其他动作的目标或远端执行字段', () => {
  const importing = { action: 'import', local_paths: ['D:/workflow.json'] }
  const exporting = { action: 'export', script_id: 'script', script_version: 1, local_target: 'D:/out.zip', mode: 'zip', overwrite_policy: 'skip' }
  for (const operation of [
    { ...importing, script_id: 'hidden-target' }, { ...importing, mode: 'update' },
    { ...importing, command: 'hidden-command' }, { ...importing, remote_paths: ['/hidden'] },
    { ...exporting, local_paths: ['D:/hidden.json'] }, { ...exporting, resource_id: 'hidden-template' },
  ]) assert.throws(() => decode(operation))
})
