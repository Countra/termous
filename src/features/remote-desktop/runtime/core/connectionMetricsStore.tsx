import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react'
import {
  emptyRemoteDesktopConnectionMetrics,
  type RemoteDesktopConnectionMetrics,
  type RemoteDesktopTransportMetricsSnapshot,
} from './viewerContracts.ts'

type MetricsListener = () => void

export class RemoteDesktopConnectionMetricsStore {
  private readonly snapshots = new Map<string, RemoteDesktopConnectionMetrics>()
  private readonly generations = new Map<string, number>()
  private readonly listeners = new Map<string, Set<MetricsListener>>()

  activateGeneration(sessionId: string, generation: number) {
    if (this.generations.get(sessionId) === generation) {
      return
    }
    this.generations.set(sessionId, generation)
    this.reset(sessionId)
  }

  publish(sessionId: string, generation: number, metrics: RemoteDesktopTransportMetricsSnapshot) {
    if (this.generations.get(sessionId) !== generation) {
      return
    }
    this.snapshots.set(sessionId, {
      ...this.snapshot(sessionId),
      ...metrics,
    })
    this.emit(sessionId)
  }

  publishSshRtt(sessionId: string, generation: number, sshRttMs: number, sampledAt: number) {
    if (this.generations.get(sessionId) !== generation) {
      return
    }
    const previous = this.snapshot(sessionId)
    if (sampledAt <= previous.sshRttSampledAt) {
      return
    }
    this.snapshots.set(sessionId, {
      ...previous,
      sshRttMs,
      sshRttSampledAt: sampledAt,
    })
    this.emit(sessionId)
  }

  reset(sessionId: string) {
    if (!this.snapshots.has(sessionId)) {
      return
    }
    this.snapshots.delete(sessionId)
    this.emit(sessionId)
  }

  remove(sessionId: string) {
    this.generations.delete(sessionId)
    this.reset(sessionId)
  }

  clear() {
    const sessionIds = [...this.snapshots.keys()]
    this.snapshots.clear()
    this.generations.clear()
    for (const sessionId of sessionIds) {
      this.emit(sessionId)
    }
  }

  snapshot = (sessionId: string) => (
    this.snapshots.get(sessionId) ?? emptyRemoteDesktopConnectionMetrics
  )

  subscribe = (sessionId: string, listener: MetricsListener) => {
    let sessionListeners = this.listeners.get(sessionId)
    if (!sessionListeners) {
      sessionListeners = new Set()
      this.listeners.set(sessionId, sessionListeners)
    }
    sessionListeners.add(listener)
    return () => {
      sessionListeners?.delete(listener)
      if (sessionListeners?.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
  }

  private emit(sessionId: string) {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener()
    }
  }
}

export const RemoteDesktopConnectionMetricsContext = createContext<RemoteDesktopConnectionMetricsStore | null>(null)

export function useRemoteDesktopConnectionMetrics(sessionId: string) {
  const store = useContext(RemoteDesktopConnectionMetricsContext)
  if (!store) {
    throw new Error('RemoteDesktopConnectionMetricsContext is required')
  }
  const subscribe = useCallback(
    (listener: MetricsListener) => store.subscribe(sessionId, listener),
    [sessionId, store],
  )
  const snapshot = useCallback(() => store.snapshot(sessionId), [sessionId, store])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
