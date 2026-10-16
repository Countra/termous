import { useSyncExternalStore } from 'react'
import type { SystemClipboardOperation } from '#common/contracts'
import { systemClipboardCapabilities } from './store.ts'
import { selectSystemClipboardOperation } from './selectors.ts'

export function useSystemClipboardOperation(operation: SystemClipboardOperation) {
  const state = useSyncExternalStore(systemClipboardCapabilities.subscribe, systemClipboardCapabilities.get, systemClipboardCapabilities.get)
  return selectSystemClipboardOperation(state, operation)
}
