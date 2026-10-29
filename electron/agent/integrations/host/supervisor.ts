import { shell, utilityProcess, type UtilityProcess } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import type { IntegrationRuntimePort, IntegrationOperation } from '../../contracts/integrationIPC.ts'
import type { IntegrationRunContext } from '../../contracts/integrations.ts'
import { isRecord } from '../../contracts/validation.ts'
import { IntegrationCoreClient, readCoreJSON, type IntegrationCoreConfig } from '../coreClient.ts'
import { integrationEnvironment } from '../environment.ts'
import { validateOAuthURL } from '../oauthBoundary.ts'

interface Pending {
  bytes: number
  login: boolean
  resolve(value: unknown): void
  reject(reason: Error): void
  dispose(): void
}
interface Host {
  child: UtilityProcess
  core: IntegrationCoreClient
  pid?: number
  ready: Promise<void>
  rejectReady(reason: Error): void
  exit: Promise<void>
}
export interface IntegrationSupervisorOptions {
  modulePath: string
  cwd: string
  configuration(): Promise<IntegrationCoreConfig>
  report(code: string): void
}

export class IntegrationHostSupervisor implements IntegrationRuntimePort {
  private readonly options: IntegrationSupervisorOptions
  private host?: Host
  private starting?: Promise<Host>
  private readonly pending = new Map<string, Pending>()
  private queuedBytes = 0
  private closing = false

  constructor(options: IntegrationSupervisorOptions) { this.options = options }

  async request(context: IntegrationRunContext, operation: IntegrationOperation, signal?: AbortSignal) {
    if (operation.action==='directory' && !this.host) {
      const core=new IntegrationCoreClient(await this.options.configuration())
      if (!(await core.sources(context,signal)).length) {
        const directory={sources:[],tools:[]}
        const fingerprint=createHash('sha256').update(JSON.stringify(directory)).digest('hex')
        return operation.fingerprint===fingerprint ? {unchanged:true} : {...directory,fingerprint}
      }
    }
    return this.rpc({ context, operation }, signal)
  }
  test(source: string, revision: number, signal?: AbortSignal) { return this.rpc({ operation: 'test', source, revision }, signal) }
  reconnect(source: string, revision: number, signal?: AbortSignal) { return this.rpc({ operation: 'reconnect', source, revision }, signal) }
  status() { return this.host ? this.rpc({operation:'status'}) : Promise.resolve([]) }
  login(source: string, revision: number, signal?: AbortSignal) { return this.rpc({ operation: 'login', source, revision }, signal) }
  async source(id: string) {
    const config = await this.options.configuration()
    const response = await fetch(new URL('/api/v1/agent/integrations', config.baseURL), {
      headers: { 'X-Termous-Token': config.token }, signal: AbortSignal.timeout(15_000), redirect: 'error', cache: 'no-store',
    })
    if (!response.ok) throw new Error('INTEGRATION_SOURCE_UNAVAILABLE')
    const sources = await readCoreJSON(response) as import('#common/agent-integrations').AgentIntegrationSource[]
    const source = sources.find(value => value.id === id)
    if (!source) throw new Error('INTEGRATION_SOURCE_UNAVAILABLE')
    return source
  }
  async invalidate(source: string) { if (this.host) await this.rpc({ operation: 'invalidate', source }) }
  release(run: string) { this.host?.child.postMessage({ type: 'release', run }) }

  async close() {
    this.closing = true
    const host = this.host ?? await this.starting?.catch(() => undefined)
    this.failPending('INTEGRATION_HOST_CLOSED')
    try {
      if (!host) return
      host.child.postMessage({ type: 'close' })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([host.exit, new Promise<void>(resolve => { timer = setTimeout(() => { host.child.kill(); resolve() }, 5000) })])
      } finally { clearTimeout(timer) }
      if (host.pid) await host.core.supervise(host.pid, true)
    } finally { this.host = undefined; this.closing = false }
  }

  private async rpc(payload: Record<string, unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const bytes = Buffer.byteLength(JSON.stringify(payload))
    if (this.closing) throw new Error('INTEGRATION_HOST_CLOSED')
    if (this.pending.size >= 64 || bytes > 256 * 1024 || bytes + this.queuedBytes > 2 * 1024 * 1024) throw new Error('INTEGRATION_QUEUE_FULL')
    // 在启动等待前占用名额，避免大量同时唤醒越过队列上限。
    const id = randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      let sent: Host | undefined
      const abort = () => {
        sent?.child.postMessage({ type: 'cancel', id })
        this.settle(id, undefined, new DOMException('请求已取消', 'AbortError'))
      }
      this.pending.set(id, { bytes, login: payload.operation === 'login', resolve, reject, dispose: () => signal?.removeEventListener('abort', abort) })
      this.queuedBytes += bytes
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) { abort(); return }
      void this.ensureHost().then(host => {
        if (!this.pending.has(id)) return
        sent = host
        host.child.postMessage({ type: 'request', id, ...payload })
      }).catch(error => this.settle(id, undefined, error instanceof Error ? error : new Error('INTEGRATION_HOST_UNAVAILABLE')))
    })
  }

  private async ensureHost() {
    if (this.closing) throw new Error('INTEGRATION_HOST_CLOSED')
    if (this.host) { await this.host.ready; return this.host }
    this.starting ??= this.start().finally(() => { this.starting = undefined })
    return this.starting
  }

  private async start(): Promise<Host> {
    const config = await this.options.configuration()
    if (this.closing) throw new Error('INTEGRATION_HOST_CLOSED')
    const child = utilityProcess.fork(this.options.modulePath, [], { cwd: this.options.cwd,
      env: integrationEnvironment(process.env), execArgv: [], stdio: 'ignore', serviceName: 'Termous Assistant Extensions' })
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    let resolveExit!: () => void
    const host: Host = { child, core: new IntegrationCoreClient(config),
      ready: new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject }),
      rejectReady: error => rejectReady(error), exit: new Promise<void>(resolve => { resolveExit = resolve }) }
    this.host = host
    const timer = setTimeout(() => { rejectReady(new Error('INTEGRATION_HOST_START_TIMEOUT')); child.kill() }, 20_000)
    timer.unref()
    child.once('spawn', () => { host.pid = child.pid; child.postMessage({ type: 'initialize', config }) })
    child.on('message', (message: unknown) => {
      if (!isRecord(message)) return
      if (message.type==='diagnostic' && typeof message.code==='string' && /^INTEGRATION_[A-Z_]{1,100}$/u.test(message.code)) {this.options.report(message.code);return}
      if (message.type === 'ready') { clearTimeout(timer); resolveReady(); return }
      if (message.type === 'failed') { clearTimeout(timer); rejectReady(new Error('INTEGRATION_HOST_START_FAILED')); return }
      if (message.type === 'oauth_open' && typeof message.id === 'string' && this.pending.get(message.id)?.login) {
        const id = message.id
        void Promise.resolve().then(async () => {
          if (typeof message.url !== 'string' || message.url.length > 8192) throw new Error('INTEGRATION_OAUTH_ENDPOINT_INVALID')
          const url = validateOAuthURL(message.url)
          if (this.pending.get(id)?.login) await shell.openExternal(url.href)
        }).catch(() => {
          child.postMessage({ type: 'cancel', id })
          this.settle(id, undefined, new Error('INTEGRATION_OAUTH_BROWSER_FAILED'))
        })
        return
      }
      if (message.type === 'result' && typeof message.id === 'string') {
        if (Buffer.byteLength(JSON.stringify(message)) > 8 * 1024 * 1024) { this.settle(message.id, undefined, new Error('INTEGRATION_RESPONSE_TOO_LARGE')); return }
        this.settle(message.id, message.value, typeof message.error === 'string' ? new Error(message.error) : undefined)
      }
    })
    child.once('exit', () => {
      clearTimeout(timer)
      rejectReady(new Error('INTEGRATION_HOST_EXITED'))
      if (this.host === host) { this.host = undefined; this.failPending('INTEGRATION_HOST_EXITED') }
      if (host.pid) void host.core.supervise(host.pid, true).catch(() => this.options.report('INTEGRATION_PROCESS_RELEASE_FAILED'))
      resolveExit()
    })
    await host.ready
    return host
  }

  private settle(id: string, value?: unknown, error?: Error) {
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    this.queuedBytes -= request.bytes
    request.dispose()
    if (error) request.reject(error)
    else request.resolve(value)
  }
  private failPending(code: string) { for (const id of this.pending.keys()) this.settle(id, undefined, new Error(code)) }
}
