import type {
  SystemServiceAction,
  SystemServiceCapability,
  SystemServiceDetail,
  SystemServiceListResult,
  SystemServiceLogQuery,
  SystemServiceLogsResult,
  SystemServiceOperation,
  SystemServiceQuery,
} from '#entities/service'

interface ServiceRequestOptions {
  signal?: AbortSignal
}

export interface ServiceGateway {
  sessionServiceCapability(sessionId: string, options?: ServiceRequestOptions): Promise<SystemServiceCapability>
  sessionServices(
    sessionId: string,
    query?: SystemServiceQuery,
    options?: ServiceRequestOptions,
  ): Promise<SystemServiceListResult>
  sessionServiceDetail(
    sessionId: string,
    unitId: string,
    options?: ServiceRequestOptions,
  ): Promise<SystemServiceDetail>
  sessionServiceLogs(
    sessionId: string,
    unitId: string,
    query?: SystemServiceLogQuery,
    options?: ServiceRequestOptions,
  ): Promise<SystemServiceLogsResult>
  runSessionServiceAction(
    sessionId: string,
    unitId: string,
    action: SystemServiceAction,
    options?: ServiceRequestOptions,
  ): Promise<SystemServiceOperation>
  sessionServiceOperation(
    sessionId: string,
    operationId: string,
    options?: ServiceRequestOptions,
  ): Promise<SystemServiceOperation>
}

export interface ServiceSessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
}
