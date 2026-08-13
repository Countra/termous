import type { AppConfig } from '#common/contracts';
import type { CompletionQuery, CompletionResult, CompletionStatus, LocalShell, Session } from '#entities/session';
import { TermousApiTransport } from '#shared/api';
import { normalizeCompletionResult } from '#entities/session';

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
  }

createSession(hostId: string, cols: number, rows: number) {
    return this.request<Session>('/api/v1/sessions', {
      method: 'POST',
      body: { host_id: hostId, cols, rows },
    })
  }

createLocalSession(shell: LocalShell, cols: number, rows: number) {
    return this.request<Session>('/api/v1/sessions', {
      method: 'POST',
      body: { kind: 'local', local_shell: shell, cols, rows },
    })
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
    })
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
