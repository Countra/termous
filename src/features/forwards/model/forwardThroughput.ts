export const FORWARD_THROUGHPUT_WINDOW_MS = 1_000
export const FORWARD_THROUGHPUT_IDLE_MS = 1_250
export const FORWARD_THROUGHPUT_PUBLISH_MS = 1_000

const minimumSampleIntervalMs = 100

export function resolveForwardThroughputPublishAt(
  now: number,
  nextPublishAt: number,
  hasScheduledPublish: boolean,
) {
  if (!hasScheduledPublish && nextPublishAt <= now) {
    return now + FORWARD_THROUGHPUT_PUBLISH_MS
  }
  return Math.max(nextPublishAt, now)
}

export interface ForwardThroughput {
  bytesInPerSecond: number
  bytesOutPerSecond: number
  receiving: boolean
  sending: boolean
}

export interface ForwardThroughputObservation {
  forwardId: string
  startedAt?: string
  running: boolean
  bytesIn: number
  bytesOut: number
  at: number
}

export function mapForwardTraffic(
  bytesIn: number,
  bytesOut: number,
  throughput: ForwardThroughput,
) {
  return {
    sentTotal: bytesOut,
    sentPerSecond: throughput.bytesOutPerSecond,
    receivedTotal: bytesIn,
    receivedPerSecond: throughput.bytesInPerSecond,
  }
}

export function resolveForwardThroughputNextWakeAt(
  now: number,
  nextPublishAt: number,
  hasPendingPublish: boolean,
  expiryAt: number | null,
) {
  const deadlines = [
    hasPendingPublish && nextPublishAt > now ? nextPublishAt : null,
    expiryAt !== null && expiryAt > now ? expiryAt : null,
  ].filter((value): value is number => value !== null)
  if (deadlines.length === 0) {
    return null
  }
  return Math.min(...deadlines)
}

interface CounterSample {
  at: number
  total: number
}

interface DirectionState {
  lastTotal: number
  lastActivityAt: number | null
  samples: CounterSample[]
  rate: number
}

export class ForwardThroughputSampler {
  private forwardId = ''
  private startedAt = ''
  private running = false
  private lastObservedAt = 0
  private bytesIn = createDirectionState(0, 0)
  private bytesOut = createDirectionState(0, 0)
  private recoveryFloorIn: number | null = null
  private recoveryFloorOut: number | null = null

  observe(observation: ForwardThroughputObservation): ForwardThroughput {
    const at = normalizeTimestamp(observation.at)
    const bytesIn = normalizeCounter(observation.bytesIn)
    const bytesOut = normalizeCounter(observation.bytesOut)
    const startedAt = observation.startedAt ?? ''
    const identityChanged = observation.forwardId !== this.forwardId || startedAt !== this.startedAt
    const clockRegressed = at < this.lastObservedAt
    const runningChanged = observation.running !== this.running

    if (identityChanged || clockRegressed || runningChanged) {
      this.reset(observation.forwardId, startedAt, observation.running, bytesIn, bytesOut, at)
      return this.current()
    }

    this.lastObservedAt = at
    expireDirection(this.bytesIn, at)
    expireDirection(this.bytesOut, at)
    if (!observation.running) {
      return this.current()
    }

    const input = observeDirectionSafely(this.bytesIn, bytesIn, at, this.recoveryFloorIn)
    this.bytesIn = input.state
    this.recoveryFloorIn = input.recoveryFloor
    const output = observeDirectionSafely(this.bytesOut, bytesOut, at, this.recoveryFloorOut)
    this.bytesOut = output.state
    this.recoveryFloorOut = output.recoveryFloor
    return this.current()
  }

  expire(at: number): ForwardThroughput {
    const normalizedAt = normalizeTimestamp(at)
    if (normalizedAt < this.lastObservedAt) {
      return this.current()
    }
    this.lastObservedAt = normalizedAt
    expireDirection(this.bytesIn, normalizedAt)
    expireDirection(this.bytesOut, normalizedAt)
    return this.current()
  }

  nextExpiryAt(): number | null {
    const deadlines = [
      expiryAt(this.bytesIn),
      expiryAt(this.bytesOut),
    ].filter((value): value is number => value !== null)
    return deadlines.length > 0 ? Math.min(...deadlines) : null
  }

  private reset(
    forwardId: string,
    startedAt: string,
    running: boolean,
    bytesIn: number,
    bytesOut: number,
    at: number,
  ) {
    this.forwardId = forwardId
    this.startedAt = startedAt
    this.running = running
    this.lastObservedAt = at
    this.bytesIn = createDirectionState(bytesIn, at)
    this.bytesOut = createDirectionState(bytesOut, at)
    this.recoveryFloorIn = null
    this.recoveryFloorOut = null
  }

  private current(): ForwardThroughput {
    if (!this.running) {
      return emptyForwardThroughput()
    }
    return {
      bytesInPerSecond: this.bytesIn.rate,
      bytesOutPerSecond: this.bytesOut.rate,
      receiving: this.bytesIn.rate > 0,
      sending: this.bytesOut.rate > 0,
    }
  }
}

export function emptyForwardThroughput(): ForwardThroughput {
  return {
    bytesInPerSecond: 0,
    bytesOutPerSecond: 0,
    receiving: false,
    sending: false,
  }
}

function createDirectionState(total: number, at: number): DirectionState {
  return {
    lastTotal: total,
    lastActivityAt: null,
    samples: [{ at, total }],
    rate: 0,
  }
}

function observeDirection(state: DirectionState, total: number, at: number) {
  if (total === state.lastTotal) {
    return
  }

  const previous = state.samples[state.samples.length - 1]
  if (!previous || at - previous.at > FORWARD_THROUGHPUT_WINDOW_MS) {
    state.samples = [{ at, total }]
    state.lastTotal = total
    state.lastActivityAt = at
    state.rate = 0
    return
  }

  const cutoff = at - FORWARD_THROUGHPUT_WINDOW_MS
  state.samples = rollingSamples([...state.samples, { at, total }], cutoff)
  state.lastTotal = total
  state.lastActivityAt = at

  if (state.samples.length < 2) {
    state.rate = 0
    return
  }
  const first = state.samples[0]
  const last = state.samples[state.samples.length - 1]
  const elapsedMs = last.at - first.at
  const delta = last.total - first.total
  if (elapsedMs < minimumSampleIntervalMs || delta <= 0) {
    state.rate = 0
    return
  }
  const rate = delta * 1_000 / elapsedMs
  state.rate = Number.isFinite(rate) && rate > 0 ? rate : 0
}

function observeDirectionSafely(
  state: DirectionState,
  total: number,
  at: number,
  recoveryFloor: number | null,
) {
  if (recoveryFloor !== null) {
    return {
      state: createDirectionState(total, at),
      recoveryFloor: total >= recoveryFloor ? null : recoveryFloor,
    }
  }
  if (total < state.lastTotal) {
    return {
      state: createDirectionState(total, at),
      recoveryFloor: state.lastTotal,
    }
  }
  observeDirection(state, total, at)
  return { state, recoveryFloor: null }
}

function rollingSamples(samples: CounterSample[], cutoff: number) {
  const firstInside = samples.findIndex((sample) => sample.at >= cutoff)
  if (firstInside <= 0) {
    return firstInside === 0 ? samples : samples.slice(-1)
  }

  const before = samples[firstInside - 1]
  const after = samples[firstInside]
  const elapsed = after.at - before.at
  if (elapsed <= 0) {
    return samples.slice(firstInside)
  }
  const ratio = Math.max(0, Math.min(1, (cutoff - before.at) / elapsed))
  const boundary = {
    at: cutoff,
    total: before.total + (after.total - before.total) * ratio,
  }
  return [boundary, ...samples.slice(firstInside)]
}

function expireDirection(state: DirectionState, at: number) {
  if (
    state.rate > 0
    && state.lastActivityAt !== null
    && at - state.lastActivityAt >= FORWARD_THROUGHPUT_IDLE_MS
  ) {
    state.rate = 0
  }
}

function expiryAt(state: DirectionState) {
  if (state.rate <= 0 || state.lastActivityAt === null) {
    return null
  }
  return state.lastActivityAt + FORWARD_THROUGHPUT_IDLE_MS
}

function normalizeCounter(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return value
}

function normalizeTimestamp(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return value
}
