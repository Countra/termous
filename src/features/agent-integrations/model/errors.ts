const connectionErrors: Record<string, string> = {
  INTEGRATION_CONNECT_TIMEOUT: 'extensions.connectTimeout',
  INTEGRATION_INITIALIZATION_EXITED: 'extensions.initializationExited',
  INTEGRATION_PROCESS_START_FAILED: 'extensions.processStartFailed',
}

export function integrationFailure(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof Error)) return t('extensions.failed')
  // Electron invoke 会在异常前附加方法名；仅匹配结尾的已知代码，不展示外部进程输出。
  const code = error.message.match(/(?:^|: )(INTEGRATION_[A-Z_]+)$/u)?.[1]
  return code && connectionErrors[code] ? t(connectionErrors[code]) : error.message
}
