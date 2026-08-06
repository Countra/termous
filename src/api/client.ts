import type {
  AliasMutationResult,
  AliasSyncTask,
  AliasSyncTaskInput,
  AliasWorkspace,
  AppearanceSettings,
  AppConfig,
  CompletionQuery,
  CompletionResult,
  CompletionSettings,
  CompletionStatus,
  ConnectionProxy,
  ConnectionProxyInput,
  CoreRuntimeInfo,
  CredentialInput,
  CredentialView,
  DataPortabilityApplyResult,
  DataPortabilityPlanItemPage,
  DataPortabilityPlanItemQuery,
  DataPortabilityPlanRequest,
  DataPortabilityResolutionRequest,
  DataPortabilityRestorePlan,
  DataPortabilitySummary,
  DockerActionRequest,
  DockerActionResult,
  DockerCapability,
  DockerContainerDetail,
  DockerContainerQuery,
  DockerContainerSummary,
  DockerContainerStats,
  DockerListResult,
  DockerLogsResult,
  FileBookmark,
  FileBookmarkGroup,
  FileBookmarkGroupInput,
  FileBookmarkGroupReorderItem,
  FileBookmarkInput,
  FileBookmarkReorderItem,
  FileOperationTask,
  FileSession,
  FirewallApplyResult,
  FirewallCapability,
  FirewallDesiredState,
  FirewallInstallPlan,
  FirewallPersistenceInstallResult,
  FirewallPersistenceStatus,
  FirewallPlan,
  FirewallProvider,
  FirewallProviderList,
  FirewallSaveResult,
  FirewallSnapshot,
  ForwardInstance,
  ForwardProfile,
  ForwardProfileInput,
  ForwardStartRequest,
  GroupReorderItem,
  Host,
  HostGroup,
  HostIcon,
  HostInput,
  HostKeyChallengeSnapshot,
  HostKeyDecisionAction,
  HostKeyResolution,
  HostKeyTrustRecord,
  HostReachability,
  Language,
  LocalShell,
  LocalFileGrant,
  LocalGrantSource,
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
  LocalTreeEntry,
  OverwritePolicy,
  PrivateKeyCredentialBundleInput,
  PrivateKeyCredentialBundleResult,
  RemoteDirectoryListing,
  RemoteFileEntry,
  RemoteProcessDetail,
  RemoteProcessListResult,
  RemoteProcessQuery,
  RemoteProcessTerminateResult,
  RemoteProcessTerminateSignal,
  RemoteTextFile,
  RemoteTextSaveRequest,
  RemoteTextSaveResult,
  Session,
  ShellAlias,
  ShellAliasInput,
  ShellAliasPatch,
  Settings,
  ShortcutSettingsPatch,
  SSHKeyGenerateRequest,
  SSHKeyInspectRequest,
  SSHKeyInspectResult,
  SSHKeyPair,
  SystemServiceAction,
  SystemServiceCapability,
  SystemServiceDetail,
  SystemServiceListResult,
  SystemServiceLogQuery,
  SystemServiceLogsResult,
  SystemServiceOperation,
  SystemServiceQuery,
  SystemServiceSummary,
  TerminalFont,
  TerminalSettings,
  TransferTask,
  WindowSettings,
} from '../types/domain'
import type {
  CodeSnippet,
  CodeSnippetGroup,
  CodeSnippetGroupInput,
  CodeSnippetInput,
} from '#entities/snippet'
import { getTermousBridge } from '#shared/bridge'
import { TermousApiTransport } from '#shared/api'
import { normalizeCompletionResult } from '../features/terminal/completionModel'

export { TermousApiError } from '#shared/api'

const SESSION_ALIAS_READ_TIMEOUT_MS = 45_000
const SESSION_ALIAS_WRITE_TIMEOUT_MS = 90_000

interface RequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  signal?: AbortSignal
}

export class TermousApi extends TermousApiTransport {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  terminalFontFileUrl(id: string, sha256?: string) {
    const url = new URL(`/api/v1/terminal-fonts/${encodeURIComponent(id)}/file`, this.config.apiBaseUrl)
    if (this.config.apiToken) {
      url.searchParams.set('token', this.config.apiToken)
    }
    if (sha256) {
      url.searchParams.set('sha256', sha256)
    }
    return url.toString()
  }

  hostIconFileUrl(id: string, sha256?: string) {
    const url = new URL(`/api/v1/host-icons/${encodeURIComponent(id)}/file`, this.config.apiBaseUrl)
    if (this.config.apiToken) {
      url.searchParams.set('token', this.config.apiToken)
    }
    if (sha256) {
      url.searchParams.set('sha256', sha256)
    }
    return url.toString()
  }

  health() {
    return this.request<{ status: string }>('/api/v1/healthz')
  }

  runtime() {
    return this.request<CoreRuntimeInfo>('/api/v1/runtime')
  }

  heartbeat() {
    return this.request<{ status: string; server_time: string; shutdown_in_progress: boolean }>('/api/v1/runtime/heartbeat', {
      method: 'POST',
    })
  }

  shutdown(reason = 'frontend_exit') {
    return this.request<{ status: string }>('/api/v1/runtime/shutdown', {
      method: 'POST',
      body: { reason },
    })
  }

  settings() {
    return this.request<Settings>('/api/v1/settings')
  }

  updateLanguage(language: Language) {
    return this.request<Settings>('/api/v1/settings/language', {
      method: 'PATCH',
      body: { language },
    })
  }

  updateAppearanceSettings(appearance: AppearanceSettings) {
    return this.request<Settings>('/api/v1/settings/appearance', {
      method: 'PATCH',
      body: appearance,
    })
  }

  updateTerminalSettings(terminal: TerminalSettings) {
    return this.request<Settings>('/api/v1/settings/terminal', {
      method: 'PATCH',
      body: terminal,
    })
  }

  updateCompletionSettings(completion: CompletionSettings) {
    return this.request<Settings>('/api/v1/settings/completion', {
      method: 'PATCH',
      body: completion,
    })
  }

  updateShortcutSettings(patch: ShortcutSettingsPatch) {
    return this.request<Settings>('/api/v1/settings/shortcuts', {
      method: 'PATCH',
      body: patch,
    })
  }

  updateWindowSettings(windowSettings: WindowSettings) {
    return this.request<Settings>('/api/v1/settings/window', {
      method: 'PATCH',
      body: windowSettings,
    })
  }

  codeSnippets() {
    return this.request<CodeSnippet[]>('/api/v1/snippets').then(normalizeArray)
  }

  codeSnippetGroups() {
    return this.request<CodeSnippetGroup[]>('/api/v1/snippet-groups').then(normalizeArray)
  }

  createCodeSnippetGroup(input: CodeSnippetGroupInput) {
    return this.request<CodeSnippetGroup>('/api/v1/snippet-groups', {
      method: 'POST',
      body: input,
    })
  }

  updateCodeSnippetGroup(id: string, input: CodeSnippetGroupInput) {
    return this.request<CodeSnippetGroup>(`/api/v1/snippet-groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteCodeSnippetGroup(id: string) {
    return this.request<void>(`/api/v1/snippet-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  reorderCodeSnippetGroups(items: GroupReorderItem[]) {
    return this.request<CodeSnippetGroup[]>('/api/v1/snippet-groups/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

  createCodeSnippet(input: CodeSnippetInput) {
    return this.request<CodeSnippet>('/api/v1/snippets', {
      method: 'POST',
      body: input,
    })
  }

  updateCodeSnippet(id: string, input: CodeSnippetInput) {
    return this.request<CodeSnippet>(`/api/v1/snippets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteCodeSnippet(id: string) {
    return this.request<void>(`/api/v1/snippets/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  markCodeSnippetUsed(id: string) {
    return this.request<CodeSnippet>(`/api/v1/snippets/${encodeURIComponent(id)}/used`, { method: 'POST' })
  }

  fileBookmarkGroups() {
    return this.request<FileBookmarkGroup[]>('/api/v1/file-bookmark-groups').then(normalizeArray)
  }

  createFileBookmarkGroup(input: FileBookmarkGroupInput) {
    return this.request<FileBookmarkGroup>('/api/v1/file-bookmark-groups', {
      method: 'POST',
      body: input,
    })
  }

  updateFileBookmarkGroup(id: string, input: FileBookmarkGroupInput) {
    return this.request<FileBookmarkGroup>(`/api/v1/file-bookmark-groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteFileBookmarkGroup(id: string) {
    return this.request<void>(`/api/v1/file-bookmark-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  reorderFileBookmarkGroups(items: FileBookmarkGroupReorderItem[]) {
    return this.request<FileBookmarkGroup[]>('/api/v1/file-bookmark-groups/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

  fileBookmarks() {
    return this.request<FileBookmark[]>('/api/v1/file-bookmarks').then(normalizeArray)
  }

  createFileBookmark(input: FileBookmarkInput) {
    return this.request<FileBookmark>('/api/v1/file-bookmarks', {
      method: 'POST',
      body: input,
    })
  }

  updateFileBookmark(id: string, input: FileBookmarkInput) {
    return this.request<FileBookmark>(`/api/v1/file-bookmarks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteFileBookmark(id: string) {
    return this.request<void>(`/api/v1/file-bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  reorderFileBookmarks(items: FileBookmarkReorderItem[]) {
    return this.request<FileBookmark[]>('/api/v1/file-bookmarks/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

  localPathMappings() {
    return this.request<LocalPathMapping[]>('/api/v1/local-path-mappings').then(normalizeArray)
  }

  createLocalPathMapping(input: LocalPathMappingInput) {
    return this.request<LocalPathMapping>('/api/v1/local-path-mappings', {
      method: 'POST',
      body: input,
    })
  }

  updateLocalPathMapping(id: string, input: LocalPathMappingInput) {
    return this.request<LocalPathMapping>(`/api/v1/local-path-mappings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteLocalPathMapping(id: string) {
    return this.request<void>(`/api/v1/local-path-mappings/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  reorderLocalPathMappings(items: LocalPathMappingReorderItem[]) {
    return this.request<LocalPathMapping[]>('/api/v1/local-path-mappings/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

  localPathMappingChildren(id: string, path = '', signal?: AbortSignal) {
    const query = path ? `?${new URLSearchParams({ path }).toString()}` : ''
    return this.request<LocalTreeEntry[]>(
      `/api/v1/local-path-mappings/${encodeURIComponent(id)}/children${query}`,
      { signal },
    ).then(normalizeArray)
  }

  localPathMappingStat(id: string, path = '', signal?: AbortSignal) {
    const query = path ? `?${new URLSearchParams({ path }).toString()}` : ''
    return this.request<LocalTreeEntry>(
      `/api/v1/local-path-mappings/${encodeURIComponent(id)}/stat${query}`,
      { signal },
    )
  }

  forwardProfiles() {
    return this.request<ForwardProfile[]>('/api/v1/forward-profiles')
  }

  createForwardProfile(input: ForwardProfileInput) {
    return this.request<ForwardProfile>('/api/v1/forward-profiles', {
      method: 'POST',
      body: input,
    })
  }

  updateForwardProfile(id: string, input: ForwardProfileInput) {
    return this.request<ForwardProfile>(`/api/v1/forward-profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteForwardProfile(id: string) {
    return this.request<void>(`/api/v1/forward-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  forwards() {
    return this.request<ForwardInstance[]>('/api/v1/forwards')
  }

  getForward(id: string) {
    return this.request<ForwardInstance>(`/api/v1/forwards/${encodeURIComponent(id)}`)
  }

  startForward(input: ForwardStartRequest) {
    return this.request<ForwardInstance>('/api/v1/forwards', {
      method: 'POST',
      body: input,
    })
  }

  stopForward(id: string) {
    return this.request<void>(`/api/v1/forwards/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  forwardEventsUrl() {
    return this.websocketUrl('/api/v1/forwards/events')
  }

  terminalFonts() {
    return this.request<TerminalFont[]>('/api/v1/terminal-fonts')
  }

  uploadTerminalFont(file: File) {
    const body = new FormData()
    body.append('file', file, file.name)
    return this.request<TerminalFont>('/api/v1/terminal-fonts', {
      method: 'POST',
      body,
    })
  }

  deleteTerminalFont(id: string) {
    return this.request<void>(`/api/v1/terminal-fonts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  uploadHostIcon(file: File) {
    const body = new FormData()
    body.append('file', file, file.name)
    return this.request<HostIcon>('/api/v1/host-icons', {
      method: 'POST',
      body,
    })
  }

  deleteHostIcon(id: string) {
    return this.request<void>(`/api/v1/host-icons/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  hostGroups() {
    return this.request<HostGroup[]>('/api/v1/host-groups')
  }

  createHostGroup(name: string) {
    return this.request<HostGroup>('/api/v1/host-groups', {
      method: 'POST',
      body: { name },
    })
  }

  updateHostGroup(id: string, name: string) {
    return this.request<HostGroup>(`/api/v1/host-groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { name },
    })
  }

  deleteHostGroup(id: string) {
    return this.request<void>(`/api/v1/host-groups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  reorderHostGroups(items: GroupReorderItem[]) {
    return this.request<HostGroup[]>('/api/v1/host-groups/reorder', {
      method: 'POST',
      body: { items },
    }).then(normalizeArray)
  }

  connectionProxies() {
    return this.request<ConnectionProxy[]>('/api/v1/proxies')
  }

  createConnectionProxy(input: ConnectionProxyInput) {
    return this.request<ConnectionProxy>('/api/v1/proxies', {
      method: 'POST',
      body: input,
    })
  }

  updateConnectionProxy(id: string, input: ConnectionProxyInput) {
    return this.request<ConnectionProxy>(`/api/v1/proxies/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteConnectionProxy(id: string) {
    return this.request<void>(`/api/v1/proxies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  hosts() {
    return this.request<Host[]>('/api/v1/hosts')
  }

  hostReachability() {
    return this.request<HostReachability[]>('/api/v1/hosts/reachability')
  }

  refreshHostReachability(hostIds: string[] = [], force = false) {
    return this.request<HostReachability[]>('/api/v1/hosts/reachability/refresh', {
      method: 'POST',
      body: { host_ids: hostIds, force },
      timeoutMs: 4_000,
    })
  }

  hostReachabilityEventsUrl() {
    return this.websocketUrl('/api/v1/hosts/reachability/events')
  }

  createHost(input: HostInput) {
    return this.request<Host>('/api/v1/hosts', {
      method: 'POST',
      body: input,
    })
  }

  updateHost(id: string, input: HostInput) {
    return this.request<Host>(`/api/v1/hosts/${id}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteHost(id: string) {
    return this.request<void>(`/api/v1/hosts/${id}`, { method: 'DELETE' })
  }

  credentials() {
    return this.request<CredentialView[]>('/api/v1/credentials')
  }

  createCredential(input: CredentialInput) {
    const credential = toCredentialRequest(input)
    return this.request<CredentialView>('/api/v1/credentials', {
      method: 'POST',
      body: credential,
    })
  }

  updateCredential(id: string, input: CredentialInput) {
    const credential = toCredentialRequest(input)
    return this.request<CredentialView>(`/api/v1/credentials/${id}`, {
      method: 'PATCH',
      body: credential,
    })
  }

  deleteCredential(id: string) {
    return this.request<void>(`/api/v1/credentials/${id}`, { method: 'DELETE' })
  }

  generateSSHKey(input: SSHKeyGenerateRequest, signal?: AbortSignal) {
    return this.request<SSHKeyPair>('/api/v1/credentials/ssh-keys/generate', {
      method: 'POST',
      body: input,
      signal,
    })
  }

  inspectSSHKey(input: SSHKeyInspectRequest, signal?: AbortSignal) {
    return this.request<SSHKeyInspectResult>('/api/v1/credentials/ssh-keys/inspect', {
      method: 'POST',
      body: input,
      signal,
    })
  }

  createPrivateKeyCredentialBundle(input: PrivateKeyCredentialBundleInput) {
    return this.request<PrivateKeyCredentialBundleResult>('/api/v1/credentials/private-key-bundles', {
      method: 'POST',
      body: input,
    })
  }

  hostKeyChallenges(signal?: AbortSignal) {
    return this.request<HostKeyChallengeSnapshot>('/api/v1/host-key-challenges?status=pending', { signal })
      .then(normalizeHostKeyChallengeSnapshot)
  }

  decideHostKeyChallenge(id: string, action: HostKeyDecisionAction) {
    return this.request<HostKeyResolution>(`/api/v1/host-key-challenges/${encodeURIComponent(id)}/decision`, {
      method: 'POST',
      body: { action },
    })
  }

  hostKeyTrust() {
    return this.request<HostKeyTrustRecord[]>('/api/v1/host-key-trust').then(normalizeArray)
  }

  deleteHostKeyTrust(id: string) {
    return this.request<void>(`/api/v1/host-key-trust/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  hostKeyEventsUrl() {
    return this.websocketUrl('/api/v1/host-key-events')
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

  sessionMonitorUrl(id: string) {
    return this.websocketUrl(`/api/v1/sessions/${encodeURIComponent(id)}/monitor`)
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

  sessionFirewallProviders(id: string, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallProviderList>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/providers`, {
      signal: options.signal,
    }).then(normalizeFirewallProviderList)
  }

  sessionFirewallCapability(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallCapability>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/capability${firewallProviderQuery(provider)}`, {
      signal: options.signal,
    }).then(normalizeFirewallCapability)
  }

  sessionFirewallSnapshot(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallSnapshot>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/snapshot${firewallProviderQuery(provider)}`, {
      signal: options.signal,
    }).then(normalizeFirewallSnapshot)
  }

  previewSessionFirewall(id: string, desired: FirewallDesiredState, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallPlan>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/preview${firewallProviderQuery(provider)}`, {
      method: 'POST',
      body: desired,
      signal: options.signal,
    })
  }

  applySessionFirewall(id: string, desired: FirewallDesiredState, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallApplyResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/apply${firewallProviderQuery(provider)}`, {
      method: 'POST',
      body: desired,
      signal: options.signal,
    }).then(normalizeFirewallApplyResult)
  }

  saveSessionFirewall(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallSaveResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/save${firewallProviderQuery(provider)}`, {
      method: 'POST',
      timeoutMs: 60_000,
      signal: options.signal,
    })
  }

  sessionFirewallPersistenceStatus(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallPersistenceStatus>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/status${firewallProviderQuery(provider)}`, {
      timeoutMs: 20_000,
      signal: options.signal,
    })
  }

  sessionFirewallPersistenceInstallPlan(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallInstallPlan>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/install-plan${firewallProviderQuery(provider)}`, {
      method: 'POST',
      timeoutMs: 20_000,
      signal: options.signal,
    })
  }

  installSessionFirewallPersistence(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallPersistenceInstallResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/install${firewallProviderQuery(provider)}`, {
      method: 'POST',
      body: { confirmed: true },
      timeoutMs: 190_000,
      signal: options.signal,
    })
  }

  saveSessionFirewallPersistence(id: string, provider?: FirewallProvider, options: Pick<RequestOptions, 'signal'> = {}) {
    return this.request<FirewallSaveResult>(`/api/v1/sessions/${encodeURIComponent(id)}/firewall/persistence/save${firewallProviderQuery(provider)}`, {
      method: 'POST',
      timeoutMs: 60_000,
      signal: options.signal,
    })
  }

  fileSessions() {
    return this.request<FileSession[]>('/api/v1/file-sessions')
  }

  createFileSession(hostId: string, sourceSessionId = '', initialPath = '') {
    const body: { host_id: string; source_session_id?: string; initial_path?: string } = { host_id: hostId }
    if (sourceSessionId) {
      body.source_session_id = sourceSessionId
    }
    if (initialPath) {
      body.initial_path = initialPath
    }
    return this.request<FileSession>('/api/v1/file-sessions', {
      method: 'POST',
      body,
    })
  }

  getFileSession(id: string) {
    return this.request<FileSession>(`/api/v1/file-sessions/${encodeURIComponent(id)}`)
  }

  deleteFileSession(id: string) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  reconnectFileSession(id: string) {
    return this.request<FileSession>(`/api/v1/file-sessions/${encodeURIComponent(id)}/reconnect`, { method: 'POST' })
  }

  fileSessionEventsUrl(id: string) {
    return this.websocketUrl(`/api/v1/file-sessions/${encodeURIComponent(id)}/events`)
  }

  listFiles(hostId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteDirectoryListing>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files?${query.toString()}`)
  }

  listFileSessionFiles(
    fileSessionId: string,
    path: string,
    options: Pick<RequestOptions, 'signal'> = {},
  ) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteDirectoryListing>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files?${query.toString()}`, {
      signal: options.signal,
    })
  }

  statFileSessionFile(fileSessionId: string, path: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteFileEntry>(
      `/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/stat?${query.toString()}`,
      { signal },
    )
  }

  openFileSessionTextFile(fileSessionId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteTextFile>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text?${query.toString()}`, {
      timeoutMs: 90_000,
    })
  }

  saveFileSessionTextFile(fileSessionId: string, body: RemoteTextSaveRequest) {
    return this.request<RemoteTextSaveResult>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text`, {
      method: 'PUT',
      body,
      timeoutMs: 90_000,
    })
  }

  createFileSessionTextReadOperation(fileSessionId: string, path: string, signal?: AbortSignal) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text/read`, {
      method: 'POST',
      body: { path },
      signal,
    })
  }

  createFileSessionTextSaveOperation(fileSessionId: string, body: RemoteTextSaveRequest, signal?: AbortSignal) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/text/save`, {
      method: 'POST',
      body,
      signal,
      timeoutMs: 90_000,
    })
  }

  createFileSessionImageReadOperation(fileSessionId: string, path: string) {
    return this.request<FileOperationTask>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/image/read`, {
      method: 'POST',
      body: { path },
    })
  }

  fileOperation(id: string) {
    return this.request<FileOperationTask>(`/api/v1/file-operations/${encodeURIComponent(id)}`)
  }

  fileOperationResult<T>(id: string) {
    return this.request<T>(`/api/v1/file-operations/${encodeURIComponent(id)}/result`, {
      timeoutMs: 90_000,
    })
  }

  fileOperationBlobResult(id: string) {
    return this.requestBlob(`/api/v1/file-operations/${encodeURIComponent(id)}/blob`, {
      timeoutMs: 90_000,
    })
  }

  cancelFileOperation(id: string) {
    return this.request<void>(`/api/v1/file-operations/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  fileOperationEventsUrl(fileSessionId: string) {
    return this.websocketUrl(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/file-operations/events`)
  }

  mkdirFileSessionFile(fileSessionId: string, path: string) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/mkdir`, {
      method: 'POST',
      body: { path },
    })
  }

  renameFileSessionFile(fileSessionId: string, sourcePath: string, targetPath: string) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/rename`, {
      method: 'PATCH',
      body: { source_path: sourcePath, target_path: targetPath },
    })
  }

  chmodFileSessionFile(fileSessionId: string, path: string, mode: string) {
    return this.request<RemoteFileEntry>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/permissions`, {
      method: 'PATCH',
      body: { path, mode },
    })
  }

  deleteFileSessionFiles(fileSessionId: string, paths: string[], recursive = true) {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files`, {
      method: 'DELETE',
      body: { paths, recursive },
    })
  }

  copyFileSessionFiles(fileSessionId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/copy`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }

  moveFileSessionFiles(fileSessionId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/move`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }

  statFile(hostId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteFileEntry>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/stat?${query.toString()}`)
  }

  mkdirFile(hostId: string, path: string) {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/mkdir`, {
      method: 'POST',
      body: { path },
    })
  }

  renameFile(hostId: string, sourcePath: string, targetPath: string) {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/rename`, {
      method: 'PATCH',
      body: { source_path: sourcePath, target_path: targetPath },
    })
  }

  deleteFiles(hostId: string, paths: string[], recursive = true) {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files`, {
      method: 'DELETE',
      body: { paths, recursive },
    })
  }

  copyFiles(hostId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/copy`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }

  moveFiles(hostId: string, sourcePaths: string[], targetDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<void>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files/move`, {
      method: 'POST',
      body: { source_paths: sourcePaths, target_dir: targetDir, overwrite_policy: overwritePolicy },
    })
  }

  createLocalFileGrant(source: LocalGrantSource, paths: string[]) {
    return this.request<LocalFileGrant>('/api/v1/local-file-grants', {
      method: 'POST',
      body: { source, paths },
    })
  }

  transfers() {
    return this.request<TransferTask[]>('/api/v1/transfers')
  }

  createUploadTransfer(hostId: string, localGrantId: string, remoteDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<TransferTask>('/api/v1/transfers/upload', {
      method: 'POST',
      body: {
        host_id: hostId,
        local_grant_id: localGrantId,
        remote_dir: remoteDir,
        overwrite_policy: overwritePolicy,
      },
    })
  }

  createFileSessionUploadTransfer(fileSessionId: string, localGrantId: string, remoteDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<TransferTask>('/api/v1/transfers/upload', {
      method: 'POST',
      body: {
        file_session_id: fileSessionId,
        local_grant_id: localGrantId,
        remote_dir: remoteDir,
        overwrite_policy: overwritePolicy,
      },
    })
  }

  createDownloadTransfer(hostId: string, remotePaths: string[], localDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<TransferTask>('/api/v1/transfers/download', {
      method: 'POST',
      body: {
        host_id: hostId,
        remote_paths: remotePaths,
        local_dir: localDir,
        overwrite_policy: overwritePolicy,
      },
    })
  }

  createFileSessionDownloadTransfer(
    fileSessionId: string,
    remotePaths: string[],
    localDir: string,
    overwritePolicy: OverwritePolicy = 'rename',
    signal?: AbortSignal,
  ) {
    return this.request<TransferTask>('/api/v1/transfers/download', {
      method: 'POST',
      body: {
        file_session_id: fileSessionId,
        remote_paths: remotePaths,
        local_dir: localDir,
        overwrite_policy: overwritePolicy,
      },
      signal,
    })
  }

  retryTransfer(id: string) {
    return this.request<TransferTask>(`/api/v1/transfers/${encodeURIComponent(id)}/retry`, { method: 'POST' })
  }

  deleteTransfer(id: string) {
    return this.request<void>(`/api/v1/transfers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  transferEventsUrl() {
    return this.websocketUrl('/api/v1/transfers/events')
  }

  dataPortabilitySummary() {
    return this.request<DataPortabilitySummary>('/api/v1/data-portability/summary', { timeoutMs: 30_000 })
      .then(normalizeDataPortabilitySummary)
  }

  createDataPortabilityPlan(importId: string, body: DataPortabilityPlanRequest) {
    return this.request<DataPortabilityRestorePlan>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans`,
      { method: 'POST', body, timeoutMs: 60_000 },
    ).then(normalizeDataPortabilityPlan)
  }

  dataPortabilityPlanItems(importId: string, planId: string, query: DataPortabilityPlanItemQuery = {}) {
    const params = new URLSearchParams()
    if (query.dataset) params.set('dataset', query.dataset)
    if (query.status) params.set('status', query.status)
    if (query.cursor) params.set('cursor', query.cursor)
    if (query.limit) params.set('limit', String(query.limit))
    const suffix = params.size > 0 ? `?${params.toString()}` : ''
    return this.request<DataPortabilityPlanItemPage>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans/${encodeURIComponent(planId)}/items${suffix}`,
      { timeoutMs: 30_000 },
    ).then(normalizeDataPortabilityPlanItemPage)
  }

  resolveDataPortabilityPlan(importId: string, planId: string, body: DataPortabilityResolutionRequest) {
    return this.request<DataPortabilityRestorePlan>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans/${encodeURIComponent(planId)}/resolutions`,
      { method: 'PATCH', body, timeoutMs: 30_000 },
    ).then(normalizeDataPortabilityPlan)
  }

  applyDataPortabilityPlan(importId: string, planId: string) {
    return this.request<DataPortabilityApplyResult>(
      `/api/v1/data-portability/imports/${encodeURIComponent(importId)}/plans/${encodeURIComponent(planId)}/apply`,
      { method: 'POST', body: {}, timeoutMs: 120_000 },
    )
  }

  cancelDataPortabilityImport(importId: string) {
    return this.request<void>(`/api/v1/data-portability/imports/${encodeURIComponent(importId)}`, {
      method: 'DELETE',
      timeoutMs: 30_000,
    })
  }

}

function firewallProviderQuery(provider?: FirewallProvider) {
  if (!provider || provider === 'unsupported') {
    return ''
  }
  return `?${new URLSearchParams({ provider }).toString()}`
}

function normalizeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function normalizeDataPortabilitySummary(summary: DataPortabilitySummary): DataPortabilitySummary {
  return {
    ...summary,
    datasets: normalizeArray(summary.datasets),
  }
}

function normalizeDataPortabilityPlan(plan: DataPortabilityRestorePlan): DataPortabilityRestorePlan {
  return {
    ...plan,
    items: normalizeArray(plan.items),
    summary: {
      ...plan.summary,
      by_status: plan.summary?.by_status ?? {},
      by_dataset: plan.summary?.by_dataset ?? {},
    },
  }
}

function normalizeDataPortabilityPlanItemPage(page: DataPortabilityPlanItemPage): DataPortabilityPlanItemPage {
  return {
    ...page,
    items: normalizeArray(page.items),
  }
}

function normalizeHostKeyChallengeSnapshot(snapshot: HostKeyChallengeSnapshot): HostKeyChallengeSnapshot {
  return {
    ...snapshot,
    challenges: normalizeArray(snapshot.challenges).map((challenge) => ({
      ...challenge,
      contexts: normalizeArray(challenge.contexts),
    })),
  }
}

function normalizeFirewallProviderList(list: FirewallProviderList): FirewallProviderList {
  return {
    ...list,
    providers: normalizeArray(list.providers),
  }
}

function normalizeFirewallCapability(capability: FirewallCapability): FirewallCapability {
  return {
    ...capability,
    detected_providers: normalizeArray(capability.detected_providers),
    unsupported_reasons: normalizeArray(capability.unsupported_reasons),
  }
}

function normalizeFirewallSnapshot(snapshot: FirewallSnapshot): FirewallSnapshot {
  return {
    ...snapshot,
    capability: normalizeFirewallCapability(snapshot.capability),
    rules: normalizeArray(snapshot.rules),
    unsupported_rules: normalizeArray(snapshot.unsupported_rules),
    warnings: normalizeArray(snapshot.warnings),
  }
}

function normalizeFirewallApplyResult(result: FirewallApplyResult): FirewallApplyResult {
  return {
    ...result,
    snapshot: normalizeFirewallSnapshot(result.snapshot),
  }
}

function normalizeDockerCapability(capability: DockerCapability): DockerCapability {
  return {
    ...capability,
    warnings: normalizeArray(capability.warnings),
  }
}

function normalizeSystemServiceCapability(capability: SystemServiceCapability): SystemServiceCapability {
  return {
    ...capability,
    warnings: normalizeArray(capability.warnings),
  }
}

function normalizeSystemServiceSummary(summary: SystemServiceSummary): SystemServiceSummary {
  return {
    ...summary,
    names: normalizeArray(summary.names),
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

function normalizeDockerContainerSummary(summary: DockerContainerSummary): DockerContainerSummary {
  return {
    ...summary,
    ports: normalizeArray(summary.ports),
    warnings: normalizeArray(summary.warnings),
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

export async function createApiFromRuntime() {
  const bridge = getTermousBridge()
  const runtimeConfig = bridge ? await bridge.getConfig() : {}
  return new TermousApi(runtimeConfig)
}

function toCredentialRequest(input: CredentialInput) {
  const credential = { ...input }
  delete credential.pending_passphrase
  return credential
}
