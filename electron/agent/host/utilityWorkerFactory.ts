import { utilityProcess, type UtilityProcess } from 'electron'
import { statSync } from 'original-fs'
import { isAbsolute } from 'node:path'
import type { AgentWorkerFactory, AgentWorkerProcess } from '../contracts/workerProcess.ts'
import { sanitizedWorkerEnvironment } from './workerEnvironment.ts'

export interface UtilityWorkerFactoryOptions {
  modulePath: string
  cwd: string
  environment?: NodeJS.ProcessEnv
  serviceName?: string
}

export class UtilityWorkerFactory implements AgentWorkerFactory {
  private readonly modulePath: string
  private readonly cwd: string
  private readonly environment: Record<string, string>
  private readonly serviceName: string

  constructor(options: UtilityWorkerFactoryOptions) {
    this.modulePath = options.modulePath
    this.cwd = options.cwd
    this.environment = sanitizedWorkerEnvironment(options.environment ?? process.env)
    this.serviceName = options.serviceName ?? 'Termous Agent Run'
  }

  create() {
    // Electron 的普通 fs 会将 ASAR 映射为目录；子进程 cwd 必须按原生文件系统检查。
    try {
      if (!isAbsolute(this.cwd) || !statSync(this.cwd).isDirectory()) throw new Error('invalid cwd')
    } catch {
      throw new Error('AGENT_RUNTIME_WORKING_DIRECTORY_INVALID')
    }
    const child = utilityProcess.fork(this.modulePath, [], {
      cwd: this.cwd,
      env: this.environment,
      execArgv: [],
      serviceName: this.serviceName,
      stdio: 'ignore',
    })
    return new ElectronAgentWorkerProcess(child)
  }
}

class ElectronAgentWorkerProcess implements AgentWorkerProcess {
  private spawned = false
  private exited = false
  private exitCode = 0
  private readonly spawnListeners = new Set<() => void>()
  private readonly exitListeners = new Set<(code: number) => void>()

  constructor(private readonly child: UtilityProcess) {
    child.once('spawn', () => this.emitSpawn())
    child.once('exit', (code) => this.emitExit(code))
    if (child.pid !== undefined) {
      queueMicrotask(() => this.emitSpawn())
    }
  }

  postMessage(message: unknown) {
    this.child.postMessage(message)
  }

  kill() {
    return this.child.kill()
  }

  onMessage(listener: (message: unknown) => void) {
    this.child.on('message', listener)
    return () => this.child.removeListener('message', listener)
  }

  onExit(listener: (code: number) => void) {
    if (this.exited) {
      let active = true
      queueMicrotask(() => {
        if (active) listener(this.exitCode)
      })
      return () => {
        active = false
      }
    }
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  onSpawn(listener: () => void) {
    if (this.spawned) {
      let active = true
      queueMicrotask(() => {
        if (active) listener()
      })
      return () => {
        active = false
      }
    }
    this.spawnListeners.add(listener)
    return () => this.spawnListeners.delete(listener)
  }

  private emitSpawn() {
    if (this.spawned || this.exited) {
      return
    }
    this.spawned = true
    for (const listener of this.spawnListeners) {
      listener()
    }
    this.spawnListeners.clear()
  }

  private emitExit(code: number) {
    if (this.exited) {
      return
    }
    this.exited = true
    this.exitCode = code
    for (const listener of this.exitListeners) {
      listener(code)
    }
    this.exitListeners.clear()
    this.spawnListeners.clear()
  }
}
