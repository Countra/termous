import { createContext, useContext } from 'react'
import type { ShortcutActionId, ShortcutPlatform } from './index.ts'
import { ShortcutRuntime } from './index.ts'

export interface ShortcutRuntimeContextValue {
  runtime: ShortcutRuntime
  platform: ShortcutPlatform
  labels: ReadonlyMap<ShortcutActionId, readonly string[]>
  bindingSignatures: ReadonlyMap<ShortcutActionId, string>
}

export const ShortcutRuntimeContext = createContext<ShortcutRuntimeContextValue | null>(null)

export function useShortcutRuntime() {
  const context = useContext(ShortcutRuntimeContext)
  if (!context) {
    throw new Error('useShortcutRuntime must be used within ShortcutRuntimeProvider')
  }
  return context
}

export function useShortcutLabels(actionId: ShortcutActionId) {
  return useShortcutRuntime().labels.get(actionId) ?? []
}
