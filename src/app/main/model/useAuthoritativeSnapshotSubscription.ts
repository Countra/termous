import { useEffect, useRef } from 'react'

interface UseAuthoritativeSnapshotSubscriptionOptions<Snapshot> {
  enabled: boolean
  eventsUrl: () => string
  decode: (value: unknown) => Snapshot
  onSnapshot: (snapshot: Snapshot, generation: number) => void
  reconnectDelayMs?: number
}

export function useAuthoritativeSnapshotSubscription<Snapshot>({
  enabled,
  eventsUrl,
  decode,
  onSnapshot,
  reconnectDelayMs = 1_200,
}: UseAuthoritativeSnapshotSubscriptionOptions<Snapshot>) {
  const decodeRef = useRef(decode)
  const onSnapshotRef = useRef(onSnapshot)
  const generationRef = useRef(0)

  useEffect(() => {
    decodeRef.current = decode
    onSnapshotRef.current = onSnapshot
  }, [decode, onSnapshot])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    let disposed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined

    const scheduleReconnect = (): void => {
      if (disposed || reconnectTimer !== undefined) {
        return
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined
        connect()
      }, reconnectDelayMs)
    }

    const connect = (): void => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      let nextSocket: WebSocket
      try {
        nextSocket = new WebSocket(eventsUrl())
      } catch {
        scheduleReconnect()
        return
      }
      socket = nextSocket
      nextSocket.onmessage = (message: MessageEvent<string>) => {
        if (disposed || socket !== nextSocket || generation !== generationRef.current) {
          return
        }
        try {
          onSnapshotRef.current(
            decodeRef.current(JSON.parse(message.data)),
            generation,
          )
        } catch {
          // 忽略单条非法快照，保留连接等待下一份权威状态。
        }
      }
      nextSocket.onerror = () => {
        if (socket === nextSocket) {
          nextSocket.close()
        }
      }
      nextSocket.onclose = () => {
        if (disposed || socket !== nextSocket) {
          return
        }
        socket = undefined
        scheduleReconnect()
      }
    }

    connect()
    return () => {
      disposed = true
      generationRef.current += 1
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [enabled, eventsUrl, reconnectDelayMs])
}
