import { useCallback, useEffect, useRef, useState } from 'react'
import type { RuntimeGateways } from '#app/data-runtime'
import { decodeMountEvent, type MountEnvironment, type MountInput, type MountInstance, type MountProfile, type MountStartRequest } from '#entities/mount'
import { useAuthoritativeSnapshotSubscription } from './useAuthoritativeSnapshotSubscription'

export function useMountManagement(gateway: RuntimeGateways['mounts'], enabled: boolean) {
  const [profiles, setProfiles] = useState<MountProfile[]>([])
  const [instances, setInstances] = useState<MountInstance[]>([])
  const [environment, setEnvironment] = useState<MountEnvironment>()
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const generation = useRef(0)
  const reload = useCallback(async () => {
    const current = ++generation.current
    try {
      const [nextProfiles, nextEnvironment] = await Promise.all([gateway.profiles(), gateway.environment()])
      if (current !== generation.current) return
      setProfiles(nextProfiles); setEnvironment(nextEnvironment); setError('')
    } catch (error) {
      if (current === generation.current) setError(error instanceof Error ? error.message : String(error))
    }
  }, [gateway])
  useEffect(() => {
    if (enabled) void reload()
    return () => { generation.current += 1 }
  }, [enabled, reload])
  const eventsUrl = useCallback(() => gateway.eventsUrl(), [gateway])
  useAuthoritativeSnapshotSubscription({
    enabled, eventsUrl, decode: decodeMountEvent,
    onSnapshot: (next) => { setInstances(next); setConnected(true) },
    onAwaitingSnapshot: () => setConnected(false),
  })
  return {
    profiles, instances, environment, error, connected, reload,
    save: async (id: string | undefined, input: MountInput) => { await gateway.save(id, input); await reload() },
    remove: async (profile: MountProfile) => { await gateway.remove(profile); await reload() },
    start: async (input: MountStartRequest) => { await gateway.start(input) },
    action: async (id: string, action: 'sync' | 'reconnect' | 'stop', force = false) => { await gateway.action(id, action, force) },
  }
}
