import type { UpdateRuntimeSummary } from '../../../electron/updateRuntime'

export interface UpdateRuntimeSummaryScheduler {
  schedule(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

interface PendingSummary {
  signature: string
  summary: UpdateRuntimeSummary
}

interface PendingRefresh {
  generation: number
  requestId?: string
}

export class UpdateRuntimeSummaryPublisher {
  private acknowledgedSignature = ''
  private desired: PendingSummary | null = null
  private disposed = false
  private failureCount = 0
  private inFlight = false
  private inFlightRefresh: PendingRefresh | null = null
  private pendingRefresh: PendingRefresh | null = null
  private refreshGeneration = 0
  private retryHandle: unknown = null
  private retryRefresh: PendingRefresh | null = null
  private readonly send: (
    summary: UpdateRuntimeSummary,
    requestId?: string,
  ) => Promise<unknown>
  private readonly scheduler: UpdateRuntimeSummaryScheduler
  private readonly onFailure?: () => void

  constructor(
    send: (
      summary: UpdateRuntimeSummary,
      requestId?: string,
    ) => Promise<unknown>,
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
      const deferredRefresh = (
        this.pendingRefresh
        ?? this.retryRefresh
        ?? this.inFlightRefresh
      )
      this.failureCount = 0
      this.cancelRetry()
      if (deferredRefresh && this.pendingRefresh === null) {
        this.pendingRefresh = deferredRefresh
      }
    }
    this.desired = desired
    this.flush()
  }

  refresh(requestId?: string) {
    if (this.disposed || !this.desired) {
      return
    }
    const retainedRequestId = (
      requestId
      ?? this.pendingRefresh?.requestId
      ?? this.retryRefresh?.requestId
      ?? this.inFlightRefresh?.requestId
    )
    this.cancelRetry()
    this.refreshGeneration += 1
    this.pendingRefresh = {
      generation: this.refreshGeneration,
      ...(retainedRequestId === undefined
        ? {}
        : { requestId: retainedRequestId }),
    }
    this.flush()
  }

  dispose() {
    this.disposed = true
    this.desired = null
    this.inFlightRefresh = null
    this.pendingRefresh = null
    this.cancelRetry()
  }

  private flush() {
    const desired = this.desired
    const refresh = this.pendingRefresh
    if (
      this.disposed
      || this.inFlight
      || this.retryHandle !== null
      || !desired
      || (!refresh && desired.signature === this.acknowledgedSignature)
    ) {
      return
    }

    this.pendingRefresh = null
    this.inFlight = true
    this.inFlightRefresh = refresh
    let operation: Promise<unknown>
    try {
      operation = this.send(desired.summary, refresh?.requestId)
    } catch (error) {
      operation = Promise.reject(error)
    }
    void operation
      .then(() => {
        if (!this.disposed) {
          this.acknowledgedSignature = desired.signature
          this.failureCount = 0
          if (
            refresh?.requestId
            && this.pendingRefresh?.requestId === refresh.requestId
          ) {
            this.pendingRefresh = {
              generation: this.pendingRefresh.generation,
            }
          }
        }
      })
      .catch(() => {
        if (this.disposed) {
          return
        }
        this.onFailure?.()
        if (
          this.desired?.signature === desired.signature
          && this.pendingRefresh === null
        ) {
          this.failureCount += 1
          this.retryRefresh = refresh
          this.retryHandle = this.scheduler.schedule(() => {
            this.retryHandle = null
            this.pendingRefresh = this.retryRefresh
            this.retryRefresh = null
            this.flush()
          }, updateRuntimeSummaryRetryDelay(this.failureCount))
        }
      })
      .finally(() => {
        this.inFlight = false
        this.inFlightRefresh = null
        if (
          !this.disposed
          && this.retryHandle === null
          && (
            this.pendingRefresh !== null
            || this.desired?.signature !== this.acknowledgedSignature
          )
        ) {
          this.flush()
        }
      })
  }

  private cancelRetry() {
    if (this.retryHandle === null) {
      this.retryRefresh = null
      return
    }
    this.scheduler.cancel(this.retryHandle)
    this.retryHandle = null
    this.retryRefresh = null
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
