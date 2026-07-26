const automaticCheckRetryBaseMs = 15 * 60 * 1000
const automaticCheckRetryMaximumMs = 6 * 60 * 60 * 1000

export class AutomaticUpdateRetryPolicy {
  private failureCount = 0
  private retryAt: number | null = null

  getRetryAt() {
    return this.retryAt
  }

  recordFailure(nowValue: number) {
    const now = normalizeTimestamp(nowValue)
    this.failureCount = Math.min(this.failureCount + 1, 32)
    const exponent = Math.min(this.failureCount - 1, 8)
    const delay = Math.min(
      automaticCheckRetryMaximumMs,
      automaticCheckRetryBaseMs * (2 ** exponent),
    )
    this.retryAt = now + delay
    return this.retryAt
  }

  deferAfterManualFailure(nowValue: number) {
    const retryAt = normalizeTimestamp(nowValue) + automaticCheckRetryBaseMs
    this.retryAt = this.retryAt === null
      ? retryAt
      : Math.max(this.retryAt, retryAt)
    return this.retryAt
  }

  reset() {
    this.failureCount = 0
    this.retryAt = null
  }
}

function normalizeTimestamp(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0
}
