import type { Session } from '#entities/session'
import type { TerminalGateway } from '../api/terminalGateway'
import type { TerminalCompletionRuntime } from '../model/terminalCompletionRuntime'
import type { TerminalCompletionRetryResult } from './terminalRuntimeContext'

interface CompletionStatusEntry {
  disposed: boolean
  transport: {
    isLive: () => boolean
  }
}

interface CompletionStatusReconciliation {
  attempt: number
  controller?: AbortController
  timer?: number
  refreshPromise?: Promise<TerminalCompletionRetryResult>
}

interface TerminalCompletionStatusReconcilerOptions {
  completionRuntime: Pick<
    TerminalCompletionRuntime,
    'applyStatus' | 'getSnapshot' | 'markPromptObservationUnavailable'
  >
  getApi: () => Pick<
    TerminalGateway,
    'refreshSessionCompletions' | 'sessionCompletionStatus'
  >
  getEntry: (sessionId: string) => CompletionStatusEntry | undefined
  getSession: (sessionId: string) => Pick<Session, 'kind' | 'status'> | undefined
  schedule?: (callback: () => void, delay: number) => number
  clearScheduled?: (timer: number) => void
}

const completionStatusRetryDelays = [0, 1_000, 2_000, 4_000, 8_000, 16_000, 18_000]

export class TerminalCompletionStatusReconciler {
  private readonly completionRuntime: TerminalCompletionStatusReconcilerOptions['completionRuntime']
  private readonly getApi: TerminalCompletionStatusReconcilerOptions['getApi']
  private readonly getEntry: TerminalCompletionStatusReconcilerOptions['getEntry']
  private readonly getSession: TerminalCompletionStatusReconcilerOptions['getSession']
  private readonly schedule: NonNullable<TerminalCompletionStatusReconcilerOptions['schedule']>
  private readonly clearScheduled: NonNullable<TerminalCompletionStatusReconcilerOptions['clearScheduled']>
  private readonly reconciliations = new Map<string, CompletionStatusReconciliation>()

  constructor(options: TerminalCompletionStatusReconcilerOptions) {
    this.completionRuntime = options.completionRuntime
    this.getApi = options.getApi
    this.getEntry = options.getEntry
    this.getSession = options.getSession
    this.schedule = options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay))
    this.clearScheduled = options.clearScheduled ?? ((timer) => window.clearTimeout(timer))
  }

  stop(sessionId: string) {
    const reconciliation = this.reconciliations.get(sessionId)
    if (!reconciliation) {
      return
    }
    reconciliation.controller?.abort()
    if (reconciliation.timer !== undefined) {
      this.clearScheduled(reconciliation.timer)
    }
    this.reconciliations.delete(sessionId)
  }

  stopAll() {
    for (const sessionId of this.reconciliations.keys()) {
      this.stop(sessionId)
    }
  }

  start(sessionId: string) {
    this.stop(sessionId)
    const session = this.getSession(sessionId)
    const entry = this.getEntry(sessionId)
    const snapshot = this.completionRuntime.getSnapshot(sessionId)
    if (
      session?.kind !== 'ssh'
      || session.status !== 'connected'
      || !entry
      || entry.disposed
      || !entry.transport.isLive()
      || snapshot.readiness === 'disabled'
      || snapshot.boundary !== null
    ) {
      return
    }

    const reconciliation: CompletionStatusReconciliation = { attempt: 0 }
    this.reconciliations.set(sessionId, reconciliation)

    const isCurrent = () => this.reconciliations.get(sessionId) === reconciliation
    const finish = () => {
      if (isCurrent()) {
        this.reconciliations.delete(sessionId)
      }
    }
    const scheduleNext = () => {
      if (!isCurrent() || reconciliation.attempt >= completionStatusRetryDelays.length) {
        if (isCurrent()) {
          const currentEntry = this.getEntry(sessionId)
          const currentSnapshot = this.completionRuntime.getSnapshot(sessionId)
          if (
            currentEntry
            && !currentEntry.disposed
            && currentEntry.transport.isLive()
            && currentSnapshot.readiness !== 'disabled'
            && currentSnapshot.boundary === null
          ) {
            this.completionRuntime.markPromptObservationUnavailable(sessionId)
          }
        }
        finish()
        return
      }
      const delay = completionStatusRetryDelays[reconciliation.attempt] ?? 0
      reconciliation.attempt += 1
      if (delay === 0) {
        void poll()
        return
      }
      reconciliation.timer = this.schedule(() => {
        reconciliation.timer = undefined
        void poll()
      }, delay)
    }
    const poll = async () => {
      if (!isCurrent()) {
        return
      }
      const currentEntry = this.getEntry(sessionId)
      const currentSnapshot = this.completionRuntime.getSnapshot(sessionId)
      if (
        !currentEntry
        || currentEntry.disposed
        || !currentEntry.transport.isLive()
        || currentSnapshot.readiness === 'disabled'
        || currentSnapshot.boundary !== null
      ) {
        finish()
        return
      }

      const controller = new AbortController()
      reconciliation.controller = controller
      try {
        const status = await this.getApi().sessionCompletionStatus(sessionId, {
          signal: controller.signal,
        })
        if (!isCurrent() || controller.signal.aborted) {
          return
        }
        reconciliation.controller = undefined
        this.completionRuntime.applyStatus(sessionId, status)
        if (
          status.prompt_observation.status === 'waiting'
          || status.prompt_observation.status === 'preparing'
          || (
            status.prompt_observation.status === 'degraded'
            && status.prompt_observation.retryable === true
          )
        ) {
          scheduleNext()
        } else {
          finish()
        }
      } catch {
        if (!isCurrent() || controller.signal.aborted) {
          return
        }
        reconciliation.controller = undefined
        scheduleNext()
      }
    }

    scheduleNext()
  }

  retry(sessionId: string) {
    const existing = this.reconciliations.get(sessionId)
    if (existing?.refreshPromise) {
      return existing.refreshPromise
    }
    this.stop(sessionId)
    const entry = this.getEntry(sessionId)
    const session = this.getSession(sessionId)
    const snapshot = this.completionRuntime.getSnapshot(sessionId)
    if (
      session?.kind !== 'ssh'
      || session.status !== 'connected'
      || !entry
      || entry.disposed
      || !entry.transport.isLive()
      || snapshot.readiness === 'disabled'
      || snapshot.promptObservation.retryable !== true
    ) {
      return Promise.resolve<TerminalCompletionRetryResult>('cancelled')
    }

    const controller = new AbortController()
    const reconciliation: CompletionStatusReconciliation = {
      attempt: 0,
      controller,
    }
    const hasRecoveredPrompt = () => {
      const latest = this.completionRuntime.getSnapshot(sessionId)
      return latest.readiness === 'ready' && latest.boundary !== null
    }
    this.reconciliations.set(sessionId, reconciliation)
    const refreshPromise: Promise<TerminalCompletionRetryResult> = this.getApi().refreshSessionCompletions(sessionId, {
      signal: controller.signal,
    }).then((status) => {
      if (
        controller.signal.aborted
        || this.reconciliations.get(sessionId) !== reconciliation
      ) {
        return hasRecoveredPrompt() ? 'succeeded' : 'cancelled'
      }
      reconciliation.controller = undefined
      this.reconciliations.delete(sessionId)
      this.completionRuntime.applyStatus(sessionId, status)
      if (
        status.prompt_observation.status === 'waiting'
        || status.prompt_observation.status === 'preparing'
        || (
          status.prompt_observation.status === 'degraded'
          && status.prompt_observation.retryable === true
        )
      ) {
        this.start(sessionId)
      }
      return 'succeeded'
    }).catch(() => {
      const interrupted = controller.signal.aborted
        || this.reconciliations.get(sessionId) !== reconciliation
      if (!interrupted) {
        this.reconciliations.delete(sessionId)
      }
      if (hasRecoveredPrompt()) {
        return 'succeeded'
      }
      return interrupted ? 'cancelled' : 'failed'
    })
    reconciliation.refreshPromise = refreshPromise
    return refreshPromise
  }
}
