import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeHostAccessCatalog, type HostAccessCatalog } from '#entities/host-asset'
import { sortSSHAccessProfiles, type SSHAccessProfile } from '#entities/ssh-access-profile'
import type { HostAccessManagementGateway } from './types.ts'

interface HostAccessCatalogState {
  catalog: HostAccessCatalog | null
  sshProfiles: SSHAccessProfile[]
  loading: boolean
  refreshing: boolean
  error: Error | null
}

const initialState: HostAccessCatalogState = {
  catalog: null,
  sshProfiles: [],
  loading: true,
  refreshing: false,
  error: null,
}

export function useHostAccessCatalog(
  hostId: string,
  gateway: HostAccessManagementGateway,
) {
  const [state, setState] = useState<HostAccessCatalogState>(initialState)
  const requestRevisionRef = useRef(0)

  const reload = useCallback(async () => {
    const requestRevision = requestRevisionRef.current + 1
    requestRevisionRef.current = requestRevision
    setState((current) => ({
      ...current,
      loading: current.catalog === null,
      refreshing: current.catalog !== null,
      error: null,
    }))
    try {
      const [catalog, sshProfiles] = await Promise.all([
        gateway.loadCatalog(hostId),
        gateway.listSSHProfiles(),
      ])
      if (requestRevisionRef.current !== requestRevision) {
        return null
      }
      const normalized = normalizeHostAccessCatalog(catalog)
      setState({
        catalog: normalized,
        sshProfiles: sortSSHAccessProfiles(sshProfiles),
        loading: false,
        refreshing: false,
        error: null,
      })
      return normalized
    } catch (error) {
      if (requestRevisionRef.current !== requestRevision) {
        return null
      }
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error : new Error(String(error)),
      }))
      return null
    }
  }, [gateway, hostId])

  useEffect(() => {
    setState(initialState)
    void reload()
    return () => {
      requestRevisionRef.current += 1
    }
  }, [reload])

  return { ...state, reload }
}
