import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { TermousApi } from '../api/client'
import type { TransferTask } from '../types/domain'
import {
  TransferRuntimeContext,
  mergeTransferSnapshot,
  sortTransfers,
  TransferSnapshotGate,
  type TransferRuntimeValue,
} from './useTransferRuntime'

interface TransferEventMessage {
  type: 'transfer_update'
  task: TransferTask
}

interface TransferRuntimeProviderProps {
  api: TermousApi
  children: ReactNode
}

export function TransferRuntimeProvider({ api, children }: TransferRuntimeProviderProps) {
  const [transfers, setTransfers] = useState<TransferTask[]>([])
  const [connected, setConnected] = useState(false)
  const removedTransferEpochsRef = useRef(new Map<string, number>())
  const eventEpochRef = useRef(0)
  const taskEventEpochRef = useRef(new Map<string, number>())
  const snapshotGateRef = useRef(new TransferSnapshotGate())

  const refresh = useCallback(async () => {
    const request = snapshotGateRef.current.begin(eventEpochRef.current)
    const nextTransfers = await api.transfers()
    if (!snapshotGateRef.current.isCurrent(request)) {
      return
    }
    const snapshot = (nextTransfers ?? [])
      .filter((task) => !removedTransferEpochsRef.current.has(task.id))
    const preserveCurrentIds = new Set<string>()
    for (const [id, epoch] of taskEventEpochRef.current) {
      if (epoch > request.eventEpoch) {
        preserveCurrentIds.add(id)
      } else {
        taskEventEpochRef.current.delete(id)
      }
    }
    setTransfers((current) => mergeTransferSnapshot(
      current,
      snapshot,
      preserveCurrentIds,
    ))
  }, [api])

  const upsertTransfer = useCallback((task: TransferTask) => {
    if (removedTransferEpochsRef.current.has(task.id)) {
      return
    }
    const eventEpoch = eventEpochRef.current + 1
    eventEpochRef.current = eventEpoch
    taskEventEpochRef.current.set(task.id, eventEpoch)
    setTransfers((current) => {
      const exists = current.some((item) => item.id === task.id)
      const next = exists
        ? current.map((item) => (item.id === task.id ? task : item))
        : [task, ...current]
      return sortTransfers(next)
    })
  }, [])

  const removeTransfer = useCallback((id: string) => {
    const eventEpoch = eventEpochRef.current + 1
    eventEpochRef.current = eventEpoch
    taskEventEpochRef.current.set(id, eventEpoch)
    removedTransferEpochsRef.current.set(id, eventEpoch)
    setTransfers((current) => current.filter((task) => task.id !== id))
  }, [])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  useEffect(() => {
    let disposed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined

    const connect = () => {
      const nextSocket = new WebSocket(api.transferEventsUrl())
      socket = nextSocket
      nextSocket.addEventListener('open', () => {
        if (!disposed) {
          setConnected(true)
          void refresh().catch(() => undefined)
        }
      })
      nextSocket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as TransferEventMessage
          if (message.type === 'transfer_update' && message.task) {
            upsertTransfer(message.task)
          }
        } catch {
          nextSocket.close()
        }
      })
      nextSocket.addEventListener('error', () => {
        nextSocket.close()
      })
      nextSocket.addEventListener('close', () => {
        if (disposed || socket !== nextSocket) {
          return
        }
        socket = undefined
        setConnected(false)
        reconnectTimer = window.setTimeout(connect, 1200)
      })
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [api, refresh, upsertTransfer])

  const activeTransfers = useMemo(
    () => transfers.filter((task) => task.status === 'queued' || task.status === 'running'),
    [transfers],
  )
  const value = useMemo<TransferRuntimeValue>(
    () => ({
      transfers,
      activeTransfers,
      connected,
      refresh,
      upsertTransfer,
      removeTransfer,
    }),
    [activeTransfers, connected, refresh, removeTransfer, transfers, upsertTransfer],
  )

  return (
    <TransferRuntimeContext.Provider value={value}>
      {children}
    </TransferRuntimeContext.Provider>
  )
}
