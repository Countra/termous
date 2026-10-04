import type { AppConfig, RemoteResult } from '#common/contracts'

export class RemoteCoreError extends Error {
  readonly code: string
  readonly uncertain: boolean
  constructor(code: string, uncertain = false) { super(code); this.code = code; this.uncertain = uncertain }
}

// 主进程保留本机凭据，只允许调用方构造固定远控路由。
export class RemoteCore {
  readonly config: () => Promise<AppConfig>
  constructor(config: () => Promise<AppConfig>) { this.config = config }

  async request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const config = await this.config()
    try {
      const response = await fetch(new URL(`/api/v1${path}`, config.apiBaseUrl), {
        method, redirect: 'error', signal: AbortSignal.timeout(35_000),
        headers: { 'Content-Type': 'application/json', 'X-Termous-Token': config.apiToken },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (response.status === 204) return undefined as T
      const data = await response.json()
      if (!response.ok) {
        const code = data?.error?.code
        throw new RemoteCoreError(typeof code === 'string' ? code.toLowerCase() : 'remote_operation_failed', data?.error?.details?.uncertain === true)
      }
      return data as T
    } catch (error) {
      if (error instanceof RemoteCoreError) throw error
      // 本机 HTTP 回执也可能在执行后丢失；保持结果不明，且不向界面泄漏底层异常。
      throw new RemoteCoreError('remote_request_failed', !['GET', 'HEAD'].includes(method))
    }
  }
}

export async function result<T>(operation: () => Promise<T>): Promise<RemoteResult<T>> {
  try { return { ok: true, value: await operation() } } catch (error) {
    return { ok: false, code: error instanceof RemoteCoreError ? error.code : 'remote_operation_failed', uncertain: error instanceof RemoteCoreError ? error.uncertain : undefined }
  }
}

export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}
