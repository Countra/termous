import { McpConnectionClosedError, McpTimeoutError } from '@earendil-works/pi-mcp'

export function integrationConnectionError(error: unknown, signal: AbortSignal, stdio: boolean): unknown {
  // 只按本地异常类型分类，不把 stderr、远端错误正文或凭据写入公开提示。
  if (signal.aborted) {
    return signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? new Error('INTEGRATION_CONNECT_TIMEOUT') : signal.reason
  }
  if (error instanceof McpTimeoutError) return new Error('INTEGRATION_CONNECT_TIMEOUT')
  if (stdio && error instanceof McpConnectionClosedError) return new Error('INTEGRATION_INITIALIZATION_EXITED')
  if (stdio && error instanceof Error && 'code' in error && ['ENOENT', 'EACCES', 'EPERM'].includes(String(error.code))) {
    return new Error('INTEGRATION_PROCESS_START_FAILED')
  }
  return error
}
