import { createHash } from 'node:crypto'
import { McpClient, StreamableHttpTransport, type Tool, type McpTransport, type CallToolResult, type AuthProvider } from '@earendil-works/pi-mcp'
import { Compile } from 'typebox/compile'
import type { TSchema } from 'typebox'
import type { IntegrationHostConfig, IntegrationToolDefinition } from '../contracts/integrations.ts'
import { IntegrationScheduler } from './scheduling.ts'
import { IntegrationHTTPBoundary, integrationMessageLimit } from './httpBoundary.ts'
import { integrationEnvironment } from './environment.ts'
import { validateIntegrationSchema } from './schema.ts'
import { SupervisedStdioTransport } from './stdioTransport.ts'
import { integrationConnectionError } from './connectionErrors.ts'

export interface IntegrationConnection {
  key: string
  generation: string
  client: McpClient
  directory: IntegrationToolDefinition[]
  serial: IntegrationScheduler
  lastUsed: number
  owners: Set<string>
  config: IntegrationHostConfig
  directoryRevision: number
  publishedRevision: number
  retired?:boolean
  close(): Promise<void>
}

export interface IntegrationConnectionOptions {
  verifyLaunch?(config: IntegrationHostConfig, signal: AbortSignal): Promise<void>
  ensureSupervised(): Promise<void>
  superviseGroup?(pid: number, release: boolean): Promise<void>
  fetch?: typeof fetch
  environment?: Record<string, string | undefined>
  authProvider?(config: IntegrationHostConfig): AuthProvider
  report?(code:string):void
}

export class IntegrationConnections {
  private readonly pool = new Map<string, Promise<IntegrationConnection>>()
  private readonly ready = new Map<string, IntegrationConnection>()
  private readonly waiting = new Map<string, Set<symbol>>()
  private readonly opening = new Map<string, AbortController>()
  private readonly starts = new IntegrationScheduler(2, 32, 1024 * 1024)
  private readonly requests = new IntegrationScheduler(8)
  private readonly shutdown = new AbortController()
  private readonly idleTimer: ReturnType<typeof setInterval>

  private readonly options: IntegrationConnectionOptions
  constructor(options: IntegrationConnectionOptions) {
    this.options = options
    this.idleTimer = setInterval(() => { void this.reap().catch(() => this.options.report?.('INTEGRATION_IDLE_CLOSE_FAILED')) }, 60_000)
    this.idleTimer.unref()
  }

  async acquire(config: IntegrationHostConfig, session: string, owner: string, signal?: AbortSignal): Promise<IntegrationConnection> {
    const key = JSON.stringify([config.source.id, config.source.revision, session])
    this.shutdown.signal.throwIfAborted()
    signal?.throwIfAborted()
    if (this.ready.get(key)?.retired) throw new Error('INTEGRATION_RECONNECT_PENDING')
    if (this.ready.has(key) && this.ready.get(key)!.client.connectionState !== 'connected') throw new Error('INTEGRATION_SESSION_LOST')
    let pending = this.pool.get(key)
    if (!pending) {
      let evicted: Promise<void> | undefined
      if (this.pool.size >= 16) {
        const idle = [...this.ready.values()].filter(value => !value.owners.size && value.serial.usage().active === 0 && value.serial.usage().queued === 0).sort((a, b) => a.lastUsed - b.lastUsed)[0]
        if (!idle) throw new Error('INTEGRATION_CONNECTION_CAPACITY')
        // 同步移出旧项并预留新名额，不能在 await 关闭期间被其他调用突破容量。
        evicted = this.remove(idle)
      }
      const opening = new AbortController()
      this.opening.set(key, opening)
      const combined = AbortSignal.any([opening.signal, this.shutdown.signal, AbortSignal.timeout(30_000)])
      pending = Promise.resolve(evicted).then(()=>this.starts.run(0, combined, () => this.connect(key, config, combined)))
        .catch(error => { throw integrationConnectionError(error, combined, config.source.mcp?.transport === 'stdio') })
      this.pool.set(key, pending)
      void pending.then(value => { this.opening.delete(key); this.ready.set(key, value) }, () => {
        this.opening.delete(key)
        if (this.pool.get(key) === pending) this.pool.delete(key)
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

  release(owner: string) {
    for (const connection of this.ready.values()) {
      if (connection.owners.delete(owner)) connection.lastUsed = Date.now()
    }
  }

  status(): import('#common/agent-integrations').IntegrationConnectionStatus[] {
    return [...this.ready.values()].map(value => ({source:value.config.source.id,revision:value.config.source.revision,
      state:value.retired ? 'closing' : value.client.connectionState === 'connected' ? 'connected' : 'disconnected',
      active:value.serial.usage().active,queued:value.serial.usage().queued}))
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
    for (const value of this.ready.values()) if (JSON.parse(value.key)[0]===source && !value.retired) {
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

  private async remove(value: IntegrationConnection) {
    if (this.ready.get(value.key)!==value) return
    this.pool.delete(value.key)
    this.ready.delete(value.key)
    await value.close()
  }

  private async connect(key: string, config: IntegrationHostConfig, signal: AbortSignal): Promise<IntegrationConnection> {
    const settings = config.source.mcp
    if (!settings) throw new Error('INTEGRATION_CONFIG_INVALID')
    let transport: McpTransport
    if (settings.transport === 'stdio') {
      if (settings.dependency_id && !config.launch) throw new Error('INTEGRATION_DEPENDENCY_NOT_READY')
      if (settings.dependency_id) {
        if (!this.options.verifyLaunch) throw new Error('INTEGRATION_DEPENDENCY_NOT_READY')
        await this.options.verifyLaunch(config, signal)
      }
      await this.options.ensureSupervised()
      signal.throwIfAborted()
      transport = new SupervisedStdioTransport({ command: config.launch?.command ?? settings.command!, args: config.launch?.args ?? settings.args, cwd: settings.cwd,
        inheritEnv: false, env: integrationEnvironment(this.options.environment ?? process.env, config.secret.environment),
        stderr: 'pipe', maxStderrBytes: 32 * 1024, maxMessageBytes: integrationMessageLimit }, this.options.superviseGroup)
    } else {
      const boundary = new IntegrationHTTPBoundary(settings.url!, this.options.fetch)
      const authProvider = settings.auth === 'oauth' ? this.options.authProvider?.(config) : undefined
      if (settings.auth === 'oauth' && !authProvider) throw new Error('INTEGRATION_AUTH_REQUIRED')
      transport = boundary.wrap(new StreamableHttpTransport({ url: settings.url!, headers: config.secret.headers, fetch: boundary.fetch,
        authProvider, maxMessageBytes: integrationMessageLimit, reconnect: { maxRetries: 0 } }))
    }
    const client = new McpClient({ name: 'termous-integrations', version: '1.0.0', capabilities: {}, requestTimeoutMs: 15_000 })
    const abort = () => { void client.close().catch(() => { /* 初始化失败由下方关闭路径收口。 */ }) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted()
      await client.connect(transport)
      signal.throwIfAborted()
      const directory = await readDirectory(client, config, signal)
      const serial = new IntegrationScheduler(1, 32, 1024 * 1024)
      const connection:IntegrationConnection = { key, generation: crypto.randomUUID(), client, directory, serial, config,
        directoryRevision:0,publishedRevision:0,lastUsed:Date.now(),owners:new Set(),close:async()=>{unsubscribe();serial.close();await client.close()} }
      // 通知只使当前声明失效；实际读取与发布放在下一次模型请求边界，避免通知风暴累积任务。
      const unsubscribe=client.onNotification('notifications/tools/list_changed',()=>{connection.directoryRevision=Math.min(connection.directoryRevision+1,Number.MAX_SAFE_INTEGER)})
      return connection
    } catch (error) { await client.close(); throw error }
    finally { signal.removeEventListener('abort', abort) }
  }
}

async function readDirectory(client: McpClient, config: IntegrationHostConfig, signal: AbortSignal): Promise<IntegrationToolDefinition[]> {
  if (!client.serverCapabilities?.tools) return []
  const result: IntegrationToolDefinition[] = []
  const cursors = new Set<string>()
  const names = new Set<string>()
  let cursor: string | undefined
  let bytes = 0
  do {
    const page = await client.request<{ tools: Tool[]; nextCursor?: string }>('tools/list', cursor ? { cursor } : {}, { signal })
    if (!Array.isArray(page.tools)) throw new Error('INTEGRATION_DIRECTORY_INVALID')
    for (const tool of page.tools) {
      const raw = JSON.stringify(tool)
      bytes += Buffer.byteLength(raw)
      if (result.length >= 1024 || bytes > 4 * 1024 * 1024) throw new Error('INTEGRATION_DIRECTORY_TOO_LARGE')
      if (!tool.name || tool.name.length > 256 || names.has(tool.name)) throw new Error('INTEGRATION_TOOL_NAME_INVALID')
      names.add(tool.name)
      let unavailable: string | undefined
      try {
        validateIntegrationSchema(tool.inputSchema)
      } catch { unavailable = 'INTEGRATION_TOOL_SCHEMA_UNSUPPORTED' }
      result.push({ source_id: config.source.id, source_revision: config.source.revision, name: tool.name,
        title: tool.title?.slice(0, 512), description: tool.description?.slice(0, 8192), input_schema: tool.inputSchema,
        contract_hash: createHash('sha256').update(raw).digest('hex'), ...(unavailable ? { unavailable_reason: unavailable } : {}) })
    }
    cursor = page.nextCursor
    if (cursor && cursors.has(cursor)) throw new Error('INTEGRATION_DIRECTORY_CURSOR_INVALID')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return result
}
