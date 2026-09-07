import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FileSession } from '#entities/file'
import type { FileNameSearchGateway } from '#features/files'
import type {
  GlobalFileSearchOpenRequest,
  GlobalFileSearchReveal,
  GlobalFileSearchRuntimeValue,
  GlobalFileSearchSource,
} from '../model/types'
import { GlobalFileSearchRuntimeContext } from './useGlobalFileSearchRuntime'

const GlobalFileSearchModal = lazy(() => import('../ui/GlobalFileSearchModal.tsx')
  .then((module) => ({ default: module.GlobalFileSearchModal })))

interface GlobalFileSearchRuntimeProviderProps {
  api: FileNameSearchGateway
  fileSessions: readonly FileSession[]
  children: ReactNode
}

interface GlobalFileSearchRuntimeState {
  open: boolean
  ownerId: string | null
  source: GlobalFileSearchSource
  onReveal: GlobalFileSearchReveal | null
}

const cancelledReveal: GlobalFileSearchReveal = async () => ({ status: 'cancelled' })

export function GlobalFileSearchRuntimeProvider({
  api,
  fileSessions,
  children,
}: GlobalFileSearchRuntimeProviderProps) {
  const [state, setState] = useState<GlobalFileSearchRuntimeState | null>(null)

  const openSearch = useCallback((request: GlobalFileSearchOpenRequest) => {
    setState({ ...request, open: true })
  }, [])

  const closeSearch = useCallback((ownerId: string) => {
    setState((current) => (
      current?.ownerId === ownerId && current.open
        ? { ...current, open: false, ownerId: null, onReveal: null }
        : current
    ))
  }, [])

  useEffect(() => {
    setState((current) => {
      if (!current) {
        return current
      }
      const session = fileSessions.find((item) => item.id === current.source.fileSessionId)
      if (
        session?.status === 'connected'
        && (session.connection_generation ?? 0) === current.source.connectionGeneration
      ) {
        return current
      }
      return null
    })
  }, [
    fileSessions,
    state?.source.connectionGeneration,
    state?.source.fileSessionId,
  ])

  const value = useMemo<GlobalFileSearchRuntimeValue>(() => ({
    openSearch,
    closeSearch,
  }), [closeSearch, openSearch])

  return (
    <GlobalFileSearchRuntimeContext.Provider value={value}>
      {children}
      {state ? (
        <Suspense fallback={null}>
          <GlobalFileSearchModal
            key={`${state.source.fileSessionId}:${state.source.connectionGeneration}`}
            api={api}
            open={state.open}
            source={state.source}
            onReveal={state.onReveal ?? cancelledReveal}
            onClose={() => {
              if (state.ownerId) {
                closeSearch(state.ownerId)
              }
            }}
          />
        </Suspense>
      ) : null}
    </GlobalFileSearchRuntimeContext.Provider>
  )
}
