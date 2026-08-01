import { useCallback, useEffect, useRef, useState } from 'react'
import type { TermousApi } from '../../api/client'
import type { LinuxMonitorSnapshot, LinuxMonitorStatus, Session } from '../../types/domain'

type MonitorMessage =
  | {
      type: 'status' | 'error'
      status?: LinuxMonitorStatus
      message?: string
      code?: string
    }
  | {
      type: 'sample'
      status?: LinuxMonitorStatus
      sample?: LinuxMonitorSnapshot
    }
  | {
      type: 'pong'
    }

interface UseSessionMonitorOptions {
  api: TermousApi
  session: Session | null
  enabled: boolean
  intervalSeconds: number
}

interface MonitorSessionState {
  connected: boolean
  status: LinuxMonitorStatus
  message: string
  sample: LinuxMonitorSnapshot | null
  history: LinuxMonitorSnapshot[]
  paused: boolean
}

const emptyMonitorState: MonitorSessionState = {
  connected: false,
  status: 'warming',
  message: '',
  sample: null,
  history: [],
  paused: false,
}

function createMonitorState(): MonitorSessionState {
  return { ...emptyMonitorState, history: [] }
}

export function useSessionMonitor({ api, session, enabled, intervalSeconds }: UseSessionMonitorOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef(intervalSeconds)
  const statesRef = useRef<Record<string, MonitorSessionState>>({})
  const [states, setStates] = useState<Record<string, MonitorSessionState>>({})
  const sessionId = session?.id ?? ''
  const monitorable = Boolean(sessionId && session?.kind === 'ssh' && session.status === 'connected')
  const currentState = monitorable ? states[sessionId] ?? emptyMonitorState : emptyMonitorState

  const updateSessionState = useCallback((id: string, updater: (current: MonitorSessionState) => MonitorSessionState) => {
    if (!id) {
      return
    }
    setStates((current) => {
      const previous = current[id] ?? createMonitorState()
      const next = updater(previous)
      if (next === previous) {
        return current
      }
      return { ...current, [id]: next }
    })
  }, [])

  const deleteSessionState = useCallback((id: string) => {
    if (!id) {
      return
    }
    setStates((current) => {
      if (!current[id]) {
        return current
      }
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  useEffect(() => {
    intervalRef.current = intervalSeconds
  }, [intervalSeconds])

  useEffect(() => {
    statesRef.current = states
  }, [states])

  useEffect(() => {
    if (!sessionId) {
      wsRef.current?.close()
      wsRef.current = null
      return undefined
    }
    if (!monitorable) {
      wsRef.current?.close()
      wsRef.current = null
      deleteSessionState(sessionId)
      return undefined
    }
    if (!enabled) {
      wsRef.current?.close()
      wsRef.current = null
      updateSessionState(sessionId, (current) => ({ ...current, connected: false }))
      return undefined
    }
    const ws = new WebSocket(api.sessionMonitorUrl(sessionId))
    wsRef.current = ws
    let disposed = false
    updateSessionState(sessionId, (current) => ({ ...current, connected: false, status: 'warming', message: '' }))
    ws.addEventListener('open', () => {
      if (disposed) {
        return
      }
      updateSessionState(sessionId, (current) => ({ ...current, connected: true }))
      ws.send(JSON.stringify({ type: 'configure', interval_seconds: intervalRef.current }))
      if (statesRef.current[sessionId]?.paused) {
        ws.send(JSON.stringify({ type: 'pause' }))
      }
    })
    ws.addEventListener('message', (event) => {
      if (disposed) {
        return
      }
      const msg = parseMonitorMessage(event.data)
      if (!msg) {
        return
      }
      if (msg.type === 'sample' && msg.sample) {
        const sample = normalizeMonitorSnapshot(msg.sample)
        updateSessionState(sessionId, (current) => ({
          ...current,
          sample,
          status: sample.status ?? current.status,
          message: '',
          history: [...current.history, createMonitorHistorySample(sample)].slice(-120),
        }))
        return
      }
      if (msg.type === 'status' || msg.type === 'error') {
        updateSessionState(sessionId, (current) => ({
          ...current,
          status: msg.status ?? current.status,
          message: msg.message ?? current.message,
        }))
      }
    })
    ws.addEventListener('close', () => {
      if (disposed) {
        return
      }
      updateSessionState(sessionId, (current) => ({ ...current, connected: false }))
      if (wsRef.current === ws) {
        wsRef.current = null
      }
    })
    ws.addEventListener('error', () => {
      if (disposed) {
        return
      }
      updateSessionState(sessionId, (current) => ({ ...current, connected: false, status: 'failed', message: '' }))
    })
    return () => {
      disposed = true
      ws.close()
      if (wsRef.current === ws) {
        wsRef.current = null
      }
      updateSessionState(sessionId, (current) => ({ ...current, connected: false }))
    }
  }, [api, deleteSessionState, enabled, monitorable, sessionId, updateSessionState])

  useEffect(() => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'configure', interval_seconds: intervalSeconds }))
    }
  }, [intervalSeconds])

  const pause = useCallback(() => {
    if (!sessionId) {
      return
    }
    updateSessionState(sessionId, (current) => ({ ...current, paused: true, status: 'paused' }))
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pause' }))
    }
  }, [sessionId, updateSessionState])

  const resume = useCallback(() => {
    if (!sessionId) {
      return
    }
    updateSessionState(sessionId, (current) => ({ ...current, paused: false, status: 'ready' }))
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resume' }))
    }
  }, [sessionId, updateSessionState])

  return { ...currentState, pause, resume }
}

function normalizeMonitorSnapshot(sample: LinuxMonitorSnapshot): LinuxMonitorSnapshot {
  const diskIO = sample.disk_io
  return {
    ...sample,
    cpu: {
      ...sample.cpu,
      cores: Array.isArray(sample.cpu?.cores) ? sample.cpu.cores : [],
    },
    networks: Array.isArray(sample.networks) ? sample.networks : [],
    disks: Array.isArray(sample.disks) ? sample.disks : [],
    disk_io: {
      status: diskIO?.status ?? 'unsupported',
      devices: Array.isArray(diskIO?.devices) ? diskIO.devices : [],
    },
  }
}

function createMonitorHistorySample(sample: LinuxMonitorSnapshot): LinuxMonitorSnapshot {
  if (sample.cpu.cores.length === 0) {
    return sample
  }
  return {
    ...sample,
    cpu: {
      ...sample.cpu,
      cores: [],
    },
  }
}

function parseMonitorMessage(data: unknown): MonitorMessage | null {
  if (typeof data !== 'string') {
    return null
  }
  try {
    return JSON.parse(data) as MonitorMessage
  } catch {
    return null
  }
}
