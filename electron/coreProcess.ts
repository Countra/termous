import { app, BrowserWindow } from 'electron'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import type {
  AppConfig,
  CoreFatalEvent,
  CoreStatus,
  CoreStartupSnapshot,
  DataPortabilityRestartResult,
} from '#common/contracts'
import { AsyncSingleflight } from './asyncSingleflight'
import {
  clearObservedChildProcess,
  hasChildProcessExited,
  stopOwnedChildProcess,
  waitForChildProcessExit,
} from './childProcessLifecycle'
import {
  runManagedCorePortAttempts,
  spawnManagedCoreProcess,
  waitForManagedCoreStartupOutput,
  waitForManagedCoreFailureExit,
} from './coreProcessLaunch'
import { CoreStartupError, CoreStartupState } from './coreStartupState'
import { sanitizeCoreStartupText } from './coreStartupProtocol'
import { fetchCoreRuntimeProbe } from './coreRuntimeProbe'

export type CoreShutdownReason = 'frontend_exit' | 'application_update'

export type CoreRuntimeConfig = Required<AppConfig>
export type CoreRestartResult = Omit<DataPortabilityRestartResult, 'config'> & {
  config: CoreRuntimeConfig
}
export type { CoreFatalEvent } from '#common/contracts'

type CoreProcessState = Omit<CoreStatus, 'config'> & {
  config: CoreRuntimeConfig
}

const externalCoreDefaultPort = 8122
const packagedManagedCoreDefaultPort = 8152
const maxPortSwitches = 3
const heartbeatIntervalMs = 10_000
const heartbeatTimeoutMs = 30_000
const requestTimeoutMs = 5_000
const failedChildGracefulExitTimeoutMs = 2_000
const failedChildForceExitTimeoutMs = 2_000
const coreStartupFailureMessage = '核心服务启动失败，请查看错误详情和日志后重试。'

export interface CoreProcessManagerOptions {
  logger?: {
    info(message: string, fields?: Record<string, unknown>): void
    warn(message: string, fields?: Record<string, unknown>): void
    error(message: string, fields?: Record<string, unknown>): void
  }
}

export class CoreProcessManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private initializePromise: Promise<CoreRuntimeConfig> | null = null
  private config: CoreRuntimeConfig = {
    apiBaseUrl: process.env.TERMOUS_API_BASE_URL ?? `http://127.0.0.1:${externalCoreDefaultPort}`,
    apiToken: process.env.TERMOUS_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : ''),
    version: process.env.VITE_TERMOUS_APP_VERSION ?? app.getVersion(),
    managed: false,
  }
  private fatal: CoreFatalEvent | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatGeneration = 0
  private lastHeartbeatAt = Date.now()
  private shuttingDown = false
  private exitRequested = false
  private readonly stoppingChildren = new WeakSet<ChildProcessWithoutNullStreams>()
  private runtimeReady = false
  private readonly shutdownSingleflight = new AsyncSingleflight<boolean>()
  private readonly restoreRestartSingleflight = new AsyncSingleflight<CoreRestartResult>()
  private readonly statusListeners = new Set<(snapshot: CoreStartupSnapshot) => void>()
  private readonly startup = new CoreStartupState((snapshot) => this.publishStartupStatus(snapshot))
  private readonly options: CoreProcessManagerOptions

  constructor(options: CoreProcessManagerOptions = {}) {
    this.options = options
  }

  initialize() {
    if (this.exitRequested) return Promise.resolve(this.config)
    if (!this.initializePromise) {
      // 先登记 Promise 再发布同步状态，订阅者重入 initialize 时仍只启动一个 Core。
      this.initializePromise = Promise.resolve().then(() => {
        if (this.exitRequested) return this.config
        this.runtimeReady = false
        this.startup.begin(randomUUID(), Date.now())
        return this.initializeOnce()
      }).catch((error) => {
        if (!this.shuttingDown) this.raiseStartupFailure(error)
        return this.config
      })
    }
    return this.initializePromise
  }

  private async initializeOnce() {
    if (this.shouldUseExternalCore()) {
      this.config = {
        apiBaseUrl: process.env.TERMOUS_API_BASE_URL ?? `http://127.0.0.1:${externalCoreDefaultPort}`,
        apiToken: process.env.TERMOUS_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : ''),
        version: process.env.VITE_TERMOUS_APP_VERSION ?? app.getVersion(),
        managed: false,
      }
      this.startup.setExternal(Date.now())
      return this.config
    }
    const token = randomBytes(32).toString('base64url')
    const binaryPath = this.resolveCorePath()
    const binaryValidationError = this.validateCoreBinary(binaryPath)
    if (binaryValidationError) {
      this.raiseFatal(binaryValidationError)
      return this.config
    }
    const portStart = this.resolveManagedCorePortStart()
    const packaged = app.isPackaged
    const logDirectory = packaged ? app.getPath('logs') : undefined
    const attempts = await runManagedCorePortAttempts({
      portStart,
      maxPortSwitches,
      isStopping: () => this.shuttingDown,
      start: async (port) => {
        const apiBaseUrl = `http://127.0.0.1:${port}`
        await this.startManagedCore(binaryPath, apiBaseUrl, token, packaged, logDirectory)
      },
      stopFailedAttempt: () => this.finishFailedAttempt(),
    })
    if (attempts.status === 'cancelled') {
      return this.config
    }
    if (attempts.status === 'failed') {
      this.raiseStartupFailure(attempts.lastError)
      return this.config
    }
    const apiBaseUrl = `http://127.0.0.1:${attempts.port}`
    if (this.shuttingDown) {
      await this.stopChildOnly()
      return this.config
    }
    this.config = { apiBaseUrl, apiToken: token, version: process.env.VITE_TERMOUS_APP_VERSION ?? app.getVersion(), managed: true }
    this.runtimeReady = true
    this.startup.ready(Date.now())
    this.startHeartbeat()
    return this.config
  }

  getConfig() {
    return this.config
  }

  status(): CoreProcessState {
    return {
      config: this.config,
      fatal: this.fatal,
      pid: this.child?.pid,
      startup: this.getStartupStatus(),
    }
  }

  getFatal() {
    return this.fatal
  }

  getStartupStatus() {
    return this.startup.getSnapshot()
  }

  onStatusChanged(listener: (snapshot: CoreStartupSnapshot) => void) {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  async getRuntimeVersion() {
    const config = await this.initialize()
    try {
      const runtime = await fetchCoreRuntimeProbe(config.apiBaseUrl, config.apiToken, requestTimeoutMs)
      return runtime?.version ?? null
    } catch {
      return null
    }
  }

  shutdownGracefully(reason: CoreShutdownReason = 'frontend_exit') {
    if (reason === 'frontend_exit') {
      this.exitRequested = true
      this.shuttingDown = true
    }
    return this.shutdownSingleflight.run(() => this.shutdownOnce(reason))
  }

  private async shutdownOnce(reason: CoreShutdownReason) {
    this.shuttingDown = true
    this.stopHeartbeat()
    if (!this.child) {
      return true
    }
    if (!this.config.managed || !this.runtimeReady) {
      try {
        await this.stopChildOnly()
        return true
      } catch {
        return false
      }
    }
    try {
      await this.fetchWithTimeout('/api/v1/runtime/shutdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Termous-Token': this.config.apiToken,
        },
        body: JSON.stringify({ reason }),
      })
    } catch {
      // 退出阶段后端可能已经停止，后续等待进程退出即可。
    }
    const exited = await this.waitForExit(8_000)
    if (!exited && this.child && !hasChildProcessExited(this.child)) {
      // 更新安装会在失败后保留应用，必须恢复 Core 的健康监测并允许再次关闭。
      this.shuttingDown = this.exitRequested
      if (!this.exitRequested && this.config.managed) {
        this.startHeartbeat()
      }
    }
    return exited
  }

  restartAfterRestore(): Promise<CoreRestartResult> {
    return this.restoreRestartSingleflight.run(() => this.restartAfterRestoreOnce())
  }

  private async restartAfterRestoreOnce(): Promise<CoreRestartResult> {
    await this.initialize()
    this.assertNotExiting()
    if (!this.config.managed) {
      return { restarted: false, requires_manual_restart: true, config: this.config }
    }
    this.shuttingDown = true
    this.stopHeartbeat()
    try {
      const response = await this.fetchWithTimeout('/api/v1/runtime/shutdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Termous-Token': this.config.apiToken,
        },
        body: JSON.stringify({ reason: 'data_restore' }),
      })
      if (!response.ok) {
        throw new Error('核心服务拒绝恢复重启请求')
      }
      if (!await this.waitForExit(8_000)) {
        throw new Error('核心服务未能安全退出')
      }
    } catch (error) {
      this.shuttingDown = this.exitRequested
      if (!this.exitRequested && this.child && !hasChildProcessExited(this.child)) {
        this.startHeartbeat()
      }
      throw error
    }
    this.assertNotExiting()
    this.child = null
    this.initializePromise = null
    this.fatal = null
    this.shuttingDown = false
    const config = await this.initialize()
    this.assertNotExiting()
    const fatal = this.getFatal() as CoreFatalEvent | null
    if (fatal) {
      throw new Error(fatal.message)
    }
    return { restarted: true, requires_manual_restart: false, config }
  }

  async recoverAfterFailedUpdateInstall(): Promise<CoreRuntimeConfig> {
    this.assertNotExiting()
    if (!this.config.managed) {
      // 外部 Core 不受桌面进程管理，安装失败后只需恢复本地生命周期标记。
      this.shuttingDown = false
      return this.config
    }
    if (this.child && !hasChildProcessExited(this.child)) {
      this.shuttingDown = false
      this.startHeartbeat()
      return this.config
    }

    this.child = null
    this.initializePromise = null
    this.fatal = null
    this.shuttingDown = false
    const config = await this.initialize()
    this.assertNotExiting()
    const fatal = this.getFatal() as CoreFatalEvent | null
    const recoveredChild = this.child as ChildProcessWithoutNullStreams | null
    if (
      fatal
      || !config.managed
      || !recoveredChild
      || hasChildProcessExited(recoveredChild)
    ) {
      throw new Error(fatal?.message ?? '核心服务恢复失败')
    }
    return config
  }

  private shouldUseExternalCore() {
    return Boolean(process.env.VITE_DEV_SERVER_URL || process.env.TERMOUS_API_BASE_URL)
  }

  private resolveManagedCorePortStart() {
    return app.isPackaged ? packagedManagedCoreDefaultPort : externalCoreDefaultPort
  }

  private resolveCorePath() {
    if (process.env.TERMOUS_CORE_PATH) {
      return process.env.TERMOUS_CORE_PATH
    }
    const binary = process.platform === 'win32' ? 'termous-core.exe' : 'termous-core'
    if (!app.isPackaged) {
      return path.join(process.env.APP_ROOT, 'build', 'core', binary)
    }
    const executableDir = path.dirname(process.execPath)
    return process.platform === 'darwin'
      ? path.resolve(executableDir, '..', binary)
      : path.join(executableDir, binary)
  }

  private validateCoreBinary(binaryPath: string): CoreFatalEvent | null {
    if (existsSync(binaryPath)) {
      return null
    }
    return {
      title: '后端连接异常',
      message: coreStartupFailureMessage,
      code: 'CORE_BINARY_NOT_FOUND',
    }
  }

  private describeStartupError(error: unknown) {
    if (error instanceof CoreStartupError) return error.message
    const startupError = error as NodeJS.ErrnoException | undefined
    if (startupError?.code === 'ENOENT') return '未找到核心服务程序，请检查应用安装文件。'
    if (startupError?.code === 'EACCES' || startupError?.code === 'EPERM') return '没有权限启动核心服务，请检查程序文件和安全软件设置。'
    return coreStartupFailureMessage
  }

  private assertNotExiting() {
    if (this.exitRequested) throw new Error('应用正在退出，已取消核心服务恢复')
  }

  private raiseStartupFailure(error: unknown) {
    const failure = this.startup.getPendingFailure()
      ?? (error instanceof CoreStartupError ? error.failure : {
        code: 'CORE_START_FAILED', message: this.describeStartupError(error),
      })
    this.raiseFatal({
      title: failure.code.startsWith('DB_') ? '数据库处理失败' : '后端连接异常',
      message: failure.message, code: failure.code, details: failure.details,
    })
  }

  private async startManagedCore(
    binaryPath: string,
    apiBaseUrl: string,
    token: string,
    packaged: boolean,
    logDirectory?: string,
  ) {
    const addr = new URL(apiBaseUrl)
    const host = addr.hostname || '127.0.0.1'
    const port = addr.port
    const portNumber = Number(port)
    const instanceId = randomUUID()
    this.startup.beginInstance(instanceId, Date.now())
    if (!await isPortAvailable(host, portNumber)) {
      throw new CoreStartupError({ code: 'CORE_BIND_FAILED', message: '核心服务端口被占用。' })
    }
    if (this.shuttingDown) {
      throw new Error('核心服务启动已取消')
    }
    let ready = false
    const child = spawnManagedCoreProcess({
      binaryPath,
      addr: `${host}:${port}`,
      token,
      packaged,
      logDirectory,
      environment: process.env,
      parentPid: process.pid,
      startupInstance: instanceId,
      onStartupEvent: (event) => {
        if (this.startup.accept(event, Date.now()) && event.error && event.error.code !== 'CORE_BIND_FAILED') {
          this.raiseStartupFailure(new CoreStartupError(event.error))
        }
      },
      onStartupProtocolError: (reason) => {
        this.options.logger?.warn('核心服务启动状态协议异常', { instance_id: instanceId, reason })
      },
    })
    this.child = child
    this.startup.bindPID(child.pid)
    child.once('error', (error) => {
      if (this.child === child && !this.shuttingDown && !this.stoppingChildren.has(child) && ready) {
        this.raiseFatal({ title: '后端连接异常', message: sanitizeCoreStartupText(error.message, 2048), code: 'CORE_PROCESS_ERROR' })
      }
    })
    child.once('exit', (code, signal) => {
      if (this.child !== child) {
        return
      }
      this.child = null
      this.stopHeartbeat()
      if (!this.shuttingDown && !this.stoppingChildren.has(child) && ready) {
        this.raiseFatal({
          title: '后端连接异常',
          message: `Termous Core 已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`,
          code: 'CORE_PROCESS_EXITED',
        })
      }
    })
    if (!child.pid) {
      throw new Error('核心服务进程未创建')
    }
    await this.waitUntilReady(apiBaseUrl, token, child)
    if (this.child !== child || hasChildProcessExited(child)) {
      await waitForManagedCoreStartupOutput(child)
      throw new CoreStartupError(this.startup.getPendingFailure() ?? {
        code: 'CORE_PROCESS_EXITED', message: '核心服务在就绪确认时退出，请查看启动日志。',
      })
    }
    ready = true
    this.lastHeartbeatAt = Date.now()
  }

  private async waitUntilReady(
    apiBaseUrl: string,
    token: string,
    child: ChildProcessWithoutNullStreams,
  ) {
    const expectedPID = child.pid
    while (true) {
      if (this.shuttingDown) {
        throw new Error('核心服务启动已取消')
      }
      if (this.child !== child || hasChildProcessExited(child)) {
        // exit 可能先于 stderr 最后一个事件到达，有限等待输出排空以保留具体原因。
        await waitForManagedCoreStartupOutput(child)
        const failure = this.startup.getPendingFailure()
        if (failure) throw new CoreStartupError(failure)
        throw new CoreStartupError({
          code: 'CORE_PROCESS_EXITED', message: '核心服务在启动完成前退出，数据库处理结果尚未确认。',
          details: `code=${child.exitCode ?? 'null'}, signal=${child.signalCode ?? 'null'}`,
        })
      }
      const failure = this.startup.getPendingFailure()
      if (failure) throw new CoreStartupError(failure)
      this.startup.tick(Date.now())
      if (this.startup.hasReadyTimedOut(Date.now())) {
        throw new CoreStartupError({ code: 'CORE_START_TIMEOUT', message: '等待核心服务就绪超时，请查看启动日志。' })
      }
      try {
        const status = await fetchCoreRuntimeProbe(apiBaseUrl, token, 1200)
        if (status?.pid === expectedPID) {
          const pendingFailure = this.startup.getPendingFailure()
          if (pendingFailure) throw new CoreStartupError(pendingFailure)
          return
        }
      } catch (error) {
        if (error instanceof CoreStartupError) throw error
        // ready 轮询阶段允许短暂失败，直到超时；必须等到新进程自身响应。
      }
      await delay(250)
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.lastHeartbeatAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat()
    }, heartbeatIntervalMs)
  }

  private stopHeartbeat() {
    this.heartbeatGeneration += 1
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private async sendHeartbeat() {
    if (this.shuttingDown || !this.config.managed || !this.child || !this.runtimeReady) {
      return
    }
    const generation = this.heartbeatGeneration
    const child = this.child
    const config = this.config
    const stillCurrent = () => generation === this.heartbeatGeneration && this.child === child
      && this.config === config && !this.shuttingDown
    try {
      const response = await this.fetchWithTimeout('/api/v1/runtime/heartbeat', {
        method: 'POST',
        headers: { 'X-Termous-Token': this.config.apiToken },
      })
      if (!stillCurrent()) return
      if (response.ok) {
        this.lastHeartbeatAt = Date.now()
        return
      }
    } catch {
      // 下面按最近一次成功心跳判断是否超过 30 秒。
    }
    if (!stillCurrent()) return
    if (Date.now() - this.lastHeartbeatAt > heartbeatTimeoutMs) {
      this.raiseFatal({
        title: '后端连接异常',
        message: 'Termous Core 超过 30 秒无响应。',
        code: 'CORE_HEARTBEAT_TIMEOUT',
      })
    }
  }

  private fetchWithTimeout(pathname: string, init: RequestInit = {}) {
    return this.fetchUrlWithTimeout(new URL(pathname, this.config.apiBaseUrl).toString(), init, requestTimeoutMs)
  }

  private async fetchUrlWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      // 关闭与心跳接口只读取状态码，不保留未消费的响应体连接。
      controller.abort()
    }
  }

  private async waitForExit(
    timeoutMs: number,
    child = this.child,
  ) {
    if (!child) {
      return true
    }
    if (hasChildProcessExited(child)) {
      this.child = clearObservedChildProcess(this.child, child)
      return true
    }
    const exited = await waitForChildProcessExit(child, timeoutMs)
    if (exited) {
      this.child = clearObservedChildProcess(this.child, child)
    }
    return exited
  }

  private async stopChildOnly() {
    this.stopHeartbeat()
    const child = this.child
    if (!child) return
    // 自动清理只标记所属子进程，不能在异步结束时覆盖用户并发发出的退出意图。
    this.stoppingChildren.add(child)
    try {
      await stopOwnedChildProcess(child, {
        gracefulTimeoutMs: failedChildGracefulExitTimeoutMs,
        forceTimeoutMs: failedChildForceExitTimeoutMs,
      })
      this.child = clearObservedChildProcess(this.child, child)
    } finally {
      this.stoppingChildren.delete(child)
    }
  }

  private raiseFatal(event: CoreFatalEvent) {
    if (this.fatal) return
    this.startup.fail(event, Date.now())
    const failure = this.startup.getSnapshot().failure
    this.fatal = failure ? { ...event, ...failure } : event
    this.stopHeartbeat()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('core:fatal', this.fatal)
    }
  }

  private async finishFailedAttempt() {
    const child = this.child
    if (child && this.startup.getPendingFailure() && !this.shuttingDown) {
      // Core 先报告失败，再释放资源和刷新日志；Windows kill 会直接终止进程，需先留出自行退出窗口。
      const exited = await waitForManagedCoreFailureExit(child, () => this.shuttingDown)
      if (!exited && !this.shuttingDown) {
        this.options.logger?.warn('核心服务失败后的资源清理超时，将终止所属进程', {
          instance_id: this.getStartupStatus().instanceId,
        })
      }
    }
    try {
      await this.stopChildOnly()
    } catch (error) {
      this.options.logger?.error('核心服务失败后的进程清理未完成', {
        instance_id: this.getStartupStatus().instanceId,
        error: sanitizeCoreStartupText(error instanceof Error ? error.message : '未知进程清理错误', 2048),
      })
      throw error
    }
  }

  private publishStartupStatus(snapshot: CoreStartupSnapshot) {
    const fields = {
      attempt_id: snapshot.attemptId, instance_id: snapshot.instanceId,
      phase: snapshot.phase, database_status: snapshot.database?.status,
      attention: snapshot.attention, error_code: snapshot.failure?.code,
    }
    if (snapshot.failure) this.options.logger?.error('核心服务启动失败', fields)
    else if (snapshot.attention) this.options.logger?.warn('核心服务启动等待时间较长', fields)
    else this.options.logger?.info('核心服务启动状态更新', fields)
    for (const listener of this.statusListeners) {
      try {
        listener(structuredClone(snapshot))
      } catch {
        this.options.logger?.warn('核心服务启动状态订阅处理失败', { attempt_id: snapshot.attemptId })
      }
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isPortAvailable(host: string, port: number) {
  return new Promise<boolean>((resolve, reject) => {
    if (!Number.isInteger(port) || port <= 0) {
      reject(new Error('核心服务端口无效'))
      return
    }
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') resolve(false)
      else reject(error)
    })
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}
