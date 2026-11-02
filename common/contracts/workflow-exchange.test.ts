import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkflowFileRequest } from './workflow-exchange.ts'
import { isWorkflowDetachedCommand, isWorkflowDetachedMedia } from './workflow-detached.ts'

test('原生文件请求只允许窄合同，不接受路径、令牌及伪造窗口字段', () => {
  const input = { kind: 'import', operation_id: 'request' }
  assert(isWorkflowFileRequest(input))
  for (const extra of [{ path: 'C:/private' }, { token: 'token' }, { window_id: 7 }, { origin: { module: 'desktop-workflow', instance: 'workspace', generation: '' } }]) assert(!isWorkflowFileRequest({ ...input, ...extra }))
  assert(isWorkflowFileRequest({ operation_id: 'request', kind: 'export', script_id: 'script', version: 1, layout: 'directory' }))
  assert(!isWorkflowFileRequest({ operation_id: 'request', kind: 'export', script_id: 'script', version: 0, layout: 'zip' }))
})
test('双窗口交换动作与预览图片读取必须符合白名单', () => {
  for (const command of [{ kind: 'import' }, { kind: 'commit' }, { kind: 'target', id: 'script' }, { kind: 'export', layout: 'zip', version: 2 }]) assert(isWorkflowDetachedCommand({ name: 'exchange', args: [command] }))
  assert(!isWorkflowDetachedCommand({ name: 'exchange', args: [{ kind: 'commit', definition: {} }] }))
  assert(!isWorkflowDetachedCommand({ name: 'exchange', args: [{ kind: 'export', layout: 'directory', version: -1 }] }))
  assert(isWorkflowDetachedMedia({ kind: 'import-asset', id: 'import', hash: 'a'.repeat(64) }))
  assert(!isWorkflowDetachedMedia({ kind: 'import-asset', id: 'import', hash: '../../file' }))
})
