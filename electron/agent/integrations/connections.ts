import { readDirectory } from './directory.ts'
import { openIntegrationConnection } from './connectionFactory.ts'
import { type CallToolResult } from '@earendil-works/pi-mcp'
import { Compile } from 'typebox/compile'
import type { TSchema } from 'typebox'
import type { IntegrationHostConfig, IntegrationToolDefinition } from '../contracts/integrations.ts'
import { IntegrationScheduler } from './scheduling.ts'
import { IntegrationFailure, integrationDiagnostic } from './diagnostics.ts'
import { integrationConnectionError } from './connectionErrors.ts'

export type { IntegrationConnection, IntegrationConnectionOptions } from './connectionTypes.ts'
import type { IntegrationConnection, IntegrationConnectionOptions } from './connectionTypes.ts'

export class IntegrationConnections {
  private readonly pool = new Map<string, Promise<IntegrationConnection>>()
  private readonly ready = new Map<string, IntegrationConnection>()
  private readonly waiting = new Map<string, Set<symbol>>()
  private readonly progress = new Map<string, import('#common/agent-integrations').IntegrationConnectionStatus>()
  private readonly opening = new Map<string, AbortController>()
  private readonly closing = new Map<IntegrationConnection, Promise<void>>()
  private readonly starts = new IntegrationScheduler(2, 32, 1024 * 1024)
  private readonly requests = new IntegrationScheduler(8)
  private readonly shutdown = new AbortController()
  private revision = 0
  private readonly idleTimer: ReturnType<typeof setInterval>

  private readonly options: IntegrationConnectionOptions
  constructor(options: IntegrationConnectionOptions) {
    this.options = options
    this.idleTimer = setInterval(() => { void this.reap().catch(() => this.options.report?.('INTEGRATION_IDLE_CLOSE_FAILED')) }, 60_000)
    this.idleTimer.unref()
  }

  async acquire(config: IntegrationHostConfig, session: string, owner: string, signal?: AbortSignal): Promise<IntegrationConnection> {
    const key = JSON.stringify([config.source.id, config.source.revision, session, config.candidate_id ?? '', config.configuration?.network ?? null])
    for (const old of this.ready.values()) {
      // 候选握手不能提前关闭当前版本，普通调用也不能打断候选验证。
      if (!config.candidate_id && !old.config.candidate_id && old.key !== key && old.config.source.id === config.source.id && JSON.parse(old.key)[2] === session) this.retire(old)
    }
    this.shutdown.signal.throwIfAborted()
    signal?.throwIfAborted()
    if (this.ready.get(key)?.retired) throw new Error('INTEGRATION_RECONNECT_PENDING')
    if (this.ready.has(key) && this.ready.get(key)!.client.connectionState !== 'connected') throw new Error('INTEGRATION_SESSION_LOST')
    let pending = this.pool.get(key)
    if (!pending) {
      if (this.pool.size >= 16) {
        const idle = [...this.ready.values()].filter(value => !value.retired && !value.owners.size && value.serial.usage().active === 0 && value.serial.usage().queued === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0]
        if (!idle) throw new Error('INTEGRATION_CONNECTION_CAPACITY')
        // 真实关闭后才释放名额，并重新核验并发等待期间的容量。
        await this.remove(idle)
        return this.acquire(config, session, owner, signal)
      }
      const opening = new AbortController()
      this.opening.set(key, opening)
      const combined = AbortSignal.any([opening.signal, this.shutdown.signal])
      if (this.progress.size >= 32) {
        const old = [...this.progress.keys()].find(id => !this.pool.has(id))
        if (old) this.progress.delete(old)
      }
      const now = new Date().toISOString()
      this.progress.set(key, { source: config.source.id, revision: config.source.revision, session_id: session, state: 'queued', active: 0, queued: 1, status_revision: ++this.revision, started_at: now, updated_at: now })
      pending = Promise.resolve().then(() => this.starts.run(0, combined, async () => {
        const timeout = (config.configuration?.settings.startup_timeout_seconds ?? 120) * 1000
        const signal = AbortSignal.any([combined, AbortSignal.timeout(timeout)])
        const started = Date.now()
        this.phase(key, 'starting')
        try { return await this.connect(key, config, signal) }
        catch (error) {
          const diagnostic = { ...integrationDiagnostic(integrationConnectionError(error, signal, config.source.mcp?.transport === 'stdio')), phase: this.progress.get(key)?.state ?? 'starting', elapsed_ms: Date.now() - started, timeout_ms: timeout }
          const progress = this.progress.get(key)
          if (progress) this.progress.set(key, { ...progress, state: diagnostic.code === 'INTEGRATION_AUTH_REQUIRED' ? 'auth_required' : 'failed', queued: 0, diagnostic, status_revision: ++this.revision, updated_at: new Date().toISOString() })
          throw new IntegrationFailure(diagnostic)
        }
      }))
      this.pool.set(key, pending)
      void pending.then(value => { this.opening.delete(key); this.ready.set(key, value); this.phase(key, 'connected') }, error => {
        this.opening.delete(key)
        if (this.pool.get(key) === pending) this.pool.delete(key)
        if (this.progress.get(key)?.state === 'queued') {
          this.phase(key, 'failed')
          this.progress.get(key)!.diagnostic = integrationDiagnostic(error, 'queued')
        }
      })
    }
    const waiter = Symbol()
    const waiting = this.waiting.get(key) ?? new Set<symbol>()
    waiting.add(waiter)
    this.waiting.set(key, waiting)
    let stop: (() => void) | undefined
    try {
      const connection = signal ? await Promise.race([pending, new Promise<never>((_, reject) => {
        stop = () => reject(signal.reason)
        signal.addEventListener('abort', stop, { once: true })
        if (signal.aborted) stop()
      })]) : await pending
      signal?.throwIfAborted()
      connection.lastUsed = Date.now()
      connection.owners.add(owner)
      return connection
    } finally {
      if (stop) signal?.removeEventListener('abort', stop)
      waiting.delete(waiter)
      if (!waiting.size) { this.waiting.delete(key); this.opening.get(key)?.abort() }
    }
  }

  release(owner: string, source?: string) {
    for (const connection of this.ready.values()) {
      if (source && connection.config.source.id !== source) continue
      if (connection.owners.delete(owner)) connection.lastUsed = Date.now()
    }
  }

  async promote(connection: IntegrationConnection, config: IntegrationHostConfig, session: string) {
    if (connection.retired || this.ready.get(connection.key) !== connection) throw new Error('INTEGRATION_CONFIG_CHANGED')
    const key = JSON.stringify([config.source.id, config.source.revision, session, '', config.configuration?.network ?? null])
    if (connection.key === key) return
    const existing = this.pool.get(key)
    if (existing) {
      const published = await existing
      for (const owner of connection.owners) published.owners.add(owner)
      this.retire(connection)
      return
    }
    const progress = this.progress.get(connection.key)
    this.ready.delete(connection.key); this.pool.delete(connection.key); this.progress.delete(connection.key)
    connection.key = key; connection.config = config
    connection.directory = connection.directory.map(tool => ({ ...tool, source_revision: config.source.revision }))
    this.ready.set(key, connection); this.pool.set(key, Promise.resolve(connection))
    if (progress) this.progress.set(key, { ...progress, revision: config.source.revision, status_revision: ++this.revision, updated_at: new Date().toISOString() })
    // 发布成功后再接管当前版本的所有者；在途业务调用按原连接收尾。
    for (const old of this.ready.values()) {
      if (old === connection || old.config.candidate_id || old.config.source.id !== config.source.id || JSON.parse(old.key)[2] !== session) continue
      for (const owner of old.owners) connection.owners.add(owner)
      this.retire(old)
    }
  }

  private phase(key: string, state: import('#common/agent-integrations').IntegrationConnectionStatus['state']) {
    const current = this.progress.get(key)
    if (current) this.progress.set(key, { ...current, state, queued: 0,
      ...(state === 'connected' || state === 'disconnected' ? { diagnostic: undefined } : {}),
      status_revision: ++this.revision, updated_at: new Date().toISOString() })
  }

  status(): import('#common/agent-integrations').IntegrationConnectionStatus[] {
    return [...this.progress].map(([key, progress]) => {
      const value = this.ready.get(key)
      if (!value) return { ...progress }
      const state = value.retired ? 'closing' : value.client.connectionState === 'connected' ? 'connected' : 'disconnected'
      if (state !== progress.state) this.phase(key, state)
      return { ...this.progress.get(key)!, state, active: value.serial.usage().active, queued: value.serial.usage().queued }
    })
  }

  availability(source: string, revision: number, session: string, owner: string): string | undefined {
    const connection = [...this.ready.values()].find(value => !value.config.candidate_id && value.config.source.id === source && value.config.source.revision === revision && JSON.parse(value.key)[2] === session && value.owners.has(owner) && !value.retired)
    if (connection?.client.connectionState === 'connected') return undefined
    const status = this.status().find(value => value.source === source && value.revision === revision && value.session_id === session)
    return status?.diagnostic?.code ?? (status?.state === 'auth_required' ? 'INTEGRATION_AUTH_REQUIRED'
      : status?.state === 'disconnected' ? 'INTEGRATION_SESSION_LOST'
      : status?.state === 'closing' ? 'INTEGRATION_RECONNECT_PENDING' : 'INTEGRATION_PREPARING')
  }

  private retire(value: IntegrationConnection) {
    if (value.retired) return
    value.retired = true
    this.phase(value.key, 'closing')
    value.serial.close()
    void value.serial.whenIdle().then(() => this.remove(value)).catch(() => this.options.report?.('INTEGRATION_RETIRED_CLOSE_FAILED'))
  }

  async execute<T>(connection: IntegrationConnection, bytes: number, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (connection.retired) throw new Error('INTEGRATION_CONFIG_CHANGED')
    const combined = signal ? AbortSignal.any([signal, this.shutdown.signal]) : this.shutdown.signal
    return connection.serial.run(bytes, combined, () => this.requests.run(bytes, combined, async () => {
      connection.lastUsed = Date.now()
      if (connection.retired) throw new Error('INTEGRATION_CONFIG_CHANGED')
      if (connection.client.connectionState !== 'connected') throw new Error('INTEGRATION_SESSION_LOST')
      try { return await operation() } finally { connection.lastUsed = Date.now() }
    }))
  }

  async call(connection: IntegrationConnection, definition: IntegrationToolDefinition, args: Record<string, unknown>, signal?: AbortSignal,
    beforeDispatch?: () => Promise<void>, markDispatched?: () => void): Promise<CallToolResult> {
    return this.execute(connection, Buffer.byteLength(JSON.stringify(args)), signal, async () => {
      await beforeDispatch?.()
      signal?.throwIfAborted()
      if (connection.retired || connection.directoryRevision !== connection.publishedRevision) throw new Error('INTEGRATION_TOOL_CHANGED')
      const current = connection.directory.find(tool => tool.name === definition.name)
      if (!current || current.contract_hash !== definition.contract_hash || current.unavailable_reason) throw new Error('INTEGRATION_TOOL_CHANGED')
      if (!Compile(current.input_schema as TSchema).Check(args)) throw new Error('INTEGRATION_ARGUMENTS_INVALID')
      markDispatched?.()
      return connection.client.callTool(definition.name, args, { signal, timeoutMs: 10 * 60_000 })
    })
  }

  async refresh(owner:string,allowed:(config:IntegrationHostConfig)=>boolean,save:(config:IntegrationHostConfig,tools:IntegrationToolDefinition[])=>Promise<void>,signal?:AbortSignal) {
    const unavailable = new Map<string, string>()
    for (const connection of this.ready.values()) {
      if (connection.config.candidate_id) continue
      if (!allowed(connection.config)) { connection.owners.delete(owner);continue }
      if (!connection.owners.has(owner)) continue
      if (connection.retired || connection.client.connectionState !== 'connected') {
        unavailable.set(connection.config.source.id, 'INTEGRATION_SESSION_LOST'); continue
      }
      if (!connection.owners.has(owner) || connection.directoryRevision===connection.publishedRevision) continue
      try { await this.execute(connection,0,signal,async()=>{
        const revision=connection.directoryRevision
        const directory=await readDirectory(connection.client,connection.config,signal ?? this.shutdown.signal)
        await save(connection.config,directory)
        connection.directory=directory
        connection.publishedRevision=revision
      }) } catch {
        signal?.throwIfAborted()
        unavailable.set(connection.config.source.id, 'INTEGRATION_DIRECTORY_REFRESH_FAILED')
        this.options.report?.('INTEGRATION_DIRECTORY_REFRESH_FAILED')
      }
    }
    return unavailable
  }

  async invalidate(source: string) {
    for (const [key, controller] of this.opening) if (JSON.parse(key)[0] === source) controller.abort()
    const immediate:Promise<void>[]=[]
    for (const value of this.ready.values()) if (JSON.parse(value.key)[0]===source) {
      value.retired=true
      value.serial.close()
      if (!value.serial.usage().active) immediate.push(this.remove(value))
      else void value.serial.whenIdle().then(()=>this.remove(value)).catch(()=>this.options.report?.('INTEGRATION_RETIRED_CLOSE_FAILED'))
    }
    await Promise.all(immediate)
  }

  async close() {
    clearInterval(this.idleTimer)
    this.shutdown.abort()
    this.starts.close()
    this.requests.close()
    await Promise.allSettled([...this.pool.values()])
    const results = await Promise.allSettled([...this.ready.values()].map(value => this.remove(value)))
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (failures.length) throw Object.assign(new Error('INTEGRATION_CLOSE_FAILED'), { causes: failures })
  }

  private async reap() {
    for (const value of this.ready.values()) if (!value.owners.size && value.serial.usage().active === 0 && value.serial.usage().queued === 0 && Date.now() - value.lastUsed >= 10 * 60_000) await this.remove(value)
  }

  private remove(value: IntegrationConnection): Promise<void> {
    const previous = this.closing.get(value)
    if (previous) return previous
    if (this.ready.get(value.key)!==value) return Promise.resolve()
    value.retired = true
    value.serial.close()
    this.phase(value.key, 'closing')
    const closing = Promise.resolve().then(() => value.close()).then(() => {
      this.pool.delete(value.key)
      this.ready.delete(value.key)
      this.phase(value.key, 'disconnected')
    }).catch(error => {
      // 关闭未确认时保留占用及收尾入口，不能遗失进程与安装租约。
      const progress = this.progress.get(value.key)
      if (progress) this.progress.set(value.key, { ...progress, diagnostic: integrationDiagnostic(error, 'closing'), status_revision: ++this.revision, updated_at: new Date().toISOString() })
      throw error
    }).finally(() => this.closing.delete(value))
    this.closing.set(value, closing)
    return closing
  }

  private connect(key: string, config: IntegrationHostConfig, signal: AbortSignal) {
    return openIntegrationConnection(key, config, signal, this.options, state => this.phase(key, state))
  }
}
