import { randomUUID } from 'node:crypto'
import type { AgentWorkerStartMessage } from './protocol.ts'
import type {
  RuntimeEventInput,
  RuntimeEventKind,
  WorkerCoreClientPort,
} from './workerCoreClient.ts'

const maxEventBatchSize = 64
const maxEventRequestBytes = 768 * 1024
const maxCoalescedDeltaBytes = 240 * 1024
const defaultFlushDelayMs = 64

interface PendingRuntimeEvent {
  value: RuntimeEventInput
  serializedBytes: number
}

export interface RuntimeEventWriterOptions {
  core: WorkerCoreClientPort
  start: AgentWorkerStartMessage
  runtimeBearer: string
  initialSequence: number
  onFailure: (error: unknown) => void
  flushDelayMs?: number
  newEventID?: () => string
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

export interface RuntimeExternalWriteResult<T> {
  lastSequence: number
  value: T
}

export class RuntimeEventWriter {
  private readonly core: WorkerCoreClientPort
  private readonly start: AgentWorkerStartMessage
  private readonly runtimeBearer: string
  private readonly onFailure: (error: unknown) => void
  private readonly flushDelayMs: number
  private readonly newEventID: () => string
  private readonly setTimeoutImplementation: typeof globalThis.setTimeout
  private readonly clearTimeoutImplementation: typeof globalThis.clearTimeout
  private readonly pending: PendingRuntimeEvent[] = []
  private readonly requestEnvelopeBytes: number
  private sequence: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private sendTail: Promise<void> = Promise.resolve()
  private backgroundFlushActive = false
  private failure: unknown = null
  private failureNotified = false

  constructor(options: RuntimeEventWriterOptions) {
    this.core = options.core
    this.start = options.start
    this.runtimeBearer = options.runtimeBearer
    this.requestEnvelopeBytes = Buffer.byteLength(JSON.stringify({
      generation: options.start.generation,
      events: [],
    }), 'utf8')
    this.sequence = options.initialSequence
    this.onFailure = options.onFailure
    this.flushDelayMs = options.flushDelayMs ?? defaultFlushDelayMs
    this.newEventID = options.newEventID ?? (() => `agew_${randomUUID()}`)
    this.setTimeoutImplementation = options.setTimeout ?? globalThis.setTimeout
    this.clearTimeoutImplementation = options.clearTimeout ?? globalThis.clearTimeout
  }

  push(kind: RuntimeEventKind, payload: Record<string, unknown>) {
    this.assertHealthy()
    const merged = kind === 'message_delta'
      ? this.mergePendingMessageDelta(payload)
      : null
    if (merged) {
      return merged
    }
    const event: RuntimeEventInput = {
      event_id: this.newEventID(),
      generation: this.start.generation,
      sequence: this.sequence + 1,
      kind,
      payload,
    }
    const serializedBytes = runtimeEventBytes(event)
    if (this.requestEnvelopeBytes + serializedBytes > maxEventRequestBytes) {
      throw new Error('AGENT_RUNTIME_EVENT_TOO_LARGE')
    }
    this.sequence = event.sequence
    this.pending.push({ value: event, serializedBytes })
    if (this.pending.length >= maxEventBatchSize) {
      this.flushInBackground()
    } else {
      this.scheduleFlush()
    }
    return event
  }

  async flush() {
    this.clearFlushTimer()
    this.assertHealthy()
    this.enqueuePendingBatches()
    await this.sendTail
    this.assertHealthy()
  }

  async writeExternal<T>(
    write: (
      eventID: string,
      sequence: number,
    ) => Promise<RuntimeExternalWriteResult<T>>,
  ) {
    this.clearFlushTimer()
    this.assertHealthy()
    this.enqueuePendingBatches()
    const eventID = this.newEventID()
    const sequence = ++this.sequence
    let value: T | undefined
    const operation = this.sendTail.then(async () => {
      this.assertHealthy()
      const result = await write(eventID, sequence)
      if (result.lastSequence !== sequence) {
        throw new Error('AGENT_RUNTIME_EVENT_SEQUENCE_INVALID')
      }
      value = result.value
    })
    this.trackOperation(operation)
    await operation
    this.assertHealthy()
    return value as T
  }

  async close() {
    this.clearFlushTimer()
    await this.flush()
  }

  private scheduleFlush() {
    if (this.timer !== null) {
      return
    }
    this.timer = this.setTimeoutImplementation(() => {
      this.timer = null
      this.flushInBackground()
    }, this.flushDelayMs)
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref()
    }
  }

  private clearFlushTimer() {
    if (this.timer === null) {
      return
    }
    this.clearTimeoutImplementation(this.timer)
    this.timer = null
  }

  private flushInBackground() {
    if (this.backgroundFlushActive) {
      return
    }
    this.backgroundFlushActive = true
    void this.flush()
      .catch((error) => {
        this.recordFailure(error)
      })
      .finally(() => {
        this.backgroundFlushActive = false
        if (this.failure === null && this.pending.length > 0) {
          this.scheduleFlush()
        }
      })
  }

  private mergePendingMessageDelta(payload: Record<string, unknown>) {
    const incoming = messageDeltaPayload(payload)
    const previous = this.pending[this.pending.length - 1]
    if (!incoming || previous?.value.kind !== 'message_delta') {
      return null
    }
    const current = messageDeltaPayload(previous.value.payload)
    if (!current
      || current.message_id !== incoming.message_id
      || current.part_id !== incoming.part_id
      || current.kind !== incoming.kind) {
      return null
    }
    const delta = `${current.delta}${incoming.delta}`
    if (Buffer.byteLength(delta, 'utf8') > maxCoalescedDeltaBytes) {
      return null
    }
    const value: RuntimeEventInput = {
      ...previous.value,
      payload: {
        message_delta: {
          message_id: current.message_id,
          part_id: current.part_id,
          kind: current.kind,
          delta,
        },
      },
    }
    const serializedBytes = runtimeEventBytes(value)
    if (this.requestEnvelopeBytes + serializedBytes > maxEventRequestBytes) {
      return null
    }
    previous.value = value
    previous.serializedBytes = serializedBytes
    return value
  }

  private enqueuePendingBatches() {
    while (this.pending.length > 0) {
      const batch: RuntimeEventInput[] = []
      let batchBytes = this.requestEnvelopeBytes
      while (batch.length < maxEventBatchSize && this.pending.length > 0) {
        const next = this.pending[0]
        if (!next) {
          break
        }
        const separatorBytes = batch.length === 0 ? 0 : 1
        if (batch.length > 0
          && batchBytes + separatorBytes + next.serializedBytes > maxEventRequestBytes) {
          break
        }
        this.pending.shift()
        batch.push(next.value)
        batchBytes += separatorBytes + next.serializedBytes
      }
      const expectedSequence = batch[batch.length - 1]?.sequence
      const operation = this.sendTail.then(async () => {
        this.assertHealthy()
        const persisted = await this.core.appendEvents(
          this.start,
          this.runtimeBearer,
          batch,
        )
        if (persisted !== expectedSequence) {
          throw new Error('AGENT_RUNTIME_EVENT_SEQUENCE_INVALID')
        }
      })
      this.trackOperation(operation)
    }
  }

  private trackOperation(operation: Promise<void>) {
    this.sendTail = operation.catch((error) => {
      this.recordFailure(error)
    })
  }

  private recordFailure(error: unknown) {
    if (this.failure === null) {
      this.failure = error
    }
    if (!this.failureNotified) {
      this.failureNotified = true
      this.onFailure(error)
    }
  }

  private assertHealthy() {
    if (this.failure !== null) {
      throw this.failure
    }
  }
}

function messageDeltaPayload(payload: Record<string, unknown>) {
  const value = payload.message_delta
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const delta = value as Record<string, unknown>
  if (typeof delta.message_id !== 'string'
    || typeof delta.part_id !== 'string'
    || (delta.kind !== 'text' && delta.kind !== 'reasoning')
    || typeof delta.delta !== 'string') {
    return null
  }
  return {
    message_id: delta.message_id,
    part_id: delta.part_id,
    kind: delta.kind,
    delta: delta.delta,
  }
}

function runtimeEventBytes(event: RuntimeEventInput) {
  try {
    return Buffer.byteLength(JSON.stringify(event), 'utf8')
  } catch {
    throw new Error('AGENT_RUNTIME_EVENT_SERIALIZATION_FAILED')
  }
}
