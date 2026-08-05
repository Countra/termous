import { randomUUID } from 'node:crypto'
import type {
  UpdateInstallConfirmation,
  UpdateInstallSummaryState,
  UpdateRuntimeSummary,
  UpdateSnapshot,
} from '#common/contracts'

export type {
  UpdateInstallConfirmation,
  UpdateInstallSummaryState,
  UpdateRuntimeSummary,
} from '#common/contracts'

const defaultConfirmationTtlMs = 2 * 60 * 1000
const defaultSummaryFreshnessTtlMs = 45 * 1000

interface PendingInstallConfirmation extends UpdateInstallConfirmation {
  expires_at_ms: number
}

interface UpdateInstallConfirmationAuthorityOptions {
  now?: () => number
  randomToken?: () => string
  ttlMs?: number
  summaryTtlMs?: number
}

export class UpdateInstallConfirmationAuthority {
  private readonly now: () => number
  private readonly randomToken: () => string
  private readonly ttlMs: number
  private readonly summaryTtlMs: number
  private summary = emptyRuntimeSummary()
  private summaryReady = false
  private summaryUpdatedAtMs: number | null = null
  private summaryRevision = 0
  private pending: PendingInstallConfirmation | null = null

  constructor(options: UpdateInstallConfirmationAuthorityOptions = {}) {
    this.now = options.now ?? Date.now
    this.randomToken = options.randomToken ?? randomUUID
    this.ttlMs = normalizeTtl(options.ttlMs)
    this.summaryTtlMs = normalizeSummaryTtl(options.summaryTtlMs)
  }

  updateSummary(value: unknown) {
    const next = normalizeRuntimeSummary(value)
    const reportExpired = (
      this.summaryUpdatedAtMs !== null
      && !this.isSummaryReportFresh()
    )
    if (reportExpired || !runtimeSummariesEqual(this.summary, next)) {
      this.summary = next
      this.summaryRevision += 1
      this.pending = null
    }
    this.summaryReady = next.transfers_complete
    this.summaryUpdatedAtMs = this.now()
    return { ...this.summary }
  }

  getSummaryState(): UpdateInstallSummaryState {
    return {
      revision: this.summaryRevision,
      ready: this.isSummaryFresh(),
    }
  }

  getSummaryExpiresAt() {
    return this.summaryUpdatedAtMs === null
      ? null
      : this.summaryUpdatedAtMs + this.summaryTtlMs
  }

  invalidateSummary() {
    const hadSummary = this.summaryUpdatedAtMs !== null
    this.summaryReady = false
    this.summaryUpdatedAtMs = null
    this.pending = null
    if (hadSummary) {
      this.summaryRevision += 1
    }
    return this.getSummaryState()
  }

  issue(snapshot: UpdateSnapshot): UpdateInstallConfirmation {
    if (!isInstallConfirmationState(snapshot) || !this.isSummaryFresh()) {
      throw new Error('update_install_not_ready')
    }
    const now = this.now()
    const confirmation: PendingInstallConfirmation = {
      confirmation_token: this.randomToken(),
      expires_at: new Date(now + this.ttlMs).toISOString(),
      expires_at_ms: now + this.ttlMs,
      state_seq: snapshot.state_seq,
      operation_generation: snapshot.operation_generation,
      summary_revision: this.summaryRevision,
      summary: { ...this.summary },
    }
    this.pending = confirmation
    return publicConfirmation(confirmation)
  }

  consume(value: unknown, snapshot: UpdateSnapshot) {
    const confirmation = this.pending
    this.pending = null
    if (
      typeof value !== 'string'
      || !confirmation
      || confirmation.confirmation_token !== value
      || confirmation.expires_at_ms <= this.now()
      || confirmation.state_seq !== snapshot.state_seq
      || confirmation.operation_generation !== snapshot.operation_generation
      || confirmation.summary_revision !== this.summaryRevision
      || !this.isSummaryFresh()
      || !isInstallConfirmationState(snapshot)
    ) {
      throw new Error('update_install_confirmation_invalid')
    }
    return publicConfirmation(confirmation)
  }

  assertSummaryRevisionCurrent(revision: number) {
    if (
      !Number.isSafeInteger(revision)
      || revision !== this.summaryRevision
      || !this.isSummaryFresh()
    ) {
      throw new Error('update_install_summary_stale')
    }
  }

  reconcile(snapshot: UpdateSnapshot) {
    if (
      this.pending
      && (
        this.pending.state_seq !== snapshot.state_seq
        || this.pending.operation_generation !== snapshot.operation_generation
        || !isInstallConfirmationState(snapshot)
      )
    ) {
      this.pending = null
    }
  }

  clear() {
    this.pending = null
  }

  private isSummaryFresh() {
    return (
      this.summaryReady
      && this.isSummaryReportFresh()
    )
  }

  private isSummaryReportFresh() {
    return (
      this.summaryUpdatedAtMs !== null
      && this.summaryUpdatedAtMs + this.summaryTtlMs > this.now()
    )
  }
}

function isInstallConfirmationState(snapshot: UpdateSnapshot) {
  return (
    snapshot.phase === 'downloaded'
    || (
      snapshot.phase === 'error'
      && snapshot.retryable
      && (
        snapshot.error_code === 'UPDATE_CORE_SHUTDOWN_FAILED'
        || snapshot.error_code === 'UPDATE_INSTALL_SUMMARY_STALE'
        || snapshot.error_code === 'UPDATE_INSTALL_START_FAILED'
      )
    )
  )
}

export function normalizeRuntimeSummary(value: unknown): UpdateRuntimeSummary {
  const record = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    ssh_sessions: normalizeCount(record.ssh_sessions),
    file_sessions: normalizeCount(record.file_sessions),
    forwards: normalizeCount(record.forwards),
    transfers: normalizeCount(record.transfers),
    transfers_complete: record.transfers_complete === true,
  }
}

function normalizeCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 100_000)
    : 0
}

function emptyRuntimeSummary(): UpdateRuntimeSummary {
  return {
    ssh_sessions: 0,
    file_sessions: 0,
    forwards: 0,
    transfers: 0,
    transfers_complete: false,
  }
}

function publicConfirmation(
  confirmation: PendingInstallConfirmation,
): UpdateInstallConfirmation {
  return {
    confirmation_token: confirmation.confirmation_token,
    expires_at: confirmation.expires_at,
    state_seq: confirmation.state_seq,
    operation_generation: confirmation.operation_generation,
    summary_revision: confirmation.summary_revision,
    summary: { ...confirmation.summary },
  }
}

function runtimeSummariesEqual(
  left: UpdateRuntimeSummary,
  right: UpdateRuntimeSummary,
) {
  return (
    left.ssh_sessions === right.ssh_sessions
    && left.file_sessions === right.file_sessions
    && left.forwards === right.forwards
    && left.transfers === right.transfers
    && left.transfers_complete === right.transfers_complete
  )
}

function normalizeTtl(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : defaultConfirmationTtlMs
}

function normalizeSummaryTtl(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : defaultSummaryFreshnessTtlMs
}
