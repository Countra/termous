import { useLayoutEffect } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShortcutRuntimeProvider } from '#app/shortcut-runtime'
import {
  useShortcutRuntime,
  type ShortcutSettings,
  type ShortcutRuntimeContextValue,
} from '#entities/shortcuts'

const defaultSettings: ShortcutSettings = {
  schema_version: 1,
  overrides: {},
}

const customizedSettings: ShortcutSettings = {
  schema_version: 1,
  overrides: {
    'app.host_launcher.open': {
      bindings: [{
        modifiers: ['primary'],
        code: 'KeyJ',
        key: 'j',
      }],
    },
  },
}

interface ShortcutRuntimeProbeProps {
  onSnapshot: (value: ShortcutRuntimeContextValue) => void
}

function ShortcutRuntimeProbe({ onSnapshot }: ShortcutRuntimeProbeProps) {
  const value = useShortcutRuntime()

  useLayoutEffect(() => {
    onSnapshot(value)
  }, [onSnapshot, value])

  return null
}

describe('快捷键运行时 Provider 合同', () => {
  it('设置更新时保留 Runtime 实例并同步平台、索引和展示合同', () => {
    const originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termous')
    Object.defineProperty(window, 'termous', {
      configurable: true,
      value: { platform: 'darwin' },
    })

    try {
      const snapshots: ShortcutRuntimeContextValue[] = []
      const captureSnapshot = (value: ShortcutRuntimeContextValue) => {
        snapshots.push(value)
      }
      const tree = (settings: ShortcutSettings) => (
        <ShortcutRuntimeProvider settings={settings}>
          <ShortcutRuntimeProbe onSnapshot={captureSnapshot} />
        </ShortcutRuntimeProvider>
      )
      const { rerender } = render(tree(defaultSettings))
      const initial = snapshots[0]

      expect(initial).toBeDefined()
      expect(initial?.platform).toBe('darwin')
      expect(initial?.labels.get('app.host_launcher.open')).toEqual(['⌃⇧H'])
      expect(initial?.bindingSignatures.get('app.host_launcher.open')).toBe(
        'control+shift|KeyH',
      )

      const runtime = initial!.runtime
      const disposeContext = runtime.pushContext({
        id: 'shortcut-provider-test',
        layer: 'global',
        scopes: ['app.global'],
      })
      const disposeHandler = runtime.registerHandler(
        'shortcut-provider-test',
        'app.host_launcher.open',
        () => 'handled',
      )

      try {
        expect(runtime.dispatch({
          type: 'keydown',
          code: 'KeyH',
          key: 'H',
          ctrlKey: true,
          shiftKey: true,
        }).actionId).toBe('app.host_launcher.open')

        rerender(tree(customizedSettings))
        const updated = snapshots[snapshots.length - 1]

        expect(updated).toBeDefined()
        expect(updated!.runtime).toBe(runtime)
        expect(updated!.platform).toBe('darwin')
        expect(updated!.labels.get('app.host_launcher.open')).toEqual(['⌘J'])
        expect(updated!.bindingSignatures.get('app.host_launcher.open')).toBe('meta|KeyJ')
        expect(runtime.dispatch({
          type: 'keydown',
          code: 'KeyH',
          key: 'H',
          ctrlKey: true,
          shiftKey: true,
        }).reason).toBe('no_match')
        expect(runtime.dispatch({
          type: 'keydown',
          code: 'KeyJ',
          key: 'j',
          metaKey: true,
        }).actionId).toBe('app.host_launcher.open')
      } finally {
        disposeHandler()
        disposeContext()
      }
    } finally {
      if (originalBridgeDescriptor) {
        Object.defineProperty(window, 'termous', originalBridgeDescriptor)
      } else {
        Reflect.deleteProperty(window, 'termous')
      }
    }
  })
})
