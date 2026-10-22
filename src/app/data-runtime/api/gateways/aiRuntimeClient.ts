import type { AIRuntimeGateway, AIRuntimeStatus, AIRuntimeTask, AIServiceStatus } from '#entities/ai-runtime'
import { TermousApiTransport } from '#shared/api'

const path = '/api/v1/ai-service/runtime'

export class AIRuntimeClient extends TermousApiTransport implements AIRuntimeGateway {
  serviceStatus(signal?: AbortSignal) {
    return this.request<AIServiceStatus>('/api/v1/ai-service/status', { signal })
  }
  async warmup(): Promise<void> {
    await this.request<AIServiceStatus>('/api/v1/ai-service/warmup', { method: 'POST' })
  }
  async status(signal?: AbortSignal): Promise<AIRuntimeStatus> {
    const [runtime, service] = await Promise.all([
      this.request<Omit<AIRuntimeStatus, 'service'>>(path, { signal }),
      this.serviceStatus(signal),
    ])
    return { ...runtime, service }
  }
  download() { return this.request<AIRuntimeTask>(`${path}/gpu/download`, { method: 'POST' }) }
  cancel(id: string) { return this.request<void>(`${path}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  check() { return this.request<AIRuntimeTask>(`${path}/gpu/check`, { method: 'POST' }) }
}
