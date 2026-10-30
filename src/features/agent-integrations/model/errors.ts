import { IntegrationOperationError } from './nativeOperation'
const connectionErrors: Record<string, string> = {
  INTEGRATION_DEPENDENCY_NOT_READY: 'mcpPreparation.notReady',
  INTEGRATION_CONNECT_TIMEOUT: 'extensions.connectTimeout',
  INTEGRATION_INITIALIZATION_EXITED: 'extensions.initializationExited',
  INTEGRATION_PROCESS_START_FAILED: 'extensions.processStartFailed',
  INTEGRATION_EXECUTABLE_NOT_FOUND: 'mcpPreparation.errors.executable',
  INTEGRATION_CONNECTION_REFUSED: 'mcpPreparation.errors.refused',
  INTEGRATION_DNS_FAILED: 'mcpPreparation.errors.dns',
  INTEGRATION_TLS_FAILED: 'mcpPreparation.errors.tls',
  INTEGRATION_AUTH_REQUIRED: 'extensions.loginRequired',
  INTEGRATION_PROCESS_UNCONFIRMED: 'mcpPreparation.errors.unconfirmed',
  INTEGRATION_REQUEST_FAILED: 'extensions.failed',
  INTEGRATION_CANCELLED: 'mcpPreparation.errors.cancelled',
}

export function integrationFailure(error: unknown, t: (key: string) => string): string {
  if (error instanceof IntegrationOperationError) {
    const value = error.diagnostic
    return [connectionErrors[value.code] ? t(connectionErrors[value.code]) : value.message, value.phase, value.exit_code == null ? '' : `Exit ${value.exit_code}`, value.detail ?? ''].filter(Boolean).join(' · ')
  }
  if (!(error instanceof Error)) return t('extensions.failed')
  // Electron invoke 会在异常前附加方法名；仅匹配结尾的已知代码，不展示外部进程输出。
  const code = error.message.match(/(?:^|: )(INTEGRATION_[A-Z_]+)$/u)?.[1]
  return code && connectionErrors[code] ? t(connectionErrors[code]) : error.message
}
