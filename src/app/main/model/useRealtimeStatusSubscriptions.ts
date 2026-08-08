import { useEffect, useRef } from 'react'
import type { ForwardEvent } from '#entities/forward'
import type { HostReachabilityEvent } from '#entities/host'

interface UseRealtimeStatusSubscriptionsOptions {
  enabled: boolean
  forwardEventsUrl: () => string
  hostReachabilityEventsUrl: () => string
  onForwardEvent: (event: ForwardEvent) => void
  reloadForwards: () => Promise<unknown>
  onHostReachabilityEvent: (event: HostReachabilityEvent) => void
}

export function useRealtimeStatusSubscriptions({
  enabled,
  forwardEventsUrl,
  hostReachabilityEventsUrl,
  onForwardEvent,
  reloadForwards,
  onHostReachabilityEvent,
}: UseRealtimeStatusSubscriptionsOptions) {
  const onForwardEventRef = useRef(onForwardEvent)
  const reloadForwardsRef = useRef(reloadForwards)
  const onHostReachabilityEventRef = useRef(onHostReachabilityEvent)

  useEffect(() => {
    onForwardEventRef.current = onForwardEvent
    reloadForwardsRef.current = reloadForwards
    onHostReachabilityEventRef.current = onHostReachabilityEvent
  }, [onForwardEvent, onHostReachabilityEvent, reloadForwards])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    let disposed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined

    const handleForwardMessage = (event: MessageEvent<string>) => {
      try {
        onForwardEventRef.current(JSON.parse(event.data) as ForwardEvent)
      } catch {
        // 忽略无法解析的转发事件，避免单条异常消息中断状态同步。
      }
    }

    const connect = () => {
      socket = new WebSocket(forwardEventsUrl())
      socket.onopen = () => {
        void reloadForwardsRef.current().catch(() => undefined)
      }
      socket.onmessage = handleForwardMessage
      socket.onerror = () => {
        socket?.close()
      }
      socket.onclose = () => {
        if (disposed) {
          return
        }
        reconnectTimer = window.setTimeout(connect, 1_200)
      }
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [enabled, forwardEventsUrl])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    let disposed = false
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined

    const connect = () => {
      socket = new WebSocket(hostReachabilityEventsUrl())
      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          onHostReachabilityEventRef.current(
            JSON.parse(event.data) as HostReachabilityEvent,
          )
        } catch {
          // 忽略无法解析的主机在线状态事件，避免单条异常消息中断状态同步。
        }
      }
      socket.onerror = () => {
        socket?.close()
      }
      socket.onclose = () => {
        if (disposed) {
          return
        }
        reconnectTimer = window.setTimeout(connect, 1_500)
      }
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [enabled, hostReachabilityEventsUrl])
}
