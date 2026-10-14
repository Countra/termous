import type { AppConfig } from '#common/contracts';
import type { CoreRuntimeInfo, StorageStatus } from "../../model/runtimeTypes";
import { TermousApiTransport } from '#shared/api';

export class RuntimeClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  storageStatus(signal?: AbortSignal) {
    return this.request<StorageStatus>('/api/v1/storage/status', { signal })
  }

  health() {
    return this.request<{ status: string }>('/api/v1/healthz')
  }

runtime() {
    return this.request<CoreRuntimeInfo>('/api/v1/runtime')
  }

heartbeat() {
    return this.request<{ status: string; server_time: string; shutdown_in_progress: boolean }>('/api/v1/runtime/heartbeat', {
      method: 'POST',
    })
  }

shutdown(reason = 'frontend_exit') {
    return this.request<{ status: string }>('/api/v1/runtime/shutdown', {
      method: 'POST',
      body: { reason },
    })
  }
}
