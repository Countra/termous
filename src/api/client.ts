import type {
  ApiErrorBody,
  AppConfig,
  CodeSnippet,
  CodeSnippetInput,
  CredentialInput,
  CredentialView,
  FileSession,
  Host,
  HostGroup,
  HostInput,
  KnownHost,
  KnownHostInput,
  Language,
  LocalShell,
  LocalFileGrant,
  LocalGrantSource,
  OverwritePolicy,
  RemoteDirectoryListing,
  RemoteFileEntry,
  Session,
  Settings,
  TerminalFont,
  TerminalSettings,
  TransferTask,
} from '../types/domain'

const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: import.meta.env.VITE_TERMOUS_API_BASE_URL ?? 'http://127.0.0.1:8122',
  apiToken: import.meta.env.VITE_TERMOUS_API_TOKEN ?? (import.meta.env.DEV ? 'dev-token' : ''),
}

export class TermousApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'TermousApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class TermousApi {
  private config: AppConfig

  constructor(config: Partial<AppConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  updateConfig(config: Partial<AppConfig>) {
    this.config = { ...this.config, ...config }
  }

  websocketUrl(path: string) {
    const base = new URL(this.config.apiBaseUrl)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    base.pathname = path
    base.search = ''
    if (this.config.apiToken) {
      base.searchParams.set('token', this.config.apiToken)
    }
    return base.toString()
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

  health() {
    return this.request<{ status: string }>('/api/v1/healthz')
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

  updateTerminalSettings(terminal: TerminalSettings) {
    return this.request<Settings>('/api/v1/settings/terminal', {
      method: 'PATCH',
      body: terminal,
    })
  }

  codeSnippets() {
    return this.request<CodeSnippet[]>('/api/v1/snippets')
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

  hostGroups() {
    return this.request<HostGroup[]>('/api/v1/host-groups')
  }

  createHostGroup(name: string) {
    return this.request<HostGroup>('/api/v1/host-groups', {
      method: 'POST',
      body: { name, sort_order: 0 },
    })
  }

  hosts() {
    return this.request<Host[]>('/api/v1/hosts')
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

  importSSHConfig() {
    return this.request<{ imported: number; message: string }>('/api/v1/hosts/import-ssh-config', {
      method: 'POST',
      body: {},
    })
  }

  credentials() {
    return this.request<CredentialView[]>('/api/v1/credentials')
  }

  createCredential(input: CredentialInput) {
    return this.request<CredentialView>('/api/v1/credentials', {
      method: 'POST',
      body: input,
    })
  }

  updateCredential(id: string, input: CredentialInput) {
    return this.request<CredentialView>(`/api/v1/credentials/${id}`, {
      method: 'PATCH',
      body: input,
    })
  }

  deleteCredential(id: string) {
    return this.request<void>(`/api/v1/credentials/${id}`, { method: 'DELETE' })
  }

  generateKey() {
    return this.request<CredentialView>('/api/v1/credentials/generate-key', {
      method: 'POST',
      body: {},
    })
  }

  knownHosts() {
    return this.request<KnownHost[]>('/api/v1/known-hosts')
  }

  confirmKnownHost(input: KnownHostInput) {
    return this.request<KnownHost>('/api/v1/known-hosts/confirm', {
      method: 'POST',
      body: input,
    })
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

  fileSessions() {
    return this.request<FileSession[]>('/api/v1/file-sessions')
  }

  createFileSession(hostId: string, sourceSessionId = '', initialPath = '/') {
    return this.request<FileSession>('/api/v1/file-sessions', {
      method: 'POST',
      body: { host_id: hostId, source_session_id: sourceSessionId, initial_path: initialPath },
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

  trustFileSessionHost(id: string, decision: 'trust' | 'replace' | 'reject', fingerprintSHA256: string) {
    return this.request<FileSession>(`/api/v1/file-sessions/${encodeURIComponent(id)}/trust-host`, {
      method: 'POST',
      body: { decision, fingerprint_sha256: fingerprintSHA256 },
    })
  }

  fileSessionEventsUrl(id: string) {
    return this.websocketUrl(`/api/v1/file-sessions/${encodeURIComponent(id)}/events`)
  }

  listFiles(hostId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteDirectoryListing>(`/api/v1/hosts/${encodeURIComponent(hostId)}/files?${query.toString()}`)
  }

  listFileSessionFiles(fileSessionId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteDirectoryListing>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files?${query.toString()}`)
  }

  statFileSessionFile(fileSessionId: string, path: string) {
    const query = new URLSearchParams({ path })
    return this.request<RemoteFileEntry>(`/api/v1/file-sessions/${encodeURIComponent(fileSessionId)}/files/stat?${query.toString()}`)
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

  createFileSessionDownloadTransfer(fileSessionId: string, remotePaths: string[], localDir: string, overwritePolicy: OverwritePolicy = 'rename') {
    return this.request<TransferTask>('/api/v1/transfers/download', {
      method: 'POST',
      body: {
        file_session_id: fileSessionId,
        remote_paths: remotePaths,
        local_dir: localDir,
        overwrite_policy: overwritePolicy,
      },
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

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    const isFormData = options.body instanceof FormData
    let requestBody: BodyInit | undefined
    if (options.body instanceof FormData) {
      requestBody = options.body
    } else if (options.body !== undefined) {
      requestBody = JSON.stringify(options.body)
    }
    try {
      const response = await fetch(new URL(path, this.config.apiBaseUrl), {
        method: options.method ?? 'GET',
        headers: {
          ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
          ...(this.config.apiToken ? { 'X-Termous-Token': this.config.apiToken } : {}),
        },
        body: requestBody,
        signal: controller.signal,
      })
      if (!response.ok) {
        throw await this.toError(response)
      }
      if (response.status === 204) {
        return undefined as T
      }
      return (await response.json()) as T
    } catch (error) {
      if (error instanceof TermousApiError) {
        throw error
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new TermousApiError('请求超时', 'REQUEST_TIMEOUT', 0)
      }
      throw new TermousApiError(error instanceof Error ? error.message : '本地 API 不可用', 'NETWORK_ERROR', 0)
    } finally {
      window.clearTimeout(timeout)
    }
  }

  private async toError(response: Response) {
    let body: ApiErrorBody = {}
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      body = {}
    }
    return new TermousApiError(
      body.error?.message ?? `请求失败：${response.status}`,
      body.error?.code ?? 'HTTP_ERROR',
      response.status,
      body.error?.details,
    )
  }
}

export async function createApiFromRuntime() {
  const runtimeConfig = window.termous ? await window.termous.getConfig() : {}
  return new TermousApi(runtimeConfig)
}
