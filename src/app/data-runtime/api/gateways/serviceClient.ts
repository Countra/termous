import type { AppConfig } from '#common/contracts';
import type { SystemServiceAction, SystemServiceCapability, SystemServiceDetail, SystemServiceListResult, SystemServiceLogQuery, SystemServiceLogsResult, SystemServiceOperation, SystemServiceQuery, SystemServiceSummary } from '#entities/service';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class ServiceClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

sessionServiceCapability(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<SystemServiceCapability>(`/api/v1/sessions/${encodeURIComponent(id)}/services/capability`, {
      signal: options.signal,
      timeoutMs: 12_000,
    }).then(normalizeSystemServiceCapability)
  }

sessionServices(id: string, query: SystemServiceQuery = {}, options: Pick<RequestOptions, 'signal'> = {}) {
    const params = new URLSearchParams()
    if (query.query?.trim()) {
      params.set('query', query.query.trim())
    }
    if (query.runtime_state) {
      params.set('runtime_state', query.runtime_state)
    }
    if (query.unit_file_state?.trim()) {
      params.set('unit_file_state', query.unit_file_state.trim())
    }
    if (query.sort) {
      params.set('sort', query.sort)
    }
    if (query.order) {
      params.set('order', query.order)
    }
    if (query.limit) {
      params.set('limit', String(query.limit))
    }
    const search = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<SystemServiceListResult>(`/api/v1/sessions/${encodeURIComponent(id)}/services${search}`, {
      signal: options.signal,
      timeoutMs: 20_000,
    }).then(normalizeSystemServiceListResult)
  }

sessionServiceDetail(id: string, unitId: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<SystemServiceDetail>(
      `/api/v1/sessions/${encodeURIComponent(id)}/services/${encodeURIComponent(unitId)}`,
      { signal: options.signal, timeoutMs: 12_000 },
    ).then(normalizeSystemServiceDetail)
  }

sessionServiceLogs(
    id: string,
    unitId: string,
    query: SystemServiceLogQuery = {},
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    const params = new URLSearchParams()
    if (query.limit) {
      params.set('limit', String(query.limit))
    }
    if (query.priority?.trim()) {
      params.set('priority', query.priority.trim())
    }
    if (query.boot) {
      params.set('boot', query.boot)
    }
    if (query.after_cursor?.trim()) {
      params.set('after_cursor', query.after_cursor.trim())
    }
    const search = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<SystemServiceLogsResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/services/${encodeURIComponent(unitId)}/logs${search}`,
      { signal: options.signal, timeoutMs: 15_000 },
    ).then(normalizeSystemServiceLogsResult)
  }

runSessionServiceAction(
    id: string,
    unitId: string,
    action: SystemServiceAction,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<SystemServiceOperation>(
      `/api/v1/sessions/${encodeURIComponent(id)}/services/${encodeURIComponent(unitId)}/actions`,
      { method: 'POST', body: { action }, signal: options.signal, timeoutMs: 15_000 },
    ).then(normalizeSystemServiceOperation)
  }

sessionServiceOperation(id: string, operationId: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<SystemServiceOperation>(
      `/api/v1/sessions/${encodeURIComponent(id)}/service-operations/${encodeURIComponent(operationId)}`,
      { signal: options.signal, timeoutMs: 12_000 },
    ).then(normalizeSystemServiceOperation)
  }
}

function normalizeSystemServiceCapability(capability: SystemServiceCapability): SystemServiceCapability {
  return {
    ...capability,
    warnings: normalizeArray(capability.warnings),
  }
}

function normalizeSystemServiceListResult(result: SystemServiceListResult): SystemServiceListResult {
  return {
    ...result,
    items: normalizeArray(result.items).map(normalizeSystemServiceSummary),
    warnings: normalizeArray(result.warnings),
  }
}

function normalizeSystemServiceDetail(detail: SystemServiceDetail): SystemServiceDetail {
  return {
    ...detail,
    summary: normalizeSystemServiceSummary(detail.summary),
    drop_in_paths: normalizeArray(detail.drop_in_paths),
    warnings: normalizeArray(detail.warnings),
  }
}

function normalizeSystemServiceLogsResult(result: SystemServiceLogsResult): SystemServiceLogsResult {
  return {
    ...result,
    entries: normalizeArray(result.entries),
    warnings: normalizeArray(result.warnings),
  }
}

function normalizeSystemServiceOperation(operation: SystemServiceOperation): SystemServiceOperation {
  return {
    ...operation,
    state: operation.state ? normalizeSystemServiceSummary(operation.state) : undefined,
  }
}

function normalizeSystemServiceSummary(summary: SystemServiceSummary): SystemServiceSummary {
  return {
    ...summary,
    names: normalizeArray(summary.names),
  }
}
