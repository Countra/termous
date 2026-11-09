import type { AppConfig, WorkflowFileErrorDetails } from '#common/contracts'
import { ExchangeFailure } from './files.ts'

export class ExchangeCore {
  private readonly config: AppConfig
  constructor(config: AppConfig) { this.config = config }
  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(`/api/v1/desktop-workflows/${path}`, this.config.apiBaseUrl), {
      ...init, headers: { ...init.headers, 'X-Termous-Token': this.config.apiToken },
    })
    if (!response.ok) {
      const value = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string; details?: WorkflowFileErrorDetails } } | undefined
      throw new ExchangeFailure(value?.error?.code ?? 'workflow_exchange_request_failed', response.status, value?.error?.message, value?.error?.details)
    }
    return response
  }
  async release(kind: 'imports' | 'exports', id: string) {
    await this.request(`${kind}/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(10_000) })
  }
}
