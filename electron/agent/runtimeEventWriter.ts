import { randomUUID } from 'node:crypto'
import type { AgentWorkerStartMessage } from './protocol.ts'
import type {
  RuntimeEventInput,
  RuntimeEventKind,
  WorkerCoreClientPort,
} from './workerCoreClient.ts'

const maxEventBatchSize = 64
const maxEventRequestBytes = 768 * 1024
const defaultFlushDelayMs = 32

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
    void this.flush().catch((error) => {
      this.recordFailure(error)
    })
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

function runtimeEventBytes(event: RuntimeEventInput) {
  try {
    return Buffer.byteLength(JSON.stringify(event), 'utf8')
  } catch {
    throw new Error('AGENT_RUNTIME_EVENT_SERIALIZATION_FAILED')
  }
}
