import type { TerminalAICompletionCancel, TerminalAICompletionRequest, TerminalAICompletionResult } from '#common/contracts'
import type { AgentWorkerFactory, AgentWorkerProcess } from '../agent/workerProcess.ts'
import { AgentCoreRuntimeError } from '../agent/coreRuntimeClient.ts'
import type { RuntimeUsage } from '../agent/runtimeUsage.ts'
import {
  completionFailure, isTerminalCompletionRequest, isTerminalCompletionResult, isTerminalCompletionUsage,
  terminalCompletionAbortGraceMs, terminalCompletionTimeoutMs, type TerminalCompletionBootstrap,
} from './protocol.ts'

interface ActiveRequest {
  request: TerminalAICompletionRequest
  ownerId: number
  controller: AbortController
  worker?: AgentWorkerProcess
  deadline?: ReturnType<typeof setTimeout>
  exitGuard?: ReturnType<typeof setTimeout>
  dispose: Array<() => void>
  settled: boolean
  startedAt: number
  result?: TerminalAICompletionResult
  usage?: RuntimeUsage
  modelId?: string
  promise: Promise<TerminalAICompletionResult>
  resolve(result: TerminalAICompletionResult): void
  closed: Promise<void>
  resolveClosed(): void
}

interface TerminalCompletionRuntimeOptions {
    workerFactory: AgentWorkerFactory
    bootstrap(request: TerminalAICompletionRequest, signal: AbortSignal): Promise<TerminalCompletionBootstrap>
    timeoutMs?: number
    abortGraceMs?: number
    onFinished?(summary: { request_id: string; status: string; error_code?: string; duration_ms: number; model_id?: string; usage?: RuntimeUsage }): void
}

export class TerminalCompletionRuntime {
  private active: ActiveRequest | undefined
  private closing = false
  private readonly options: TerminalCompletionRuntimeOptions

  constructor(options: TerminalCompletionRuntimeOptions) { this.options = options }

  generate(request: TerminalAICompletionRequest, ownerId: number): Promise<TerminalAICompletionResult> {
    if (!isTerminalCompletionRequest(request)) throw new Error('TERMINAL_AI_REQUEST_INVALID')
    if (this.closing) return Promise.resolve(completionFailure(request, 'TERMINAL_AI_UNAVAILABLE', 'AI 命令生成暂不可用'))
    if (this.active) {
      return Promise.resolve(completionFailure(request, 'TERMINAL_AI_BUSY', '已有命令正在生成，请稍后重试'))
    }
    let resolve!: ActiveRequest['resolve']
    let resolveClosed!: () => void
    const active: ActiveRequest = {
      request: structuredClone(request), ownerId, controller: new AbortController(), dispose: [], settled: false, startedAt: Date.now(),
      promise: new Promise((done) => { resolve = done }), resolve: (result) => resolve(result),
      closed: new Promise((done) => { resolveClosed = done }), resolveClosed: () => resolveClosed(),
    }
    this.active = active
    active.deadline = setTimeout(() => this.finish(active,
      completionFailure(active.request, 'TERMINAL_AI_TIMEOUT', '生成命令超时，请重试'), true), this.options.timeoutMs ?? terminalCompletionTimeoutMs)
    void this.start(active)
    return active.promise
  }

  cancel(request: TerminalAICompletionCancel, ownerId: number) {
    const active = this.active
    if (active && active.ownerId === ownerId && active.request.requestId === request.requestId && active.request.sessionId === request.sessionId) {
      this.finish(active, completionFailure(active.request, 'TERMINAL_AI_CANCELLED', '已取消生成'), true)
    }
  }

  cancelOwner(ownerId: number) {
    if (this.active?.ownerId === ownerId) this.cancel(this.active.request, ownerId)
  }

  async stop(): Promise<boolean> {
    this.closing = true
    const active = this.active
    if (!active) return true
    this.finish(active, completionFailure(active.request, 'TERMINAL_AI_CANCELLED', '已取消生成'), true)
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        active.closed.then(() => true),
        new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), (this.options.abortGraceMs ?? terminalCompletionAbortGraceMs) + 2000) }),
      ])
    } finally { if (timeout) clearTimeout(timeout) }
  }

  resume() { this.closing = false }

  private async start(active: ActiveRequest) {
    try {
      const bootstrap = await this.options.bootstrap(active.request, active.controller.signal)
      if (active.settled || this.active !== active) return
      active.modelId = bootstrap.model.snapshot.model_id
      const worker = this.options.workerFactory.create()
      active.worker = worker
      active.dispose.push(worker.onMessage((value) => {
        if (this.active !== active) return
        if (isTerminalCompletionUsage(value, active.request.requestId)) { active.usage = value.usage; return }
        if (active.settled) return
        if (!isTerminalCompletionResult(value, active.request)) {
          this.finish(active, completionFailure(active.request, 'TERMINAL_AI_RESPONSE_INVALID', 'AI 命令生成返回了无效结果'), true)
          return
        }
        this.finish(active, value, false)
      }))
      active.dispose.push(worker.onExit(() => {
        if (!active.settled) this.finish(active,
          completionFailure(active.request, 'TERMINAL_AI_WORKER_EXITED', 'AI 命令生成进程已退出，请重试'), false)
        this.release(active)
      }))
      active.dispose.push(worker.onSpawn(() => {
        if (active.settled || this.active !== active) return
        try { worker.postMessage({ type: 'start', request: active.request, bootstrap }) } catch {
          this.finish(active, completionFailure(active.request, 'TERMINAL_AI_WORKER_FAILED', '无法启动 AI 命令生成'), true)
        }
      }))
    } catch (error) {
      if (active.settled) return
      const code = error instanceof AgentCoreRuntimeError ? error.code : 'TERMINAL_AI_BOOTSTRAP_FAILED'
      this.finish(active, completionFailure(active.request, code, '无法准备 AI 命令生成，请检查默认模型和终端状态'), true)
    }
  }

  private finish(active: ActiveRequest, result: TerminalAICompletionResult, abort: boolean) {
    if (active.settled) return
    active.settled = true
    active.result = result
    if (active.deadline) clearTimeout(active.deadline)
    active.resolve(result)
    if (abort) {
      active.controller.abort()
      try { active.worker?.postMessage({ type: 'abort', requestId: active.request.requestId }) } catch { /* 发送失败仍由退出守卫回收进程。 */ }
    }
    if (!active.worker) { this.release(active); return }
    // 结果回传后也要求进程退出；停止和正常完成均不能留下携带凭据的 Worker。
    active.exitGuard = setTimeout(() => {
      try { active.worker?.kill() } catch { /* 保留运行槽位，禁止未确认退出时并发启动第二个 Worker。 */ }
    }, this.options.abortGraceMs ?? terminalCompletionAbortGraceMs)
  }

  private release(active: ActiveRequest) {
    if (active.deadline) clearTimeout(active.deadline)
    if (active.exitGuard) clearTimeout(active.exitGuard)
    for (const dispose of active.dispose) dispose()
    active.dispose = []
    if (this.active === active) this.active = undefined
    if (active.result) {
      try {
        this.options.onFinished?.({
          request_id: active.request.requestId, status: active.result.status,
          ...(active.result.status !== 'completed' ? { error_code: active.result.code } : {}),
          duration_ms: Math.max(0, Date.now() - active.startedAt), ...(active.usage ? { usage: active.usage } : {}),
          ...(active.modelId ? { model_id: active.modelId } : {}),
        })
      } catch { /* 诊断日志失败不能阻断请求和进程资源的收口。 */ }
      active.result = undefined
    }
    active.resolveClosed()
  }
}
