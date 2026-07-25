import { createContext, useContext } from 'react'
import type {
  UpdatePreferences,
  UpdatePreferencesPatch,
  UpdateSnapshot,
} from '../../../electron/updateTypes'
import type { UpdateWindowIntent } from '../../../electron/updateWindow'

export interface UpdateRuntimeBridge {
  subscribe: (callback: (snapshot: UpdateSnapshot) => void) => () => void
  check: () => Promise<UpdateSnapshot>
  setPreferences: (
    patch: UpdatePreferencesPatch,
  ) => Promise<UpdatePreferences>
  openWindow: (intent?: UpdateWindowIntent) => Promise<boolean>
  openReleasePage: () => Promise<boolean>
}

export interface UpdateRuntimeValue {
  bridgeAvailable: boolean
  initialized: boolean
  snapshot: UpdateSnapshot | null
  checkForUpdates: () => Promise<UpdateSnapshot | null>
  setUpdatePreferences: (
    patch: UpdatePreferencesPatch,
  ) => Promise<UpdatePreferences | null>
  openUpdateWindow: (intent?: UpdateWindowIntent) => Promise<boolean>
  openReleasePage: () => Promise<boolean>
}

export const UpdateRuntimeContext = createContext<UpdateRuntimeValue | null>(null)

export function useUpdateRuntime() {
  const runtime = useContext(UpdateRuntimeContext)
  if (!runtime) {
    throw new Error('useUpdateRuntime 必须在 UpdateRuntimeProvider 内使用')
  }
  return runtime
}
