import type { UpdateRuntimeSummary } from '../../../electron/updateRuntime'

export interface UpdateRuntimeSummaryScheduler {
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

interface PendingSummary {
  signature: string
  summary: UpdateRuntimeSummary
}

export class UpdateRuntimeSummaryPublisher {
  private acknowledgedSignature = ''
  private desired: PendingSummary | null = null
  private disposed = false
  private failureCount = 0
  private inFlight = false
  private retryHandle: unknown = null
  private readonly send: (summary: UpdateRuntimeSummary) => Promise<unknown>
  private readonly scheduler: UpdateRuntimeSummaryScheduler
  private readonly onFailure?: () => void

  constructor(
    send: (summary: UpdateRuntimeSummary) => Promise<unknown>,
    scheduler: UpdateRuntimeSummaryScheduler,
    onFailure?: () => void,
  ) {
    this.send = send
    this.scheduler = scheduler
    this.onFailure = onFailure
  }

  publish(summary: UpdateRuntimeSummary) {
    if (this.disposed) {
      return
    }
    const desired = {
      signature: runtimeSummarySignature(summary),
      summary: { ...summary },
    }
    if (this.desired?.signature !== desired.signature) {
      this.failureCount = 0
      this.cancelRetry()
    }
    this.desired = desired
    this.flush()
  }

  dispose() {
    this.disposed = true
    this.desired = null
    this.cancelRetry()
  }

  private flush() {
    const desired = this.desired
    if (
      this.disposed
      || this.inFlight
      || this.retryHandle !== null
      || !desired
      || desired.signature === this.acknowledgedSignature
    ) {
      return
    }

    this.inFlight = true
    void this.send(desired.summary)
      .then(() => {
        if (!this.disposed) {
          this.acknowledgedSignature = desired.signature
          this.failureCount = 0
        }
      })
      .catch(() => {
        if (this.disposed) {
          return
        }
        this.onFailure?.()
        if (this.desired?.signature === desired.signature) {
          this.failureCount += 1
          this.retryHandle = this.scheduler.schedule(() => {
            this.retryHandle = null
            this.flush()
          }, updateRuntimeSummaryRetryDelay(this.failureCount))
        }
      })
      .finally(() => {
        this.inFlight = false
        if (
          !this.disposed
          && this.retryHandle === null
          && this.desired?.signature !== this.acknowledgedSignature
        ) {
          this.flush()
        }
      })
  }

  private cancelRetry() {
    if (this.retryHandle === null) {
      return
    }
    this.scheduler.cancel(this.retryHandle)
    this.retryHandle = null
  }
}

export function runtimeSummarySignature(summary: UpdateRuntimeSummary) {
  return [
    summary.ssh_sessions,
    summary.file_sessions,
    summary.forwards,
    summary.transfers,
    summary.transfers_complete ? 1 : 0,
  ].join(':')
}

export function updateRuntimeSummaryRetryDelay(failureCount: number) {
  const normalizedAttempt = Number.isSafeInteger(failureCount) && failureCount > 0
    ? failureCount
    : 1
  return Math.min(30_000, 1_000 * (3 ** Math.min(normalizedAttempt - 1, 4)))
}
