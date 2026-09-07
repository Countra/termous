import { app, BrowserWindow } from 'electron'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import type {
  AppConfig,
  CoreFatalEvent,
  CoreStatus,
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
} from './coreProcessLaunch'

export type CoreShutdownReason = 'frontend_exit' | 'application_update'

export type CoreRuntimeConfig = Required<AppConfig>
export type CoreRestartResult = Omit<DataPortabilityRestartResult, 'config'> & {
  config: CoreRuntimeConfig
}
export type { CoreFatalEvent } from '#common/contracts'

type CoreProcessState = Omit<CoreStatus, 'config'> & {
  config: CoreRuntimeConfig
}

interface CoreRuntimeProbe {
  pid?: number
  version?: string
}

const externalCoreDefaultPort = 8122
const packagedManagedCoreDefaultPort = 8152
const maxPortSwitches = 3
const readyTimeoutMs = 12_000
const heartbeatIntervalMs = 10_000
const heartbeatTimeoutMs = 30_000
const requestTimeoutMs = 5_000
const failedChildGracefulExitTimeoutMs = 2_000
const failedChildForceExitTimeoutMs = 2_000
const coreStartupFailureMessage = '核心服务启动异常，请退出后重新打开 Termous。若问题持续，请重新安装应用。'

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
  private lastHeartbeatAt = Date.now()
  private shuttingDown = false
  private readonly shutdownSingleflight = new AsyncSingleflight<boolean>()
  private readonly restoreRestartSingleflight = new AsyncSingleflight<CoreRestartResult>()

  initialize() {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeOnce().catch((error) => {
        this.raiseFatal({
          title: '后端连接异常',
          message: this.describeStartupError(error),
          code: 'CORE_START_FAILED',
        })
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
      stopFailedAttempt: () => this.stopChildOnly(),
    })
    if (attempts.status === 'cancelled') {
      return this.config
    }
    if (attempts.status === 'failed') {
      this.raiseFatal({
        title: '后端连接异常',
        message: this.describeStartupError(attempts.lastError),
        code: 'CORE_START_FAILED',
      })
      return this.config
    }
    const apiBaseUrl = `http://127.0.0.1:${attempts.port}`
    if (this.shuttingDown) {
      await this.stopChildOnly()
      return this.config
    }
    this.config = { apiBaseUrl, apiToken: token, version: process.env.VITE_TERMOUS_APP_VERSION ?? app.getVersion(), managed: true }
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
    }
  }

  getFatal() {
    return this.fatal
  }

  async getRuntimeVersion() {
    const config = await this.initialize()
    try {
      const response = await this.fetchWithTimeout('/api/v1/runtime', {
        method: 'GET',
        headers: config.apiToken
          ? { 'X-Termous-Token': config.apiToken }
          : undefined,
      })
      if (!response.ok) {
        return null
      }
      const runtime = await response.json() as CoreRuntimeProbe
      const version = runtime.version?.trim()
      return version && version.length <= 64 ? version : null
    } catch {
      return null
    }
  }

  shutdownGracefully(reason: CoreShutdownReason = 'frontend_exit') {
    return this.shutdownSingleflight.run(() => this.shutdownOnce(reason))
  }

  private async shutdownOnce(reason: CoreShutdownReason) {
    this.shuttingDown = true
    this.stopHeartbeat()
    if (!this.child) {
      return true
    }
    if (!this.config.managed) {
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
      this.shuttingDown = false
      if (this.config.managed) {
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
      this.shuttingDown = false
      if (this.child && !hasChildProcessExited(this.child)) {
        this.startHeartbeat()
      }
      throw error
    }
    this.child = null
    this.initializePromise = null
    this.fatal = null
    this.shuttingDown = false
    const config = await this.initialize()
    const fatal = this.getFatal() as CoreFatalEvent | null
    if (fatal) {
      throw new Error(fatal.message)
    }
    return { restarted: true, requires_manual_restart: false, config }
  }

  async recoverAfterFailedUpdateInstall(): Promise<CoreRuntimeConfig> {
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
    const startupError = error as NodeJS.ErrnoException | undefined
    if (startupError?.code === 'ENOENT' || startupError?.code === 'EACCES' || startupError?.code === 'EPERM') {
      return coreStartupFailureMessage
    }
    return coreStartupFailureMessage
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
    if (!await isPortAvailable(host, portNumber)) {
      throw new Error('端口被占用')
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
    })
    this.child = child
    child.once('error', (error) => {
      if (this.child === child && !this.shuttingDown && ready) {
        this.raiseFatal({ title: '后端连接异常', message: error.message, code: 'CORE_PROCESS_ERROR' })
      }
    })
    child.once('exit', (code, signal) => {
      if (this.child !== child) {
        return
      }
      this.child = null
      this.stopHeartbeat()
      if (!this.shuttingDown && ready) {
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
    ready = true
    this.lastHeartbeatAt = Date.now()
  }

  private async waitUntilReady(
    apiBaseUrl: string,
    token: string,
    child: ChildProcessWithoutNullStreams,
  ) {
    const expectedPID = child.pid
    const startedAt = Date.now()
    while (Date.now() - startedAt < readyTimeoutMs) {
      if (this.shuttingDown) {
        throw new Error('核心服务启动已取消')
      }
      if (this.child !== child || hasChildProcessExited(child)) {
        throw new Error('Termous Core 启动后立即退出')
      }
      try {
        const response = await this.fetchUrlWithTimeout(new URL('/api/v1/runtime', apiBaseUrl).toString(), {
          method: 'GET',
          headers: { 'X-Termous-Token': token },
        }, 1200)
        if (response.ok) {
          const status = await response.json() as CoreRuntimeProbe
          if (status.pid === expectedPID) {
            return
          }
        }
      } catch {
        // ready 轮询阶段允许短暂失败，直到超时；必须等到新进程自身响应。
      }
      await delay(250)
    }
    throw new Error('Termous Core 启动超时')
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.lastHeartbeatAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat()
    }, heartbeatIntervalMs)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private async sendHeartbeat() {
    if (this.shuttingDown || !this.config.managed) {
      return
    }
    try {
      const response = await this.fetchWithTimeout('/api/v1/runtime/heartbeat', {
        method: 'POST',
        headers: { 'X-Termous-Token': this.config.apiToken },
      })
      if (response.ok) {
        this.lastHeartbeatAt = Date.now()
        return
      }
    } catch {
      // 下面按最近一次成功心跳判断是否超过 30 秒。
    }
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
    const wasShuttingDown = this.shuttingDown
    this.shuttingDown = true
    try {
      this.stopHeartbeat()
      const child = this.child
      if (child) {
        await stopOwnedChildProcess(child, {
          gracefulTimeoutMs: failedChildGracefulExitTimeoutMs,
          forceTimeoutMs: failedChildForceExitTimeoutMs,
        })
        this.child = clearObservedChildProcess(this.child, child)
      }
    } finally {
      this.shuttingDown = wasShuttingDown
    }
  }

  private raiseFatal(event: CoreFatalEvent) {
    this.fatal = event
    this.stopHeartbeat()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('core:fatal', event)
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isPortAvailable(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    if (!Number.isInteger(port) || port <= 0) {
      resolve(false)
      return
    }
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}
