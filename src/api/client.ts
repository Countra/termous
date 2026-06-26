import type {
  ApiErrorBody,
  AppConfig,
  CredentialInput,
  CredentialView,
  Host,
  HostGroup,
  HostInput,
  KnownHost,
  Language,
  LocalShell,
  Session,
  Settings,
  TerminalSettings,
} from '../types/domain'

const DEFAULT_CONFIG: AppConfig = {
  apiBaseUrl: import.meta.env.VITE_TERMOUS_API_BASE_URL ?? 'http://127.0.0.1:8122',
  apiToken: import.meta.env.VITE_TERMOUS_API_TOKEN ?? (import.meta.env.DEV ? 'dev-token' : ''),
}

export class TermousApiError extends Error {
  code: string
  status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'TermousApiError'
    this.code = code
    this.status = status
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

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    try {
      const response = await fetch(new URL(path, this.config.apiBaseUrl), {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiToken ? { 'X-Termous-Token': this.config.apiToken } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
    )
  }
}

export async function createApiFromRuntime() {
  const runtimeConfig = window.termous ? await window.termous.getConfig() : {}
  return new TermousApi(runtimeConfig)
}
