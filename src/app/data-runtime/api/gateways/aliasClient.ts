import type { AppConfig } from '#common/contracts';
import type { AliasMutationResult, AliasSyncTask, AliasSyncTaskInput, AliasWorkspace, ShellAlias, ShellAliasInput, ShellAliasPatch } from '#entities/alias';
import { TermousApiTransport } from '#shared/api';

const SESSION_ALIAS_READ_TIMEOUT_MS = 45_000

const SESSION_ALIAS_WRITE_TIMEOUT_MS = 90_000

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class AliasClient extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

sessionAliases(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<AliasWorkspace>(`/api/v1/sessions/${encodeURIComponent(id)}/aliases`, {
      signal: options.signal,
      timeoutMs: SESSION_ALIAS_READ_TIMEOUT_MS,
    })
  }

sessionAlias(id: string, aliasId: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<ShellAlias>(
      `/api/v1/sessions/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasId)}`,
      {
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_READ_TIMEOUT_MS,
      },
    )
  }

createSessionAlias(
    id: string,
    input: ShellAliasInput,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<AliasMutationResult>(`/api/v1/sessions/${encodeURIComponent(id)}/aliases`, {
      method: 'POST',
      body: input,
      signal: options.signal,
      timeoutMs: SESSION_ALIAS_WRITE_TIMEOUT_MS,
    })
  }

updateSessionAlias(
    id: string,
    aliasId: string,
    input: ShellAliasPatch,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<AliasMutationResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasId)}`,
      {
        method: 'PATCH',
        body: input,
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_WRITE_TIMEOUT_MS,
      },
    )
  }

deleteSessionAlias(
    id: string,
    aliasId: string,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<AliasMutationResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasId)}`,
      {
        method: 'DELETE',
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_WRITE_TIMEOUT_MS,
      },
    )
  }

repairSessionAliasBridge(
    id: string,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<AliasMutationResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/aliases/bridge/repair`,
      {
        method: 'POST',
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_WRITE_TIMEOUT_MS,
      },
    )
  }

refreshSessionAliasTemplate(
    id: string,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<AliasMutationResult>(
      `/api/v1/sessions/${encodeURIComponent(id)}/aliases/template/refresh`,
      {
        method: 'POST',
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_WRITE_TIMEOUT_MS,
      },
    )
  }

createSessionAliasSyncTask(
    id: string,
    input: AliasSyncTaskInput,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    return this.request<AliasSyncTask>(
      `/api/v1/sessions/${encodeURIComponent(id)}/aliases/sync-tasks`,
      {
        method: 'POST',
        body: input,
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_WRITE_TIMEOUT_MS,
      },
    )
  }

activeAliasSyncTask(options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<AliasSyncTask | null | undefined>('/api/v1/alias-sync-tasks/active', {
      signal: options.signal,
      timeoutMs: SESSION_ALIAS_READ_TIMEOUT_MS,
    }).then((task) => task ?? null)
  }

aliasSyncTask(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<AliasSyncTask>(
      `/api/v1/alias-sync-tasks/${encodeURIComponent(id)}`,
      {
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_READ_TIMEOUT_MS,
      },
    )
  }

cancelAliasSyncTask(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<AliasSyncTask>(
      `/api/v1/alias-sync-tasks/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        signal: options.signal,
        timeoutMs: SESSION_ALIAS_WRITE_TIMEOUT_MS,
      },
    )
  }

aliasSyncTaskEventsUrl(id: string) {
    return this.websocketUrl(`/api/v1/alias-sync-tasks/${encodeURIComponent(id)}/events`)
  }
}
