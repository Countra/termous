import type {
  TerminalAICompletionRequest,
  TerminalAICompletionResult,
  TerminalAIInputSnapshot,
} from '#common/contracts'
import { sameTerminalAiInput } from './terminalAiCompletion.ts'

type CompletedResult = Extract<TerminalAICompletionResult, { status: 'completed' }>

export interface TerminalAiCompletionState {
  open: boolean
  prompt: string
  phase: 'idle' | 'loading' | 'ready' | 'error'
  input: TerminalAIInputSnapshot | null
  results: readonly CompletedResult[]
  selectedResultId: string | null
  errorMessage?: string
  errorCode?: string
}

export interface TerminalAiCompletionRuntimeOptions {
  sessionId: string
  captureInput: () => TerminalAIInputSnapshot | null
  setPaused: (paused: boolean) => void
  generate: (request: TerminalAICompletionRequest) => Promise<TerminalAICompletionResult>
  cancel: (requestId: string) => Promise<void>
  requestId?: () => string
}

export class TerminalAiCompletionRuntime {
  private state: TerminalAiCompletionState = {
    open: false, prompt: '', phase: 'idle', input: null, results: [], selectedResultId: null,
  }
  private listeners = new Set<() => void>()
  private activeRequest: string | null = null
  private selectionRevision = 0
  private readonly options: TerminalAiCompletionRuntimeOptions

  constructor(options: TerminalAiCompletionRuntimeOptions) {
    this.options = options
  }

  getSnapshot = () => this.state

  getSelectedResult = () => this.state.results.find((result) => result.requestId === this.state.selectedResultId)

  selectResult(requestId: string) {
    if (!this.state.open || !this.state.results.some((result) => result.requestId === requestId)) return false
    // 即使再次点选同一项，也不能让在途请求回包后改掉用户确认的选择。
    this.selectionRevision += 1
    if (this.state.selectedResultId !== requestId) this.publish({ ...this.state, selectedResultId: requestId })
    return true
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  open() {
    const input = this.options.captureInput()
    if (!input) return false
    if (this.state.open) return true
    this.options.setPaused(true)
    this.publish({ open: true, prompt: '', phase: 'idle', input, results: [], selectedResultId: null })
    return true
  }

  close() {
    if (!this.state.open) return
    this.cancel()
    this.publish({ open: false, prompt: '', phase: 'idle', input: null, results: [], selectedResultId: null })
    this.options.setPaused(false)
  }

  updatePrompt(prompt: string) {
    if (!this.state.open || this.state.phase === 'loading') return
    this.publish({ ...this.state, prompt, phase: 'idle', errorMessage: undefined, errorCode: undefined })
  }

  inputChanged() {
    if (this.state.open && !sameTerminalAiInput(this.options.captureInput(), this.state.input)) {
      this.close()
    }
  }

  cancel() {
    const requestId = this.activeRequest
    this.activeRequest = null
    if (!requestId) return
    const cancelledState: TerminalAiCompletionState = {
      ...this.state, phase: 'idle', errorMessage: undefined, errorCode: undefined,
    }
    this.publish(cancelledState)
    // IPC 关闭时 Main 会独立回收子进程；显式取消失败仍应保留可见错误。
    void this.options.cancel(requestId).catch(() => {
      if (this.state === cancelledState && this.state.open && !this.activeRequest) {
        this.publish({ ...this.state, phase: 'error', errorCode: 'AI_COMPLETION_CANCEL_FAILED' })
      }
    })
  }

  async generate() {
    const { prompt, input, open } = this.state
    if (!open || this.activeRequest || !prompt.trim()) return
    if (!sameTerminalAiInput(this.options.captureInput(), input) || !input) {
      this.close()
      return
    }
    if (new TextEncoder().encode(prompt).length > 4096) {
      this.publish({ ...this.state, phase: 'error', errorCode: 'AI_COMPLETION_PROMPT_TOO_LONG' })
      return
    }
    const requestId = this.options.requestId?.() ?? crypto.randomUUID()
    const selectionRevision = this.selectionRevision
    this.activeRequest = requestId
    this.publish({ ...this.state, phase: 'loading', errorMessage: undefined, errorCode: undefined })
    try {
      const result = await this.options.generate({
        requestId, sessionId: this.options.sessionId, prompt: prompt.trim(), inputSnapshot: input,
      })
      if (!this.isCurrent(requestId, input)) return
      if (result.requestId !== requestId || result.sessionId !== this.options.sessionId
        || !sameTerminalAiInput(result.inputSnapshot, input)) {
        this.publish({ ...this.state, phase: 'error', errorCode: 'AI_COMPLETION_INVALID_RESULT' })
      } else if (result.status === 'completed') {
        // 候选命令共用当前提示符快照；追加结果不会覆盖之前生成或正在查看的命令内容。
        this.publish({
          ...this.state, phase: 'ready', results: [...this.state.results, result],
          selectedResultId: this.selectionRevision === selectionRevision ? result.requestId : this.state.selectedResultId,
        })
      } else if (result.status === 'cancelled') {
        this.publish({ ...this.state, phase: 'idle' })
      } else {
        this.publish({ ...this.state, phase: 'error', errorMessage: result.message, errorCode: result.code })
      }
    } catch {
      if (this.isCurrent(requestId, input)) {
        this.publish({ ...this.state, phase: 'error', errorCode: 'AI_COMPLETION_BRIDGE_FAILED' })
      }
    } finally {
      if (this.activeRequest === requestId) this.activeRequest = null
    }
  }

  private isCurrent(requestId: string, input: TerminalAIInputSnapshot) {
    if (this.activeRequest !== requestId || !this.state.open) return false
    if (!sameTerminalAiInput(this.options.captureInput(), input)) {
      this.close()
      return false
    }
    return true
  }

  private publish(state: TerminalAiCompletionState) {
    this.state = state
    this.listeners.forEach((listener) => listener())
  }
}
