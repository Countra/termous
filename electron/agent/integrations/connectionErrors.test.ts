import assert from 'node:assert/strict'
import test from 'node:test'
import { McpConnectionClosedError, McpTimeoutError } from '@earendil-works/pi-mcp'
import { integrationConnectionError } from './connectionErrors.ts'

test('连接错误区分超时、进程失败和主动取消，不转发原始诊断', () => {
  const active = new AbortController().signal
  const code = (error: unknown, signal = active, stdio = true) => {
    const result = integrationConnectionError(error, signal, stdio)
    assert.ok(result instanceof Error)
    return result.message
  }
  assert.equal(code(new McpTimeoutError(15000)), 'INTEGRATION_CONNECT_TIMEOUT')
  assert.equal(code(new Error('closed'), AbortSignal.abort(new DOMException('deadline', 'TimeoutError'))), 'INTEGRATION_CONNECT_TIMEOUT')
  assert.equal(code(new McpConnectionClosedError('private output')), 'INTEGRATION_INITIALIZATION_EXITED')
  for (const errno of ['ENOENT', 'EACCES', 'EPERM']) {
    assert.equal(code(Object.assign(new Error('private path'), {code: errno})), 'INTEGRATION_PROCESS_START_FAILED')
  }
  const cancelled = new DOMException('cancelled', 'AbortError')
  assert.equal(integrationConnectionError(new McpTimeoutError(15000), AbortSignal.abort(cancelled), true), cancelled)
  const remote = new Error('server reported ENOENT or timeout')
  assert.equal(integrationConnectionError(remote, active, true), remote)
  const lost = new McpConnectionClosedError()
  assert.equal(integrationConnectionError(lost, active, false), lost)
})
