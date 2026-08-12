import type { TerminalEntry } from './terminalRuntimeTypes'

interface TerminalEntryLifecycleOptions {
  getEntries: () => Map<string, TerminalEntry>
  applyCwdDisposed: (sessionId: string) => void
  stopCompletionStatusReconciliation: (sessionId: string) => void
  disposeCompletionSession: (sessionId: string) => void
  deleteCompletionLayoutListeners: (sessionId: string) => void
  cancelResizeFrame?: (frame: number) => void
  clearResizeTimer?: (timer: number) => void
}

export class TerminalEntryLifecycle {
  private readonly getEntries: TerminalEntryLifecycleOptions['getEntries']
  private readonly applyCwdDisposed: TerminalEntryLifecycleOptions['applyCwdDisposed']
  private readonly stopCompletionStatusReconciliation: TerminalEntryLifecycleOptions['stopCompletionStatusReconciliation']
  private readonly disposeCompletionSession: TerminalEntryLifecycleOptions['disposeCompletionSession']
  private readonly deleteCompletionLayoutListeners: TerminalEntryLifecycleOptions['deleteCompletionLayoutListeners']
  private readonly cancelResizeFrame: NonNullable<TerminalEntryLifecycleOptions['cancelResizeFrame']>
  private readonly clearResizeTimer: NonNullable<TerminalEntryLifecycleOptions['clearResizeTimer']>

  constructor(options: TerminalEntryLifecycleOptions) {
    this.getEntries = options.getEntries
    this.applyCwdDisposed = options.applyCwdDisposed
    this.stopCompletionStatusReconciliation = options.stopCompletionStatusReconciliation
    this.disposeCompletionSession = options.disposeCompletionSession
    this.deleteCompletionLayoutListeners = options.deleteCompletionLayoutListeners
    this.cancelResizeFrame = options.cancelResizeFrame ?? ((frame) => window.cancelAnimationFrame(frame))
    this.clearResizeTimer = options.clearResizeTimer ?? ((timer) => window.clearTimeout(timer))
  }

  disposeEntry(entry: TerminalEntry) {
    if (entry.disposed) {
      return
    }
    this.applyCwdDisposed(entry.sessionId)
    this.stopCompletionStatusReconciliation(entry.sessionId)
    this.disposeCompletionSession(entry.sessionId)
    entry.disposed = true
    if (entry.resizeFrame !== null) {
      this.cancelResizeFrame(entry.resizeFrame)
      entry.resizeFrame = null
    }
    if (entry.resizeTimer !== null) {
      this.clearResizeTimer(entry.resizeTimer)
      entry.resizeTimer = null
    }
    entry.disposables.forEach((disposable) => disposable.dispose())
    entry.transport.dispose()
    entry.terminal.dispose()
    entry.container.remove()
    this.getEntries().delete(entry.sessionId)
    this.deleteCompletionLayoutListeners(entry.sessionId)
  }

  disposeSession(sessionId: string) {
    const entry = this.getEntries().get(sessionId)
    if (entry) {
      this.disposeEntry(entry)
    }
  }

  disposeAll() {
    Array.from(this.getEntries().values()).forEach((entry) => this.disposeEntry(entry))
  }
}
