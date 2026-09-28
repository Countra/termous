export interface CoreRuntimeProbe {
  pid?: number
  version?: string
  shutdown_phase?: 'preparing' | 'blocked' | 'closing' | 'closed'
  shutdown_error?: string
}

export async function fetchCoreRuntimeProbe(apiBaseUrl: string, token: string, timeoutMs: number): Promise<CoreRuntimeProbe | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL('/api/v1/runtime', apiBaseUrl), {
      headers: token ? { 'X-Termous-Token': token } : undefined,
      signal: controller.signal,
    })
    if (!response.ok) return null
    // 超时必须覆盖响应体读取，只有响应头而没有完整 JSON 时不能无限阻塞启动。
    const value: unknown = await response.json()
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const runtime = value as Record<string, unknown>
    const pid = Number.isSafeInteger(runtime.pid) && (runtime.pid as number) > 0 ? runtime.pid as number : undefined
    const version = typeof runtime.version === 'string' ? runtime.version.trim() : undefined
    const result: CoreRuntimeProbe = { pid, version: version && version.length <= 64 ? version : undefined }
    if (runtime.shutdown_phase === 'preparing' || runtime.shutdown_phase === 'blocked'
      || runtime.shutdown_phase === 'closing' || runtime.shutdown_phase === 'closed') {
      result.shutdown_phase = runtime.shutdown_phase
    }
    if (typeof runtime.shutdown_error === 'string') result.shutdown_error = runtime.shutdown_error.slice(0, 2048)
    return result
  } finally {
    clearTimeout(timeout)
    // 非成功响应无需读取正文，主动中止以释放可能仍在输出的连接。
    controller.abort()
  }
}
