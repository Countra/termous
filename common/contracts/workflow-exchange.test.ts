import assert from 'node:assert/strict'
import test from 'node:test'
import { isWorkflowFileRequest, isWorkflowExportLocationRequest } from './workflow-exchange.ts'
import { isWorkflowDetachedCommand, isWorkflowDetachedMedia } from './workflow-detached.ts'

test('原生文件请求只允许窄合同，不接受路径、令牌及伪造窗口字段', () => {
  const input = { kind: 'import', operation_id: 'request' }
  assert(isWorkflowFileRequest(input))
  for (const extra of [{ path: 'C:/private' }, { token: 'token' }, { window_id: 7 }, { origin: { module: 'desktop-workflow', instance: 'workspace', generation: '' } }]) assert(!isWorkflowFileRequest({ ...input, ...extra }))
  assert(isWorkflowFileRequest({ operation_id: 'request', kind: 'export', script_id: 'script', version: 1, layout: 'directory' }))
  assert(!isWorkflowFileRequest({ operation_id: 'request', kind: 'export', script_id: 'script', version: 0, layout: 'zip' }))
})
test('双窗口交换动作与预览图片读取必须符合白名单', () => {
  for (const command of [{ kind: 'import' }, { kind: 'commit' }, { kind: 'open-directory', location_id: 'location' }, { kind: 'target', id: 'script' }, { kind: 'export', layout: 'zip', version: 2 }]) assert(isWorkflowDetachedCommand({ name: 'exchange', args: [command] }))
  assert(!isWorkflowDetachedCommand({ name: 'exchange', args: [{ kind: 'commit', definition: {} }] }))
  for (const value of [{ kind: 'open-directory' }, { kind: 'open-directory', location_id: '../folder' }, { kind: 'open-directory', location_id: 'location', path: 'C:/private' }]) assert(!isWorkflowDetachedCommand({ name: 'exchange', args: [value] }))
  assert(!isWorkflowDetachedCommand({ name: 'exchange', args: [{ kind: 'export', layout: 'directory', version: -1 }] }))
  assert(isWorkflowDetachedMedia({ kind: 'import-asset', id: 'import', hash: 'a'.repeat(64) }))
  assert(!isWorkflowDetachedMedia({ kind: 'import-asset', id: 'import', hash: '../../file' }))
})

test('打开目录只接受导出位置标识与有效窗口归属，不允许提交路径', () => {
  const request = { location_id: 'export-location', origin: { module: 'desktop-workflow', instance: 'workspace', generation: 'current' } }
  assert(isWorkflowExportLocationRequest(request))
  assert(isWorkflowExportLocationRequest({ location_id: 'export-location' }))
  for (const value of [{ ...request, path: 'C:/private' }, { ...request, location_id: '../folder' }, { ...request, origin: { ...request.origin, generation: '' } }, {}, [], null]) assert(!isWorkflowExportLocationRequest(value))
})
