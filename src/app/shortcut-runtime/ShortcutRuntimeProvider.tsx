import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { getTermousBridge } from '#shared/bridge'
import { useSystemClipboardOperation, systemClipboardReasonKey } from '#entities/system-clipboard'
import {
  compileShortcutIndex,
  formatShortcutChord,
  normalizeShortcutPlatform,
  resolveEffectiveShortcutBindings,
  shortcutChordSignature,
  ShortcutRuntime,
  ShortcutRuntimeContextProvider,
  type ShortcutActionId,
  type ShortcutHandler,
  type ShortcutSettings,
  type ShortcutRuntimeContextValue,
  useShortcutRuntime,
} from '#entities/shortcuts'

interface ShortcutRuntimeProviderProps {
  settings: ShortcutSettings
  children: ReactNode
}

export function ShortcutRuntimeProvider({
  settings,
  children,
}: ShortcutRuntimeProviderProps) {
  const publish = useSystemClipboardOperation('publish_files')
  const availability = useMemo(() => ({ 'files.copy_to_system': { visible: publish.visible, available: publish.available, unavailableReasonKey: publish.available ? undefined : systemClipboardReasonKey(publish.reason) } }), [publish.visible, publish.available, publish.reason])
  const platform = useMemo(() => normalizeShortcutPlatform(getTermousBridge()?.platform), [])
  const effectiveBindings = useMemo(
    () => resolveEffectiveShortcutBindings(settings).filter(binding => binding.actionId !== 'files.copy_to_system' || publish.visible),
    [settings, publish.visible],
  )
  const index = useMemo(
    () => compileShortcutIndex(effectiveBindings.filter(binding => binding.actionId !== 'files.copy_to_system' || publish.available), platform),
    [effectiveBindings, platform, publish.available],
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
    () => ({ runtime, platform, labels, bindingSignatures, availability }),
    [bindingSignatures, labels, platform, runtime, availability],
  )

  return (
    <ShortcutRuntimeContextProvider value={value}>
      {children}
    </ShortcutRuntimeContextProvider>
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
      if (isShortcutExclusiveTarget(event.target)) {
        return
      }
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
  return Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"]',
  ))
}

function isShortcutExclusiveTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('[data-termous-shortcut-exclusive="true"]'))
}
