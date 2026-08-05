import type { AppConfig } from '#common/contracts'

const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: import.meta.env.VITE_TERMOUS_API_BASE_URL ?? 'http://127.0.0.1:8122',
  apiToken: import.meta.env.VITE_TERMOUS_API_TOKEN ?? (import.meta.env.DEV ? 'dev-token' : ''),
  version: import.meta.env.VITE_TERMOUS_APP_VERSION ?? '0.0.0-dev',
}

interface ApiErrorBody {
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class TermousApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'TermousApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class TermousApiTransport {
  protected config: AppConfig

  constructor(config: Partial<AppConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  updateConfig(config: Partial<AppConfig>) {
    this.config = { ...this.config, ...config }
  }

  websocketUrl(path: string) {
    const base = new URL(this.config.apiBaseUrl)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    base.pathname = path
    base.search = ''
    if (this.config.apiToken) {
      base.searchParams.set('token', this.config.apiToken)
    }
    return base.toString()
  }

  protected async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs ?? 12_000)
    const abortByCaller = () => controller.abort()
    if (options.signal?.aborted) {
      controller.abort()
    } else {
      options.signal?.addEventListener('abort', abortByCaller, { once: true })
    }
    const isFormData = options.body instanceof FormData
    let requestBody: BodyInit | undefined
    if (options.body instanceof FormData) {
      requestBody = options.body
    } else if (options.body !== undefined) {
      requestBody = JSON.stringify(options.body)
    }
    try {
      const response = await fetch(new URL(path, this.config.apiBaseUrl), {
        method: options.method ?? 'GET',
        headers: {
          ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
          ...(this.config.apiToken ? { 'X-Termous-Token': this.config.apiToken } : {}),
        },
        body: requestBody,
        signal: controller.signal,
      })
      if (!response.ok) {
        throw await this.toError(response)
      }
      if (response.status === 204) {
        return undefined as T
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof TermousApiError) {
        throw error
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (!timedOut) {
          throw new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0)
        }
        throw new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0)
      }
      throw new TermousApiError(error instanceof Error ? error.message : '本地 API 不可用', 'NETWORK_ERROR', 0)
    } finally {
      window.clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortByCaller)
    }
  }

  protected async requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, options.timeoutMs ?? 12_000)
    const abortByCaller = () => controller.abort()
    if (options.signal?.aborted) {
      controller.abort()
    } else {
      options.signal?.addEventListener('abort', abortByCaller, { once: true })
    }
    try {
      const response = await fetch(new URL(path, this.config.apiBaseUrl), {
        method: options.method ?? 'GET',
        headers: {
          ...(this.config.apiToken ? { 'X-Termous-Token': this.config.apiToken } : {}),
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw await this.toError(response)
      }
      return response.blob()
    } catch (error) {
      if (error instanceof TermousApiError) {
        throw error
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (!timedOut) {
          throw new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0)
        }
        throw new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0)
      }
      throw new TermousApiError(error instanceof Error ? error.message : '本地 API 不可用', 'NETWORK_ERROR', 0)
    } finally {
      window.clearTimeout(timeout)
      options.signal?.removeEventListener('abort', abortByCaller)
    }
  }

  private async toError(response: Response) {
    let body: ApiErrorBody
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      body = {}
    }
    return new TermousApiError(
      body.error?.message ?? `请求失败：${response.status}`,
      body.error?.code ?? 'HTTP_ERROR',
      response.status,
      body.error?.details,
    )
  }
}
