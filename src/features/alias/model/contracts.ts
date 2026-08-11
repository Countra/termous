import type {
  AliasMutationResult,
  AliasSyncTask,
  AliasSyncTaskInput,
  AliasWorkspace,
  ShellAliasInput,
  ShellAliasPatch,
} from '#entities/alias'

interface AliasRequestOptions {
  signal?: AbortSignal
}

export interface AliasGateway {
  sessionAliases(sessionId: string, options?: AliasRequestOptions): Promise<AliasWorkspace>
  createSessionAlias(
    sessionId: string,
    input: ShellAliasInput,
    options?: AliasRequestOptions,
  ): Promise<AliasMutationResult>
  updateSessionAlias(
    sessionId: string,
    aliasId: string,
    input: ShellAliasPatch,
    options?: AliasRequestOptions,
  ): Promise<AliasMutationResult>
  deleteSessionAlias(
    sessionId: string,
    aliasId: string,
    options?: AliasRequestOptions,
  ): Promise<AliasMutationResult>
  repairSessionAliasBridge(
    sessionId: string,
    options?: AliasRequestOptions,
  ): Promise<AliasMutationResult>
  refreshSessionAliasTemplate(
    sessionId: string,
    options?: AliasRequestOptions,
  ): Promise<AliasMutationResult>
  createSessionAliasSyncTask(
    sessionId: string,
    input: AliasSyncTaskInput,
    options?: AliasRequestOptions,
  ): Promise<AliasSyncTask>
  activeAliasSyncTask(options?: AliasRequestOptions): Promise<AliasSyncTask | null>
  aliasSyncTask(taskId: string, options?: AliasRequestOptions): Promise<AliasSyncTask>
  cancelAliasSyncTask(taskId: string, options?: AliasRequestOptions): Promise<AliasSyncTask>
  aliasSyncTaskEventsUrl(taskId: string): string
}

export interface AliasSessionContext {
  id: string
  kind: 'ssh' | 'local'
  status: string
  host_id?: string
}
