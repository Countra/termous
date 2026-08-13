import type { AppConfig } from '#common/contracts';
import type { DockerActionRequest, DockerActionResult, DockerCapability, DockerContainerDetail, DockerContainerQuery, DockerContainerSummary, DockerContainerStats, DockerListResult, DockerLogsResult } from '#entities/docker';
import { TermousApiTransport } from '#shared/api';
import { normalizeArray } from './responseNormalizers'

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class DockerClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

sessionDockerCapability(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<DockerCapability>(`/api/v1/sessions/${encodeURIComponent(id)}/docker/capability`, {
      signal: options.signal,
      timeoutMs: 12_000,
    }).then(normalizeDockerCapability)
  }

sessionDockerContainers(id: string, query: DockerContainerQuery = {}, options: Pick<RequestOptions, 'signal'> = {}) {
    const params = new URLSearchParams()
    if (query.query?.trim()) {
      params.set('query', query.query.trim())
    }
    if (query.state?.trim()) {
      params.set('state', query.state.trim())
    }
    if (query.health?.trim()) {
      params.set('health', query.health.trim())
    }
    if (query.port) {
      params.set('port', String(query.port))
    }
    if (query.limit) {
      params.set('limit', String(query.limit))
    }
    const search = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<DockerListResult>(`/api/v1/sessions/${encodeURIComponent(id)}/docker/containers${search}`, {
      signal: options.signal,
      timeoutMs: 20_000,
    }).then(normalizeDockerListResult)
  }

sessionDockerContainerDetail(id: string, ref: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<DockerContainerDetail>(
      `/api/v1/sessions/${encodeURIComponent(id)}/docker/containers/${encodeURIComponent(ref)}`,
      {
        signal: options.signal,
        timeoutMs: 25_000,
      },
    ).then(normalizeDockerContainerDetail)
  }

sessionDockerContainerStats(id: string, ref: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<DockerContainerStats>(
      `/api/v1/sessions/${encodeURIComponent(id)}/docker/containers/${encodeURIComponent(ref)}/stats`,
      {
        signal: options.signal,
        timeoutMs: 20_000,
      },
    )
  }

sessionDockerContainerLogs(
    id: string,
    ref: string,
    tail = 200,
    timestamps = true,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    const params = new URLSearchParams({ tail: String(tail), timestamps: String(timestamps) })
    return this.request<DockerLogsResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/docker/containers/${encodeURIComponent(ref)}/logs?${params.toString()}`,
      {
        signal: options.signal,
        timeoutMs: 25_000,
      },
    ).then(normalizeDockerLogsResult)
  }

sessionDockerContainerAction(
    id: string,
    ref: string,
    input: DockerActionRequest,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<DockerActionResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/docker/containers/${encodeURIComponent(ref)}/actions`,
      {
        method: 'POST',
        body: input,
        signal: options.signal,
        timeoutMs: 35_000,
      },
    )
  }
}

function normalizeDockerCapability(capability: DockerCapability): DockerCapability {
  return {
    ...capability,
    warnings: normalizeArray(capability.warnings),
  }
}

function normalizeDockerListResult(result: DockerListResult): DockerListResult {
  return {
    ...result,
    items: normalizeArray(result.items).map(normalizeDockerContainerSummary),
    warnings: normalizeArray(result.warnings),
  }
}

function normalizeDockerContainerDetail(detail: DockerContainerDetail): DockerContainerDetail {
  return {
    ...detail,
    summary: normalizeDockerContainerSummary(detail.summary),
    mounts: normalizeArray(detail.mounts),
    networks: normalizeArray(detail.networks),
    env: normalizeArray(detail.env),
    args: normalizeArray(detail.args),
    logs_preview: normalizeArray(detail.logs_preview),
    warnings: normalizeArray(detail.warnings),
  }
}

function normalizeDockerLogsResult(result: DockerLogsResult): DockerLogsResult {
  return {
    ...result,
    lines: normalizeArray(result.lines),
  }
}

function normalizeDockerContainerSummary(summary: DockerContainerSummary): DockerContainerSummary {
  return {
    ...summary,
    ports: normalizeArray(summary.ports),
    warnings: normalizeArray(summary.warnings),
  }
}
