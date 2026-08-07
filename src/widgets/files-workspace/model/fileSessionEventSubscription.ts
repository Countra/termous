import { retireWebSocket } from '#shared/websocket'

interface FileSessionEventSubscriptionOptions<TSnapshot> {
  createSocket: () => WebSocket
  getSnapshot: () => Promise<TSnapshot>
  onSnapshot: (snapshot: TSnapshot) => void
  onMessage: (data: unknown) => boolean | 'stop'
  onSnapshotError?: (error: unknown) => 'retry' | 'stop'
  schedule?: (callback: () => void, delayMs: number) => number
  cancelSchedule?: (timer: number) => void
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
}

export interface FileSessionEventSubscription {
  dispose: () => void
}

export function fileSessionEventReconnectDelay(
  attempt: number,
  baseDelayMs = 400,
  maxDelayMs = 5_000,
) {
  return Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt)))
}

export function subscribeFileSessionEvents<TSnapshot>({
  createSocket,
  getSnapshot,
  onSnapshot,
  onMessage,
  onSnapshotError,
  schedule = (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancelSchedule = (timer) => window.clearTimeout(timer),
  reconnectBaseDelayMs = 400,
  reconnectMaxDelayMs = 5_000,
}: FileSessionEventSubscriptionOptions<TSnapshot>): FileSessionEventSubscription {
  let disposed = false
  let generation = 0
  let reconnectAttempt = 0
  let reconnectTimer: number | undefined
  let socket: WebSocket | undefined

  const isCurrent = (expectedGeneration: number, expectedSocket?: WebSocket) => (
    !disposed
    && generation === expectedGeneration
    && (expectedSocket === undefined || socket === expectedSocket)
  )

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== undefined) {
      return
    }
    const scheduledGeneration = ++generation
    const delay = fileSessionEventReconnectDelay(
      reconnectAttempt,
      reconnectBaseDelayMs,
      reconnectMaxDelayMs,
    )
    reconnectAttempt += 1
    reconnectTimer = schedule(() => {
      reconnectTimer = undefined
      void reconcileAndReconnect(scheduledGeneration)
    }, delay)
  }

  const openSocket = () => {
    if (disposed) {
      return
    }
    const socketGeneration = ++generation
    let nextSocket: WebSocket
    try {
      nextSocket = createSocket()
    } catch {
      scheduleReconnect()
      return
    }
    socket = nextSocket
    nextSocket.addEventListener('message', (event) => {
      if (!isCurrent(socketGeneration, nextSocket)) {
        return
      }
      try {
        const disposition = onMessage(event.data)
        if (disposition === 'stop') {
          disposed = true
          generation += 1
          socket = undefined
          retireWebSocket(nextSocket)
          return
        }
        if (disposition) {
          reconnectAttempt = 0
        }
      } catch {
        retireWebSocket(nextSocket)
      }
    })
    nextSocket.addEventListener('close', () => {
      if (!isCurrent(socketGeneration, nextSocket)) {
        return
      }
      socket = undefined
      scheduleReconnect()
    }, { once: true })
  }

  const reconcileAndReconnect = async (expectedGeneration: number) => {
    if (!isCurrent(expectedGeneration)) {
      return
    }
    let snapshot: TSnapshot
    try {
      snapshot = await getSnapshot()
    } catch (error) {
      if (isCurrent(expectedGeneration)) {
        handleSnapshotError(error)
      }
      return
    }
    if (!isCurrent(expectedGeneration)) {
      return
    }
    try {
      onSnapshot(snapshot)
    } catch (error) {
      if (isCurrent(expectedGeneration)) {
        handleSnapshotError(error)
      }
      return
    }
    if (isCurrent(expectedGeneration)) {
      openSocket()
    }
  }

  const handleSnapshotError = (error: unknown) => {
    const disposition = snapshotErrorDisposition(onSnapshotError, error)
    if (disposition === 'stop') {
      generation += 1
      return
    }
    scheduleReconnect()
  }

  openSocket()

  return {
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      generation += 1
      if (reconnectTimer !== undefined) {
        cancelSchedule(reconnectTimer)
        reconnectTimer = undefined
      }
      const currentSocket = socket
      socket = undefined
      if (currentSocket) {
        retireWebSocket(currentSocket)
      }
    },
  }
}

function snapshotErrorDisposition(
  onSnapshotError: ((error: unknown) => 'retry' | 'stop') | undefined,
  error: unknown,
) {
  try {
    return onSnapshotError?.(error) ?? 'retry'
  } catch {
    return 'retry'
  }
}
