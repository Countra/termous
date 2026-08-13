import { createContext, useContext } from 'react'
import type {
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateSnapshot,
} from '#common/contracts'

export interface UpdateRuntimeBridge {
  getState: () => Promise<UpdateSnapshot>
  subscribe: (callback: (snapshot: UpdateSnapshot) => void) => () => void
  setPreferences: (
    patch: UpdatePreferencesPatch,
  ) => Promise<UpdatePreferences>
  openWindow: () => Promise<boolean>
}

export interface UpdateRuntimeValue {
  bridgeAvailable: boolean
  initialized: boolean
  initializationFailed: boolean
  runtimeGeneration: number
  snapshot: UpdateSnapshot | null
  setUpdatePreferences: (
    patch: UpdatePreferencesPatch,
  ) => Promise<UpdatePreferences | null>
  openUpdateWindow: () => Promise<boolean>
  retryInitialization: () => Promise<boolean>
}

export const UpdateRuntimeContext = createContext<UpdateRuntimeValue | null>(null)

export function useUpdateRuntime() {
  const runtime = useContext(UpdateRuntimeContext)
  if (!runtime) {
    throw new Error('useUpdateRuntime 必须在 UpdateRuntimeProvider 内使用')
  }
  return runtime
}
