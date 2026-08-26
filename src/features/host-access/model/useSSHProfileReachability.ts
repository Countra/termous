import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostReachability } from '#entities/host'
import type { SSHProfileReachabilityGateway } from './types.ts'
import {
  decodeSSHProfileReachabilityEvent,
  indexSSHProfileReachability,
  mergeSSHProfileReachabilityEvent,
  type SSHProfileReachabilityIndex,
} from './sshProfileReachability.ts'

export function useSSHProfileReachability(
  gateway: SSHProfileReachabilityGateway,
  enabled = true,
) {
  const [states, setStates] = useState<SSHProfileReachabilityIndex>({})
  const [pendingProfileIds, setPendingProfileIds] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<Error | null>(null)
  const disposedRef = useRef(false)
  const eventRevisionRef = useRef(0)
  const loadRevisionRef = useRef(0)
  const lifecycleRevisionRef = useRef(0)
  const pendingProfileIdsRef = useRef(new Set<string>())

  const applySnapshot = useCallback((items: HostReachability[], eventRevision: number) => {
    if (disposedRef.current || eventRevisionRef.current !== eventRevision) {
      return
    }
    setStates(indexSSHProfileReachability(items))
    setError(null)
  }, [])

  const reload = useCallback(async () => {
    const loadRevision = loadRevisionRef.current + 1
    loadRevisionRef.current = loadRevision
    const eventRevision = eventRevisionRef.current
    try {
      const items = await gateway.loadSSHProfileReachability()
      if (loadRevisionRef.current === loadRevision) {
        applySnapshot(items, eventRevision)
      }
    } catch (cause) {
      if (!disposedRef.current && loadRevisionRef.current === loadRevision) {
        setError(cause instanceof Error ? cause : new Error(String(cause)))
      }
    }
  }, [applySnapshot, gateway])

  const refresh = useCallback(async (sshProfileId: string) => {
    if (pendingProfileIdsRef.current.has(sshProfileId)) {
      return
    }
    pendingProfileIdsRef.current.add(sshProfileId)
    setPendingProfileIds((current) => new Set(current).add(sshProfileId))
    const eventRevision = eventRevisionRef.current
    const lifecycleRevision = lifecycleRevisionRef.current
    try {
      const items = await gateway.refreshSSHProfileReachability([sshProfileId], true)
      const next = items.find((item) => item.ssh_profile_id === sshProfileId)
      if (
        next
        && !disposedRef.current
        && eventRevisionRef.current === eventRevision
        && lifecycleRevisionRef.current === lifecycleRevision
      ) {
        setStates((current) => ({ ...current, [sshProfileId]: next }))
        setError(null)
      }
    } catch (cause) {
      if (!disposedRef.current && lifecycleRevisionRef.current === lifecycleRevision) {
        setError(cause instanceof Error ? cause : new Error(String(cause)))
      }
    } finally {
      if (!disposedRef.current && lifecycleRevisionRef.current === lifecycleRevision) {
        pendingProfileIdsRef.current.delete(sshProfileId)
        setPendingProfileIds((current) => {
          const next = new Set(current)
          next.delete(sshProfileId)
          return next
        })
      }
    }
  }, [gateway])

  useEffect(() => {
    lifecycleRevisionRef.current += 1
    const lifecycleRevision = lifecycleRevisionRef.current
    if (!enabled) {
      disposedRef.current = true
      loadRevisionRef.current += 1
      pendingProfileIdsRef.current.clear()
      setPendingProfileIds((current) => (current.size === 0 ? current : new Set()))
      return undefined
    }
    disposedRef.current = false
    const pendingProfileIds = pendingProfileIdsRef.current
    let active = true
    void reload()
    let reconnectTimer: number | undefined
    let socket: WebSocket | undefined

    const connect = () => {
      if (!active) {
        return
      }
      const currentSocket = new WebSocket(gateway.sshProfileReachabilityEventsUrl())
      socket = currentSocket
      currentSocket.onopen = () => {
        if (!active) return
        void reload()
      }
      currentSocket.onmessage = (message: MessageEvent<string>) => {
        if (!active) return
        const event = decodeSSHProfileReachabilityEvent(message.data)
        if (!event) {
          return
        }
        eventRevisionRef.current += 1
        setStates((current) => mergeSSHProfileReachabilityEvent(current, event))
        setError(null)
      }
      currentSocket.onerror = () => {
        if (!active) return
        currentSocket.close()
      }
      currentSocket.onclose = () => {
        if (active && !disposedRef.current) {
          reconnectTimer = window.setTimeout(connect, 1_500)
        }
      }
    }

    connect()
    return () => {
      active = false
      disposedRef.current = true
      if (lifecycleRevisionRef.current === lifecycleRevision) {
        lifecycleRevisionRef.current += 1
      }
      loadRevisionRef.current += 1
      pendingProfileIds.clear()
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer)
      }
      socket?.close()
    }
  }, [enabled, gateway, reload])

  return { states, pendingProfileIds, error, refresh, reload }
}
