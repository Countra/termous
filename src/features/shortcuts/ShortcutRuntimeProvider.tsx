import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { getTermousBridge } from '#shared/bridge'
import type { ShortcutSettings } from '../../types/domain'
import {
  compileShortcutIndex,
  formatShortcutChord,
  normalizeShortcutPlatform,
  resolveEffectiveShortcutBindings,
  shortcutChordSignature,
  ShortcutRuntime,
  type ShortcutActionId,
  type ShortcutHandler,
} from './index.ts'
import {
  ShortcutRuntimeContext,
  type ShortcutRuntimeContextValue,
  useShortcutRuntime,
} from './shortcutRuntimeContext'

interface ShortcutRuntimeProviderProps {
  settings: ShortcutSettings
  children: ReactNode
}

export function ShortcutRuntimeProvider({
  settings,
  children,
}: ShortcutRuntimeProviderProps) {
  const platform = useMemo(() => normalizeShortcutPlatform(getTermousBridge()?.platform), [])
  const effectiveBindings = useMemo(
    () => resolveEffectiveShortcutBindings(settings),
    [settings],
  )
  const index = useMemo(
    () => compileShortcutIndex(effectiveBindings, platform),
    [effectiveBindings, platform],
  )
  const runtimeRef = useRef<ShortcutRuntime | null>(null)
  if (!runtimeRef.current) {
    runtimeRef.current = new ShortcutRuntime({ index })
  }
  const runtime = runtimeRef.current
  useLayoutEffect(() => {
    runtime.updateIndex(index)
  }, [index, runtime])
  const labels = useMemo(() => new Map(effectiveBindings.map((binding) => [
    binding.actionId,
    binding.bindings.map((shortcut) => formatShortcutChord(shortcut, platform)),
  ])), [effectiveBindings, platform])
  const bindingSignatures = useMemo(() => new Map(effectiveBindings.map((binding) => [
    binding.actionId,
    binding.bindings
      .map((shortcut) => shortcutChordSignature(shortcut, platform))
      .join(','),
  ])), [effectiveBindings, platform])
  const value = useMemo<ShortcutRuntimeContextValue>(
    () => ({ runtime, platform, labels, bindingSignatures }),
    [bindingSignatures, labels, platform, runtime],
  )

  return (
    <ShortcutRuntimeContext.Provider value={value}>
      {children}
    </ShortcutRuntimeContext.Provider>
  )
}

interface ShortcutWindowAdapterProps {
  handlers: Partial<Record<ShortcutActionId, ShortcutHandler>>
}

const windowContextId = 'shortcut.window'

export function ShortcutWindowAdapter({ handlers }: ShortcutWindowAdapterProps) {
  const { runtime } = useShortcutRuntime()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const actionSignature = Object.keys(handlers).sort().join('|')
  const actionIds = useMemo(
    () => actionSignature ? actionSignature.split('|') as ShortcutActionId[] : [],
    [actionSignature],
  )

  useEffect(() => {
    const disposeContext = runtime.pushContext({
      id: windowContextId,
      layer: 'global',
      scopes: ['app.global'],
    })
    const disposeHandlers = actionIds.map((actionId) => runtime.registerHandler(
      windowContextId,
      actionId,
      (event, context) => handlersRef.current[actionId]?.(event, context) ?? 'fallthrough',
    ))
    const handleKeyDown = (event: KeyboardEvent) => {
      const result = runtime.dispatch(event, {
        adapterId: 'window',
        handlerContextIds: [windowContextId],
        requiredBindingScope: 'app.global',
        editable: isEditableTarget(event.target),
      })
      if (result.result === 'handled' || result.result === 'blocked') {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      runtime.releaseKey(event.code)
    }
    const handleWindowBlur = () => {
      runtime.releaseAllKeys()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleWindowBlur)
      disposeHandlers.reverse().forEach((dispose) => dispose())
      disposeContext()
    }
  }, [actionIds, runtime])

  return null
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}
