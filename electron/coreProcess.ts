import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface CoreRuntimeConfig {
  apiBaseUrl: string
  apiToken: string
  version: string
  managed: boolean
}

export interface CoreFatalEvent {
  title: string
  message: string
  code: string
}

interface CoreProcessState {
  config: CoreRuntimeConfig
  fatal: CoreFatalEvent | null
  pid?: number
}

const defaultPort = 8122
const maxPortSwitches = 3
const readyTimeoutMs = 12_000
const heartbeatIntervalMs = 10_000
const heartbeatTimeoutMs = 30_000
const requestTimeoutMs = 5_000
const coreStartupFailureMessage = '核心服务启动异常，请退出后重新打开 Termous。若问题持续，请重新安装应用。'

export class CoreProcessManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private config: CoreRuntimeConfig = {
    apiBaseUrl: process.env.TERMOUS_API_BASE_URL ?? `http://127.0.0.1:${defaultPort}`,
    apiToken: process.env.TERMOUS_API_TOKEN ?? (process.env.NODE_ENV === 'development' ? 'dev-token' : ''),
    version: process.env.VITE_TERMOUS_APP_VERSION ?? app.getVersion(),
    managed: false,
  }
  private fatal: CoreFatalEvent | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastHeartbeatAt = Date.now()
  private shuttingDown = false

  async initialize() {
    if (this.shouldUseExternalCore()) {
      this.config = {
        apiBaseUrl: process.env.TERMOUS_API_BASE_URL ?? `http://127.0.0.1:${defaultPort}`,
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
    let lastError: unknown = null
    for (let offset = 0; offset <= maxPortSwitches; offset += 1) {
      const port = defaultPort + offset
      const apiBaseUrl = `http://127.0.0.1:${port}`
      try {
        await this.startManagedCore(binaryPath, apiBaseUrl, token)
        this.config = { apiBaseUrl, apiToken: token, version: process.env.VITE_TERMOUS_APP_VERSION ?? app.getVersion(), managed: true }
        this.startHeartbeat()
        return this.config
      } catch (error) {
        lastError = error
        await this.stopChildOnly()
      }
    }
    this.raiseFatal({
      title: '后端连接异常',
      message: this.describeStartupError(lastError),
      code: 'CORE_START_FAILED',
    })
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

  async shutdownGracefully() {
    this.shuttingDown = true
    this.stopHeartbeat()
    if (!this.config.managed || !this.child) {
      return true
    }
    try {
      await this.fetchWithTimeout('/api/v1/runtime/shutdown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Termous-Token': this.config.apiToken,
        },
        body: JSON.stringify({ reason: 'frontend_exit' }),
      })
    } catch {
      // 退出阶段后端可能已经停止，后续等待进程退出即可。
    }
    return this.waitForExit(8_000)
  }

  private shouldUseExternalCore() {
    return Boolean(process.env.VITE_DEV_SERVER_URL || process.env.TERMOUS_API_BASE_URL)
  }

  private resolveCorePath() {
    if (process.env.TERMOUS_CORE_PATH) {
      return process.env.TERMOUS_CORE_PATH
    }
    const binary = process.platform === 'win32' ? 'termous-core.exe' : 'termous-core'
    return app.isPackaged
      ? path.join(path.dirname(process.execPath), binary)
      : path.join(process.env.APP_ROOT, 'build', 'core', binary)
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

  private async startManagedCore(binaryPath: string, apiBaseUrl: string, token: string) {
    const addr = new URL(apiBaseUrl)
    const host = addr.hostname || '127.0.0.1'
    const port = addr.port
    this.child = spawn(binaryPath, ['--addr', `${host}:${port}`], {
      cwd: path.dirname(binaryPath),
      env: {
        ...process.env,
        TERMOUS_ADDR: `${host}:${port}`,
        TERMOUS_API_TOKEN: token,
        TERMOUS_REQUIRE_HEARTBEAT: '1',
        TERMOUS_HEARTBEAT_TIMEOUT: '30s',
        TERMOUS_PARENT_PID: String(process.pid),
      },
      windowsHide: true,
      stdio: 'pipe',
    })
    this.child.once('error', (error) => {
      if (!this.shuttingDown) {
        this.raiseFatal({ title: '后端连接异常', message: error.message, code: 'CORE_PROCESS_ERROR' })
      }
    })
    this.child.once('exit', (code, signal) => {
      this.stopHeartbeat()
      if (!this.shuttingDown) {
        this.raiseFatal({
          title: '后端连接异常',
          message: `Termous Core 已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`,
          code: 'CORE_PROCESS_EXITED',
        })
      }
    })
    this.child.stdout.on('data', () => undefined)
    this.child.stderr.on('data', () => undefined)
    await this.waitUntilReady(apiBaseUrl)
    this.lastHeartbeatAt = Date.now()
  }

  private async waitUntilReady(apiBaseUrl: string) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < readyTimeoutMs) {
      if (this.child && this.child.exitCode !== null) {
        throw new Error('Termous Core 启动后立即退出')
      }
      try {
        const response = await this.fetchUrlWithTimeout(new URL('/api/v1/healthz', apiBaseUrl).toString(), { method: 'GET' }, 1200)
        if (response.ok) {
          return
        }
      } catch {
        // ready 轮询阶段允许短暂失败，直到超时。
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

  private async waitForExit(timeoutMs: number) {
    const child = this.child
    if (!child || child.exitCode !== null) {
      this.child = null
      return true
    }
    const exited = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), timeoutMs)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
    if (exited) {
      this.child = null
    }
    return exited
  }

  private async stopChildOnly() {
    this.shuttingDown = true
    this.stopHeartbeat()
    if (this.child && this.child.exitCode === null) {
      this.child.kill()
      await this.waitForExit(2000)
    }
    this.child = null
    this.shuttingDown = false
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
