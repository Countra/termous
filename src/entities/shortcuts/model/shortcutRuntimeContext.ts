import { createContext, useContext } from 'react'
import { ShortcutRuntime } from './runtime.ts'
import type { ShortcutActionId, ShortcutPlatform } from './types.ts'

export interface ShortcutRuntimeContextValue {
  runtime: ShortcutRuntime
  platform: ShortcutPlatform
  labels: ReadonlyMap<ShortcutActionId, readonly string[]>
  bindingSignatures: ReadonlyMap<ShortcutActionId, string>
  availability?: Partial<Record<ShortcutActionId, { visible: boolean; available: boolean; unavailableReasonKey?: string }>>
}

// 能力条件由应用层注入，快捷键实体不依赖业务实体。
export function useShortcutAvailability() {
  return useContext(shortcutRuntimeContext)?.availability
}

const shortcutRuntimeContext = createContext<ShortcutRuntimeContextValue | null>(null)

export const ShortcutRuntimeContextProvider = shortcutRuntimeContext.Provider

export function useShortcutRuntime() {
  const context = useContext(shortcutRuntimeContext)
  if (!context) {
    throw new Error('useShortcutRuntime must be used within ShortcutRuntimeProvider')
  }
  return context
}

export function useShortcutLabels(actionId: ShortcutActionId) {
  return useShortcutRuntime().labels.get(actionId) ?? []
}
