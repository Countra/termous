import type {
  RemoteProcessDetail,
  RemoteProcessListResult,
  RemoteProcessQuery,
  RemoteProcessTerminateResult,
  RemoteProcessTerminateSignal,
} from '#entities/observability'

interface ObservabilityRequestOptions {
  signal?: AbortSignal
}

export interface ObservabilityGateway {
  sessionMonitorUrl(sessionId: string): string
  sessionProcesses(
    sessionId: string,
    query?: RemoteProcessQuery,
    options?: ObservabilityRequestOptions,
  ): Promise<RemoteProcessListResult>
  sessionProcessDetail(
    sessionId: string,
    pid: number,
    options?: ObservabilityRequestOptions,
  ): Promise<RemoteProcessDetail>
  terminateSessionProcess(
    sessionId: string,
    pid: number,
    signal?: RemoteProcessTerminateSignal,
    options?: ObservabilityRequestOptions,
  ): Promise<RemoteProcessTerminateResult>
}

export interface ObservabilitySessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
  inventory_status?: string
  inventory_message?: string
  linux_system_info?: {
    cpu_cores?: number
    cpu_frequency_mhz?: number
  }
}
