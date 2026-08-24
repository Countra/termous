import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react'
import {
  emptyVncConnectionMetrics,
  type VncConnectionMetrics,
  type VncTransportMetricsSnapshot,
} from '../model/viewerTypes.ts'

type MetricsListener = () => void

export class VncConnectionMetricsStore {
  private readonly snapshots = new Map<string, VncConnectionMetrics>()
  private readonly generations = new Map<string, number>()
  private readonly listeners = new Map<string, Set<MetricsListener>>()

  activateGeneration(sessionId: string, generation: number) {
    if (this.generations.get(sessionId) === generation) {
      return
    }
    this.generations.set(sessionId, generation)
    this.reset(sessionId)
  }

  publish(sessionId: string, generation: number, metrics: VncTransportMetricsSnapshot) {
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
    this.snapshots.get(sessionId) ?? emptyVncConnectionMetrics
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

export const VncConnectionMetricsContext = createContext<VncConnectionMetricsStore | null>(null)

export function useVncConnectionMetrics(sessionId: string) {
  const store = useContext(VncConnectionMetricsContext)
  if (!store) {
    throw new Error('VncConnectionMetricsContext is required')
  }
  const subscribe = useCallback(
    (listener: MetricsListener) => store.subscribe(sessionId, listener),
    [sessionId, store],
  )
  const snapshot = useCallback(() => store.snapshot(sessionId), [sessionId, store])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
