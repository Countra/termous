import { useCallback, useEffect, useRef, useState } from 'react'
import type { Run, Script, WorkflowGateway } from '#entities/desktop-workflow'

export function useWorkflowData(gateway: WorkflowGateway) {
  const [scripts, setScripts] = useState<Script[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [error, setError] = useState<unknown>()
  const [revision, setRevision] = useState(0)
  const request = useRef<AbortController | undefined>(undefined)
  const reload = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    try {
      const [nextScripts, nextRuns] = await Promise.all([gateway.list(controller.signal), gateway.listRuns(controller.signal)])
      if (!controller.signal.aborted) { setScripts(nextScripts); setRuns(nextRuns); setError(undefined); setRevision((value) => value + 1) }
    } catch (reason) { if (!controller.signal.aborted) setError(reason) }
  }, [gateway])
  useEffect(() => {
    let stopped = false; let socket: WebSocket | undefined; let retry: ReturnType<typeof setTimeout> | undefined; let refresh: ReturnType<typeof setTimeout> | undefined
    let backoff = 500
    const connect = () => {
      if (stopped) return
      socket = new WebSocket(gateway.eventsURL())
      socket.onopen = () => { backoff = 500; void reload() }
      socket.onmessage = () => { refresh ??= setTimeout(() => { refresh = undefined; void reload() }, 150) }
      socket.onerror = () => socket?.close()
      socket.onclose = () => { if (!stopped) { retry = setTimeout(connect, backoff); backoff = Math.min(10_000, backoff * 2) } }
    }
    void reload(); connect()
    return () => { stopped = true; clearTimeout(retry); clearTimeout(refresh); socket?.close(); request.current?.abort() }
  }, [gateway, reload])
  return { scripts, runs, error, revision, reload }
}
