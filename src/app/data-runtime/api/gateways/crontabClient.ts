import type { AppConfig } from '#common/contracts'
import type {
  CrontabCapability,
  CrontabContentInput,
  CrontabJob,
  CrontabJobInput,
  CrontabSnapshot,
} from '#entities/crontab'
import { TermousApiTransport } from '#shared/api'
import { normalizeArray } from './responseNormalizers'

interface RequestOptions {
  signal?: AbortSignal
}

const CRONTAB_READ_TIMEOUT_MS = 30_000
const CRONTAB_WRITE_TIMEOUT_MS = 45_000

export class CrontabClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  sessionCrontabCapability(
    id: string,
    options: RequestOptions = {},
  ) {
    return this.request<CrontabCapability>(
      `/api/v1/sessions/${encodeURIComponent(id)}/crontab/capability`,
      { signal: options.signal, timeoutMs: 12_000 },
    ).then(normalizeCrontabCapability)
  }

  sessionCrontab(id: string, options: RequestOptions = {}) {
    return this.request<CrontabSnapshot>(
      `/api/v1/sessions/${encodeURIComponent(id)}/crontab`,
      { signal: options.signal, timeoutMs: CRONTAB_READ_TIMEOUT_MS },
    ).then(normalizeCrontabSnapshot)
  }

  sessionCrontabSource(id: string, options: RequestOptions = {}) {
    return this.request<CrontabSnapshot>(
      `/api/v1/sessions/${encodeURIComponent(id)}/crontab?include_content=true`,
      { signal: options.signal, timeoutMs: CRONTAB_READ_TIMEOUT_MS },
    ).then(normalizeCrontabSnapshot)
  }

  replaceSessionCrontab(
    id: string,
    input: CrontabContentInput,
    options: RequestOptions = {},
  ) {
    return this.request<CrontabSnapshot>(
      `/api/v1/sessions/${encodeURIComponent(id)}/crontab`,
      {
        method: 'PUT',
        body: input,
        signal: options.signal,
        timeoutMs: CRONTAB_WRITE_TIMEOUT_MS,
      },
    ).then(normalizeCrontabSnapshot)
  }

  createSessionCrontabJob(
    id: string,
    input: CrontabJobInput,
    options: RequestOptions = {},
  ) {
    return this.request<CrontabSnapshot>(
      `/api/v1/sessions/${encodeURIComponent(id)}/crontab/jobs`,
      {
        method: 'POST',
        body: input,
        signal: options.signal,
        timeoutMs: CRONTAB_WRITE_TIMEOUT_MS,
      },
    ).then(normalizeCrontabSnapshot)
  }

  updateSessionCrontabJob(
    id: string,
    jobId: string,
    input: CrontabJobInput,
    options: RequestOptions = {},
  ) {
    return this.request<CrontabSnapshot>(
      `/api/v1/sessions/${encodeURIComponent(id)}/crontab/jobs/${encodeURIComponent(jobId)}`,
      {
        method: 'PATCH',
        body: input,
        signal: options.signal,
        timeoutMs: CRONTAB_WRITE_TIMEOUT_MS,
      },
    ).then(normalizeCrontabSnapshot)
  }

  deleteSessionCrontabJob(
    id: string,
    jobId: string,
    expectedRevision: string,
    options: RequestOptions = {},
  ) {
    return this.request<CrontabSnapshot>(
      `/api/v1/sessions/${encodeURIComponent(id)}/crontab/jobs/${encodeURIComponent(jobId)}`,
      {
        method: 'DELETE',
        body: { expected_revision: expectedRevision },
        signal: options.signal,
        timeoutMs: CRONTAB_WRITE_TIMEOUT_MS,
      },
    ).then(normalizeCrontabSnapshot)
  }
}

function normalizeCrontabCapability(capability: CrontabCapability): CrontabCapability {
  return {
    ...capability,
    warnings: normalizeArray(capability.warnings),
  }
}

function normalizeCrontabSnapshot(snapshot: CrontabSnapshot): CrontabSnapshot {
  return {
    ...snapshot,
    jobs: normalizeArray(snapshot.jobs).map(normalizeCrontabJob),
    warnings: normalizeArray(snapshot.warnings),
  }
}

function normalizeCrontabJob(job: CrontabJob): CrontabJob {
  return {
    ...job,
    warnings: normalizeArray(job.warnings),
  }
}
