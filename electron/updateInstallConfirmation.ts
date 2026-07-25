import { randomUUID } from 'node:crypto'
import type { UpdateSnapshot } from './updateTypes'

const defaultConfirmationTtlMs = 2 * 60 * 1000

export interface UpdateRuntimeSummary {
  ssh_sessions: number
  file_sessions: number
  forwards: number
  transfers: number
}

export interface UpdateInstallConfirmation {
  confirmation_token: string
  expires_at: string
  state_seq: number
  operation_generation: number
  summary: UpdateRuntimeSummary
}

interface PendingInstallConfirmation extends UpdateInstallConfirmation {
  expires_at_ms: number
}

interface UpdateInstallConfirmationAuthorityOptions {
  now?: () => number
  randomToken?: () => string
  ttlMs?: number
}

export class UpdateInstallConfirmationAuthority {
  private readonly now: () => number
  private readonly randomToken: () => string
  private readonly ttlMs: number
  private summary = emptyRuntimeSummary()
  private pending: PendingInstallConfirmation | null = null

  constructor(options: UpdateInstallConfirmationAuthorityOptions = {}) {
    this.now = options.now ?? Date.now
    this.randomToken = options.randomToken ?? randomUUID
    this.ttlMs = normalizeTtl(options.ttlMs)
  }

  updateSummary(value: unknown) {
    this.summary = normalizeRuntimeSummary(value)
    return { ...this.summary }
  }

  issue(snapshot: UpdateSnapshot): UpdateInstallConfirmation {
    if (snapshot.phase !== 'downloaded') {
      throw new Error('update_install_not_ready')
    }
    const now = this.now()
    const confirmation: PendingInstallConfirmation = {
      confirmation_token: this.randomToken(),
      expires_at: new Date(now + this.ttlMs).toISOString(),
      expires_at_ms: now + this.ttlMs,
      state_seq: snapshot.state_seq,
      operation_generation: snapshot.operation_generation,
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
      || snapshot.phase !== 'downloaded'
    ) {
      throw new Error('update_install_confirmation_invalid')
    }
  }

  reconcile(snapshot: UpdateSnapshot) {
    if (
      this.pending
      && (
        this.pending.state_seq !== snapshot.state_seq
        || this.pending.operation_generation !== snapshot.operation_generation
        || snapshot.phase !== 'downloaded'
      )
    ) {
      this.pending = null
    }
  }

  clear() {
    this.pending = null
  }
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
    summary: { ...confirmation.summary },
  }
}

function normalizeTtl(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : defaultConfirmationTtlMs
}
