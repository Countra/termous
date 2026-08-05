import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  TransferRuntimeContext,
  mergeTransferSnapshot,
  mergeTransferUpdate,
  sortTransfers,
  transferRefreshRetryDelay,
  TransferSnapshotGate,
  type TransferRuntimeApi,
  type TransferRuntimeValue,
} from '#features/transfers'

type TransferTask = TransferRuntimeValue['transfers'][number]

interface TransferEventMessage {
  type: 'transfer_update'
  task: TransferTask
}

interface TransferRuntimeProviderProps {
  api: TransferRuntimeApi
  children: ReactNode
}

const sharedRuntimes = new WeakMap<TransferRuntimeApi, SharedTransferRuntime>()

export function TransferRuntimeProvider({ api, children }: TransferRuntimeProviderProps) {
  const runtime = useMemo(() => getSharedTransferRuntime(api), [api])
  const value = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  )

  useEffect(() => {
    runtime.retain()
    return () => runtime.release()
  }, [runtime])

  return (
    <TransferRuntimeContext.Provider value={value}>
      {children}
    </TransferRuntimeContext.Provider>
  )
}

function getSharedTransferRuntime(api: TransferRuntimeApi) {
  const existing = sharedRuntimes.get(api)
  if (existing) {
    return existing
  }
  const runtime = new SharedTransferRuntime(api)
  sharedRuntimes.set(api, runtime)
  return runtime
}

class SharedTransferRuntime {
  private transfers: TransferTask[] = []
  private connected = false
  private initialized = false
  private consumers = 0
  private refreshFailureCount = 0
  private refreshPromise?: Promise<void>
  private refreshRetryTimer?: number
  private socket?: WebSocket
  private reconnectTimer?: number
  private stopTimer?: number
  private readonly listeners = new Set<() => void>()
  private readonly removedTransferEpochs = new Map<string, number>()
  private eventEpoch = 0
  private readonly taskEventEpochs = new Map<string, number>()
  private readonly snapshotGate = new TransferSnapshotGate()
  private snapshot: TransferRuntimeValue

  constructor(private readonly api: TransferRuntimeApi) {
    this.snapshot = this.buildSnapshot()
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  retain() {
    this.consumers += 1
    if (this.stopTimer !== undefined) {
      window.clearTimeout(this.stopTimer)
      this.stopTimer = undefined
    }
    if (this.consumers === 1) {
      void this.refresh().catch(() => undefined)
      this.connect()
    }
  }

  release() {
    this.consumers = Math.max(0, this.consumers - 1)
    if (this.consumers !== 0 || this.stopTimer !== undefined) {
      return
    }
    this.stopTimer = window.setTimeout(() => {
      this.stopTimer = undefined
      if (this.consumers === 0) {
        this.stop()
      }
    }, 0)
  }

  refresh = () => {
    if (this.refreshPromise) {
      return this.refreshPromise
    }
    if (this.refreshRetryTimer !== undefined) {
      window.clearTimeout(this.refreshRetryTimer)
      this.refreshRetryTimer = undefined
    }
    const operation = this.performRefresh()
      .catch((error) => {
        this.scheduleRefreshRetry()
        throw error
      })
      .finally(() => {
        if (this.refreshPromise === operation) {
          this.refreshPromise = undefined
        }
      })
    this.refreshPromise = operation
    return operation
  }

  private async performRefresh() {
    const request = this.snapshotGate.begin(this.eventEpoch)
    const nextTransfers = await this.api.transfers()
    if (!this.snapshotGate.isCurrent(request)) {
      return
    }
    this.initialized = this.connected
    this.refreshFailureCount = 0
    const remoteTransfers = nextTransfers ?? []
    const remoteIds = new Set(remoteTransfers.map((task) => task.id))
    for (const [id, removedEpoch] of this.removedTransferEpochs) {
      if (!remoteIds.has(id) && removedEpoch <= request.eventEpoch) {
        this.removedTransferEpochs.delete(id)
        this.taskEventEpochs.delete(id)
      }
    }
    const snapshot = remoteTransfers.filter((task) => !this.removedTransferEpochs.has(task.id))
    const preserveCurrentIds = new Set<string>()
    for (const [id, epoch] of this.taskEventEpochs) {
      if (epoch > request.eventEpoch) {
        preserveCurrentIds.add(id)
      } else {
        this.taskEventEpochs.delete(id)
      }
    }
    this.transfers = mergeTransferSnapshot(this.transfers, snapshot, preserveCurrentIds)
    this.publish()
  }

  private scheduleRefreshRetry() {
    if (this.consumers === 0 || this.refreshRetryTimer !== undefined) {
      return
    }
    this.refreshFailureCount += 1
    const delay = transferRefreshRetryDelay(this.refreshFailureCount)
    this.refreshRetryTimer = window.setTimeout(() => {
      this.refreshRetryTimer = undefined
      void this.refresh().catch(() => undefined)
    }, delay)
  }

  upsertTransfer = (task: TransferTask) => {
    if (this.removedTransferEpochs.has(task.id)) {
      return
    }
    this.eventEpoch += 1
    this.taskEventEpochs.set(task.id, this.eventEpoch)
    const current = this.transfers.find((item) => item.id === task.id)
    const nextTask = current ? mergeTransferUpdate(current, task) : task
    if (nextTask === current) {
      return
    }
    this.transfers = sortTransfers(current
      ? this.transfers.map((item) => (item.id === task.id ? nextTask : item))
      : [nextTask, ...this.transfers])
    this.publish()
  }

  removeTransfer = (id: string) => {
    this.eventEpoch += 1
    this.taskEventEpochs.set(id, this.eventEpoch)
    this.removedTransferEpochs.set(id, this.eventEpoch)
    this.transfers = this.transfers.filter((task) => task.id !== id)
    this.publish()
  }

  private connect() {
    if (this.socket || this.consumers === 0) {
      return
    }
    const socket = new WebSocket(this.api.transferEventsUrl())
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return
      }
      this.connected = true
      this.publish()
      void this.refresh().catch(() => undefined)
    })
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as TransferEventMessage
        if (message.type === 'transfer_update' && message.task) {
          this.upsertTransfer(message.task)
        }
      } catch {
        socket.close()
      }
    })
    socket.addEventListener('error', () => socket.close())
    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return
      }
      this.socket = undefined
      this.connected = false
      this.initialized = false
      this.publish()
      if (this.consumers > 0) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = undefined
          this.connect()
        }, 1200)
      }
    })
  }

  private stop() {
    if (this.reconnectTimer !== undefined) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    if (this.refreshRetryTimer !== undefined) {
      window.clearTimeout(this.refreshRetryTimer)
      this.refreshRetryTimer = undefined
    }
    const socket = this.socket
    this.socket = undefined
    this.connected = false
    this.initialized = false
    socket?.close()
    this.publish()
  }

  private buildSnapshot(): TransferRuntimeValue {
    return {
      transfers: this.transfers,
      activeTransfers: this.transfers.filter((task) => task.status === 'queued' || task.status === 'running'),
      connected: this.connected,
      initialized: this.initialized,
      refresh: this.refresh,
      upsertTransfer: this.upsertTransfer,
      removeTransfer: this.removeTransfer,
    }
  }

  private publish() {
    this.snapshot = this.buildSnapshot()
    this.listeners.forEach((listener) => listener())
  }
}
