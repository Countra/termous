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

export function useSessionMonitor({ api, session, enabled, intervalSeconds }: UseSessionMonitorOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const intervalRef = useRef(intervalSeconds)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<LinuxMonitorStatus>('warming')
  const [message, setMessage] = useState('')
  const [sample, setSample] = useState<LinuxMonitorSnapshot | null>(null)
  const [history, setHistory] = useState<LinuxMonitorSnapshot[]>([])
  const [paused, setPausedState] = useState(false)

  useEffect(() => {
    intervalRef.current = intervalSeconds
  }, [intervalSeconds])

  useEffect(() => {
    setPausedState(false)
  }, [session?.id])

  useEffect(() => {
    if (!enabled || !session?.id || session.kind !== 'ssh' || session.status !== 'connected') {
      wsRef.current?.close()
      wsRef.current = null
      setConnected(false)
      return undefined
    }
    const ws = new WebSocket(api.sessionMonitorUrl(session.id))
    wsRef.current = ws
    setStatus('warming')
    setMessage('')
    ws.addEventListener('open', () => {
      setConnected(true)
      ws.send(JSON.stringify({ type: 'configure', interval_seconds: intervalRef.current }))
    })
    ws.addEventListener('message', (event) => {
      const msg = parseMonitorMessage(event.data)
      if (!msg) {
        return
      }
      if (msg.type === 'sample' && msg.sample) {
        setSample(msg.sample)
        setStatus(msg.sample.status)
        setMessage('')
        setHistory((current) => [...current, msg.sample as LinuxMonitorSnapshot].slice(-120))
        return
      }
      if (msg.type === 'status' || msg.type === 'error') {
        if (msg.status) {
          setStatus(msg.status)
        }
        if (msg.message) {
          setMessage(msg.message)
        }
      }
    })
    ws.addEventListener('close', () => {
      setConnected(false)
      if (wsRef.current === ws) {
        wsRef.current = null
      }
    })
    ws.addEventListener('error', () => {
      setStatus('failed')
      setMessage('')
    })
    return () => {
      ws.close()
      if (wsRef.current === ws) {
        wsRef.current = null
      }
      setConnected(false)
    }
  }, [api, enabled, session?.id, session?.kind, session?.status])

  useEffect(() => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'configure', interval_seconds: intervalSeconds }))
    }
  }, [intervalSeconds])

  const pause = useCallback(() => {
    setPausedState(true)
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pause' }))
    }
  }, [])

  const resume = useCallback(() => {
    setPausedState(false)
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resume' }))
    }
  }, [])

  return { connected, status, message, sample, history, paused, pause, resume }
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
