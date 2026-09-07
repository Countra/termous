import type { AppConfig } from '#common/contracts';
import {
  normalizeCompletionResult,
  normalizeSessionResponse,
  normalizeSessionResponseList,
  type CompletionQuery,
  type CompletionResult,
  type CompletionStatus,
  type LocalShell,
  type Session,
} from '#entities/session';
import { TermousApiTransport } from '#shared/api';
import type { SSHSessionCreateInput } from '../runtimeGatewayContracts'

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class SessionClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  sessions() {
    return this.request<Session[]>('/api/v1/sessions')
      .then(normalizeSessionResponseList)
  }

  createSession(hostId: string, cols: number, rows: number) {
    return this.createSSHSession({ hostId }, cols, rows)
  }

  createSSHSession(input: SSHSessionCreateInput, cols: number, rows: number) {
    const hasHost = input.hostId !== undefined
    const hasSSHProfile = input.sshProfileId !== undefined
    if (hasHost === hasSSHProfile) {
      throw new TypeError('SSH 连接必须且只能指定一种目标')
    }
    const target = hasSSHProfile
      ? { ssh_profile_id: requireConnectionTargetID(input.sshProfileId, 'SSH Profile ID 无效') }
      : { host_id: requireConnectionTargetID(input.hostId, '主机 ID 无效') }
    return this.request<Session>('/api/v1/sessions', {
      method: 'POST',
      body: { ...target, cols, rows },
    }).then(normalizeSessionResponse)
  }

  createLocalSession(shell: LocalShell, cols: number, rows: number) {
    return this.request<Session>('/api/v1/sessions', {
      method: 'POST',
      body: { kind: 'local', local_shell: shell, cols, rows },
    }).then(normalizeSessionResponse)
  }

deleteSession(id: string) {
    return this.request<void>(`/api/v1/sessions/${id}`, { method: 'DELETE' })
  }

sessionEventsUrl() {
    return this.websocketUrl('/api/v1/sessions/events')
  }

refreshSessionInventory(id: string, force = false, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<Session>(`/api/v1/sessions/${encodeURIComponent(id)}/inventory/refresh`, {
      method: 'POST',
      body: { force },
      signal: options.signal,
    }).then(normalizeSessionResponse)
  }

sessionCompletionStatus(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<CompletionStatus>(
      `/api/v1/sessions/${encodeURIComponent(id)}/completions/status`,
      { signal: options.signal, timeoutMs: 10_000 },
    )
  }

querySessionCompletions(
    id: string,
    query: CompletionQuery,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<CompletionResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/completions/query`,
      {
        method: 'POST',
        body: query,
        signal: options.signal,
        timeoutMs: 10_000,
      },
    ).then(normalizeCompletionResult)
  }

refreshSessionCompletions(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<CompletionStatus>(
      `/api/v1/sessions/${encodeURIComponent(id)}/completions/refresh`,
      {
        method: 'POST',
        signal: options.signal,
        timeoutMs: 15_000,
      },
    )
  }
}

function requireConnectionTargetID(value: string, message: string) {
  if (!value || value.trim() !== value) {
    throw new TypeError(message)
  }
  return value
}
