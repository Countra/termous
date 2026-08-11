import type {
  CrontabCapability,
  CrontabContentInput,
  CrontabJobInput,
  CrontabSnapshot,
} from '#entities/crontab'

interface CrontabRequestOptions {
  signal?: AbortSignal
}

export interface CrontabGateway {
  sessionCrontabCapability(
    sessionId: string,
    options?: CrontabRequestOptions,
  ): Promise<CrontabCapability>
  sessionCrontab(
    sessionId: string,
    options?: CrontabRequestOptions,
  ): Promise<CrontabSnapshot>
  sessionCrontabSource(
    sessionId: string,
    options?: CrontabRequestOptions,
  ): Promise<CrontabSnapshot>
  replaceSessionCrontab(
    sessionId: string,
    input: CrontabContentInput,
    options?: CrontabRequestOptions,
  ): Promise<CrontabSnapshot>
  createSessionCrontabJob(
    sessionId: string,
    input: CrontabJobInput,
    options?: CrontabRequestOptions,
  ): Promise<CrontabSnapshot>
  updateSessionCrontabJob(
    sessionId: string,
    jobId: string,
    input: CrontabJobInput,
    options?: CrontabRequestOptions,
  ): Promise<CrontabSnapshot>
  deleteSessionCrontabJob(
    sessionId: string,
    jobId: string,
    expectedRevision: string,
    options?: CrontabRequestOptions,
  ): Promise<CrontabSnapshot>
}

export interface CrontabSessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
}
