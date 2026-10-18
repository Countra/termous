import { useCallback, useSyncExternalStore } from 'react'
import { systemClipboardStore } from './systemClipboardStore.ts'
export const prepareSystemFileClipboard = (id: string) => systemClipboardStore.prepare(id)

export function useSystemFileClipboard(id: string) {
  const subscribe = useCallback((listener: () => void) => systemClipboardStore.subscribe(id, listener), [id])
  const snapshot = useCallback(() => systemClipboardStore.get(id), [id])
  const state = useSyncExternalStore(subscribe, snapshot)
  return state
}
