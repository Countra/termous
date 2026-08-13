import type { AppConfig } from '#common/contracts';
import type { RemoteProcessDetail, RemoteProcessListResult, RemoteProcessQuery, RemoteProcessTerminateResult, RemoteProcessTerminateSignal } from '#entities/observability';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class ObservabilityClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

sessionMonitorUrl(id: string) {
    return this.websocketUrl(`/api/v1/sessions/${encodeURIComponent(id)}/monitor`)
  }

sessionProcesses(id: string, query: RemoteProcessQuery = {}, options: Pick<RequestOptions, 'signal'> = {}) {
    const params = new URLSearchParams()
    if (query.query?.trim()) {
      params.set('query', query.query.trim())
    }
    if (query.pid) {
      params.set('pid', String(query.pid))
    }
    if (query.port) {
      params.set('port', String(query.port))
    }
    if (query.sort) {
      params.set('sort', query.sort)
    }
    if (query.limit) {
      params.set('limit', String(query.limit))
    }
    const search = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<RemoteProcessListResult>(`/api/v1/sessions/${encodeURIComponent(id)}/processes${search}`, {
      signal: options.signal,
      timeoutMs: 20_000,
    }).then(normalizeRemoteProcessListResult)
  }

sessionProcessDetail(id: string, pid: number, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<RemoteProcessDetail>(`/api/v1/sessions/${encodeURIComponent(id)}/processes/${encodeURIComponent(pid)}`, {
      signal: options.signal,
      timeoutMs: 20_000,
    }).then(normalizeRemoteProcessDetail)
  }

terminateSessionProcess(
    id: string,
    pid: number,
    signal: RemoteProcessTerminateSignal = 'term',
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<RemoteProcessTerminateResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/processes/${encodeURIComponent(pid)}/terminate`,
      {
        method: 'POST',
        body: { signal },
        signal: options.signal,
        timeoutMs: 20_000,
      },
    )
  }
}

function normalizeRemoteProcessListResult(result: RemoteProcessListResult): RemoteProcessListResult {
  return {
    ...result,
    items: normalizeArray(result.items).map((item) => ({
      ...item,
      listening_ports: normalizeArray(item.listening_ports),
      warnings: normalizeArray(item.warnings),
    })),
    ports: normalizeArray(result.ports),
    warnings: normalizeArray(result.warnings),
  }
}

function normalizeRemoteProcessDetail(detail: RemoteProcessDetail): RemoteProcessDetail {
  return {
    ...detail,
    summary: {
      ...detail.summary,
      listening_ports: normalizeArray(detail.summary.listening_ports),
      warnings: normalizeArray(detail.summary.warnings),
    },
    ports: normalizeArray(detail.ports),
    warnings: normalizeArray(detail.warnings),
  }
}
