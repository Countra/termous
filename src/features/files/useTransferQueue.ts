import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type { TransferTask } from '../../types/domain'

interface TransferEventMessage {
  type: 'transfer_update'
  task: TransferTask
}

export function useTransferQueue(api: TermousApi) {
  const [transfers, setTransfers] = useState<TransferTask[]>([])
  const [connected, setConnected] = useState(false)

  const refresh = useCallback(async () => {
    const nextTransfers = await api.transfers()
    setTransfers(nextTransfers ?? [])
  }, [api])

  const upsertTransfer = useCallback((task: TransferTask) => {
    setTransfers((current) => {
      const exists = current.some((item) => item.id === task.id)
      const next = exists ? current.map((item) => (item.id === task.id ? task : item)) : [task, ...current]
      return sortTransfers(next)
    })
  }, [])

  useEffect(() => {
    let disposed = false
    void refresh().catch(() => {
      if (!disposed) {
        setTransfers([])
      }
    })
    return () => {
      disposed = true
    }
  }, [refresh])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    const connectTimer = window.setTimeout(() => {
      if (disposed) {
        return
      }
      socket = new WebSocket(api.transferEventsUrl())
      socket.addEventListener('open', () => {
        if (!disposed) setConnected(true)
      })
      socket.addEventListener('close', () => {
        if (!disposed) setConnected(false)
      })
      socket.addEventListener('error', () => {
        if (!disposed) setConnected(false)
      })
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as TransferEventMessage
          if (message.type === 'transfer_update' && message.task) {
            upsertTransfer(message.task)
          }
        } catch {
          if (!disposed) setConnected(false)
        }
      })
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(connectTimer)
      socket?.close()
    }
  }, [api, upsertTransfer])

  const activeTransfers = useMemo(
    () => transfers.filter((task) => task.status === 'queued' || task.status === 'running'),
    [transfers],
  )

  return { transfers, activeTransfers, connected, refresh, upsertTransfer }
}

function sortTransfers(transfers: TransferTask[]) {
  return [...transfers].sort((left, right) => {
    const leftActive = left.status === 'running' || left.status === 'queued'
    const rightActive = right.status === 'running' || right.status === 'queued'
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1
    }
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })
}
