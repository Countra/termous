import { useSyncExternalStore } from 'react'
import { systemClipboardStore } from './systemClipboardStore.ts'
export function useSystemFileClipboard(id: string) {
  const state = useSyncExternalStore(listener => systemClipboardStore.subscribe(id, listener), () => systemClipboardStore.get(id))
  return state
}
