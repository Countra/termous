import type {
  CommandDispatchOutputGapReason,
  CommandDispatchTarget,
  CommandDispatchTask,
} from '#entities/command-dispatch'
import { retireWebSocket } from '#shared/websocket'
import type { CommandDispatchGateway } from '../api/commandDispatchGateway.ts'
import { decodeCommandDispatchOutputControl } from './commandDispatchProtocol.ts'

export interface CommandDispatchOutputSnapshot {
  taskId: string
  sessionId: string
  revision: number
  data: Uint8Array
  chunk: Uint8Array
  resetRevision: number
  connected: boolean
  ended: boolean
  truncated: boolean
  gapReason?: CommandDispatchOutputGapReason | 'protocol_error'
  streamEpoch?: string
  nextOffset?: string
}

interface OutputEntry {
  taskId: string
  sessionId: string
  socket: WebSocket | null
  reconnectTimer: number
  reconnectDelay: number
  disposed: boolean
  listeners: Set<() => void>
  snapshot: CommandDispatchOutputSnapshot
}

interface CommandDispatchOutputFrame {
  epoch: string
  startOffset: bigint
  data: Uint8Array
}

const maximumOutputBytes = 1024 * 1024
const initialReconnectDelay = 400
const maximumReconnectDelay = 5_000

export class CommandDispatchOutputStore {
  private readonly entries = new Map<string, OutputEntry>()
  private readonly emptySnapshots = new Map<string, CommandDispatchOutputSnapshot>()
  private readonly api: CommandDispatchGateway
  private readonly decodeOutputFrame: (
    payload: ArrayBuffer | Uint8Array,
  ) => CommandDispatchOutputFrame
  private retainedTaskId = ''

  constructor(
    api: CommandDispatchGateway,
    decodeOutputFrame: (
      payload: ArrayBuffer | Uint8Array,
    ) => CommandDispatchOutputFrame,
  ) {
    this.api = api
    this.decodeOutputFrame = decodeOutputFrame
  }

  retainTask(task: CommandDispatchTask | null) {
    if (!task) {
      this.disposeEntries()
      this.retainedTaskId = ''
      return
    }
    if (task.id !== this.retainedTaskId) {
      this.disposeEntries()
      this.retainedTaskId = task.id
    }
    const retainedKeys = new Set<string>()
    for (const target of task.targets) {
      const key = outputKey(task.id, target.session_id)
      retainedKeys.add(key)
      if (!this.entries.has(key)) {
        this.createEntry(task.id, target)
      }
    }
    for (const [key, entry] of this.entries) {
      if (!retainedKeys.has(key)) {
        this.disposeEntry(entry)
        this.entries.delete(key)
        this.emptySnapshots.delete(key)
      }
    }
  }

  subscribe(taskId: string, sessionId: string, listener: () => void) {
    const entry = this.entries.get(outputKey(taskId, sessionId))
    if (!entry) {
      return () => undefined
    }
    entry.listeners.add(listener)
    if (!entry.socket && !entry.snapshot.ended) {
      this.connect(entry)
    }
    return () => {
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) {
        this.deactivateEntry(entry)
      }
    }
  }

  getSnapshot(taskId: string, sessionId: string) {
    return this.entries.get(outputKey(taskId, sessionId))?.snapshot
      ?? this.emptyOutputSnapshot(taskId, sessionId)
  }

  dispose() {
    this.disposeEntries()
    this.retainedTaskId = ''
  }

  private createEntry(taskId: string, target: CommandDispatchTarget) {
    const key = outputKey(taskId, target.session_id)
    const entry: OutputEntry = {
      taskId,
      sessionId: target.session_id,
      socket: null,
      reconnectTimer: 0,
      reconnectDelay: initialReconnectDelay,
      disposed: false,
      listeners: new Set(),
      snapshot: this.emptyOutputSnapshot(taskId, target.session_id),
    }
    this.entries.set(key, entry)
    this.emptySnapshots.delete(key)
    return entry
  }

  private connect(entry: OutputEntry) {
    if (entry.disposed || entry.listeners.size === 0 || entry.socket || entry.reconnectTimer) {
      return
    }
    const cursor = entry.snapshot.streamEpoch && entry.snapshot.nextOffset
      ? {
          streamEpoch: entry.snapshot.streamEpoch,
          lastOffset: entry.snapshot.nextOffset,
        }
      : undefined
    let socket: WebSocket
    try {
      socket = new WebSocket(this.api.targetOutputUrl(entry.taskId, entry.sessionId, cursor))
    } catch {
      this.scheduleReconnect(entry)
      return
    }
    entry.socket = socket
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('open', () => {
      if (entry.socket !== socket) return
      entry.reconnectDelay = initialReconnectDelay
      this.publish(entry, { connected: true })
    })
    socket.addEventListener('message', (event) => {
      if (entry.socket !== socket) return
      if (typeof event.data === 'string') {
        this.handleControl(entry, event.data)
      } else if (event.data instanceof ArrayBuffer) {
        this.handleBinary(entry, event.data)
      } else if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((data) => {
          if (!entry.disposed && entry.socket === socket) {
            this.handleBinary(entry, data)
          }
        })
      }
    })
    socket.addEventListener('close', () => {
      if (entry.socket !== socket) return
      entry.socket = null
      this.publish(entry, { connected: false })
      if (!entry.snapshot.ended) {
        this.scheduleReconnect(entry)
      }
    })
    socket.addEventListener('error', () => {
      if (entry.socket === socket) socket.close()
    })
  }

  private handleControl(entry: OutputEntry, payload: string) {
    try {
      const event = decodeCommandDispatchOutputControl(JSON.parse(payload))
      if (!event) {
        return
      }
      switch (event.type) {
        case 'output_attached': {
          if (event.task_id !== entry.taskId || event.session_id !== entry.sessionId) {
            return
          }
          const resetForEpoch = Boolean(
            entry.snapshot.streamEpoch
            && entry.snapshot.streamEpoch !== event.stream.epoch,
          )
          this.publish(entry, {
            data: resetForEpoch ? new Uint8Array() : entry.snapshot.data,
            resetRevision: resetForEpoch
              ? entry.snapshot.resetRevision + 1
              : entry.snapshot.resetRevision,
            streamEpoch: event.stream.epoch,
            nextOffset: event.stream.resume_offset,
            gapReason: event.reason,
            // attached.ended 只说明生产端已结束；仍需等待本连接完成重放并收到 output_ended。
            ended: false,
            truncated: event.stream.truncated || resetForEpoch || entry.snapshot.truncated,
          })
          return
        }
        case 'output_gap':
          if (
            entry.snapshot.streamEpoch
            && entry.snapshot.streamEpoch !== event.stream.epoch
          ) {
            this.publish(entry, {
              data: new Uint8Array(),
              resetRevision: entry.snapshot.resetRevision + 1,
              gapReason: event.reason,
              streamEpoch: event.stream.epoch,
              nextOffset: event.stream.resume_offset,
              truncated: true,
            })
            return
          }
          this.publish(entry, {
            gapReason: event.reason,
            streamEpoch: event.stream.epoch,
            nextOffset: event.stream.resume_offset,
            truncated: event.stream.truncated || entry.snapshot.truncated,
          })
          return
        case 'output_ended':
          if (event.target.session_id !== entry.sessionId) {
            return
          }
          this.publish(entry, {
            ended: true,
            streamEpoch: event.stream.epoch,
            nextOffset: event.stream.next_offset,
            truncated: event.stream.truncated || entry.snapshot.truncated,
          })
          return
      }
    } catch {
      // 单条控制帧异常不污染已捕获输出，断线重放会继续按游标对账。
    }
  }

  private handleBinary(entry: OutputEntry, payload: ArrayBuffer) {
    try {
      const frame = this.decodeOutputFrame(payload)
      const currentEpoch = entry.snapshot.streamEpoch
      if (currentEpoch && currentEpoch !== frame.epoch) {
        this.publish(entry, { gapReason: 'epoch_mismatch' })
        entry.socket?.close()
        return
      }
      const expectedOffset = entry.snapshot.nextOffset === undefined
        ? frame.startOffset
        : BigInt(entry.snapshot.nextOffset)
      const frameEnd = frame.startOffset + BigInt(frame.data.byteLength)
      if (frame.startOffset > expectedOffset) {
        this.publish(entry, {
          gapReason: 'offset_ahead',
          streamEpoch: frame.epoch,
          nextOffset: frame.startOffset.toString(),
        })
      }
      if (frameEnd <= expectedOffset) {
        return
      }
      const duplicateLength = frame.startOffset < expectedOffset
        ? Number(expectedOffset - frame.startOffset)
        : 0
      const data = frame.data.slice(duplicateLength)
      const appended = appendBoundedOutput(entry.snapshot.data, data)
      this.publish(entry, {
        data: appended.data,
        chunk: appended.truncated ? new Uint8Array() : data,
        resetRevision: appended.truncated
          ? entry.snapshot.resetRevision + 1
          : entry.snapshot.resetRevision,
        streamEpoch: frame.epoch,
        nextOffset: frameEnd.toString(),
        truncated: entry.snapshot.truncated || appended.truncated,
      })
    } catch {
      // 畸形帧不能继续等待同一连接的 ended，否则会把缺失尾部误报为完整输出。
      this.invalidateConnection(entry, 'protocol_error')
    }
  }

  private invalidateConnection(
    entry: OutputEntry,
    reason: CommandDispatchOutputSnapshot['gapReason'],
  ) {
    const socket = entry.socket
    entry.socket = null
    this.publish(entry, {
      connected: false,
      ended: false,
      gapReason: reason,
      truncated: true,
    })
    if (socket) {
      retireWebSocket(socket)
    }
    this.scheduleReconnect(entry)
  }

  private publish(entry: OutputEntry, patch: Partial<CommandDispatchOutputSnapshot>) {
    entry.snapshot = {
      ...entry.snapshot,
      ...patch,
      chunk: patch.chunk ?? new Uint8Array(),
      revision: entry.snapshot.revision + 1,
    }
    entry.listeners.forEach((listener) => listener())
  }

  private scheduleReconnect(entry: OutputEntry) {
    if (
      entry.disposed
      || entry.listeners.size === 0
      || entry.reconnectTimer
      || entry.snapshot.ended
    ) {
      return
    }
    const delay = entry.reconnectDelay
    entry.reconnectDelay = Math.min(entry.reconnectDelay * 2, maximumReconnectDelay)
    entry.reconnectTimer = window.setTimeout(() => {
      entry.reconnectTimer = 0
      this.connect(entry)
    }, delay)
  }

  private disposeEntries() {
    this.entries.forEach((entry) => this.disposeEntry(entry))
    this.entries.clear()
    this.emptySnapshots.clear()
  }

  private disposeEntry(entry: OutputEntry) {
    entry.disposed = true
    this.deactivateEntry(entry)
    entry.listeners.clear()
  }

  private deactivateEntry(entry: OutputEntry) {
    if (entry.reconnectTimer) {
      window.clearTimeout(entry.reconnectTimer)
      entry.reconnectTimer = 0
    }
    const socket = entry.socket
    entry.socket = null
    if (socket) {
      retireWebSocket(socket)
    }
    if (entry.snapshot.connected) {
      this.publish(entry, { connected: false })
    }
  }

  private emptyOutputSnapshot(taskId: string, sessionId: string) {
    const key = outputKey(taskId, sessionId)
    const existing = this.emptySnapshots.get(key)
    if (existing) {
      return existing
    }
    const snapshot: CommandDispatchOutputSnapshot = {
      taskId,
      sessionId,
      revision: 0,
      data: new Uint8Array(),
      chunk: new Uint8Array(),
      resetRevision: 0,
      connected: false,
      ended: false,
      truncated: false,
    }
    this.emptySnapshots.set(key, snapshot)
    return snapshot
  }
}

function outputKey(taskId: string, sessionId: string) {
  return `${taskId}\u0000${sessionId}`
}

function appendBoundedOutput(current: Uint8Array, next: Uint8Array) {
  if (next.byteLength >= maximumOutputBytes) {
    return {
      data: next.slice(next.byteLength - maximumOutputBytes),
      truncated: true,
    }
  }
  const overflow = Math.max(0, current.byteLength + next.byteLength - maximumOutputBytes)
  const retained = overflow > 0 ? current.slice(overflow) : current
  const data = new Uint8Array(retained.byteLength + next.byteLength)
  data.set(retained)
  data.set(next, retained.byteLength)
  return { data, truncated: overflow > 0 }
}
