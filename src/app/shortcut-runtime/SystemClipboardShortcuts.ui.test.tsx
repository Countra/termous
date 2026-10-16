import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { defaultShortcutSettings, useShortcutRuntime } from '#entities/shortcuts'
import { clipboardCapabilitiesFixture } from '../../test/systemClipboard'
import { ShortcutRuntimeProvider } from './ShortcutRuntimeProvider'

test('系统复制的快捷键显示和执行跟随能力，通用粘贴保持可用', () => {
  let capabilities = clipboardCapabilitiesFixture('unsupported', 'unsupported')
  const copy = vi.fn(() => 'handled' as const), paste = vi.fn(() => 'handled' as const)
  function Probe() {
    const { runtime, labels } = useShortcutRuntime()
    useEffect(() => {
      const context = runtime.pushContext({ id: 'files', layer: 'focus', scopes: ['files.list'] })
      const a = runtime.registerHandler('files', 'files.copy_to_system', copy)
      const b = runtime.registerHandler('files', 'files.paste', paste)
      return () => { a(); b(); context() }
    }, [runtime])
    const dispatch = (key: string) => runtime.dispatch(new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, ctrlKey: true }))
    return <><button onClick={() => dispatch('c')}>copy</button><button onClick={() => dispatch('v')}>paste</button>{labels.has('files.copy_to_system') && <span>系统复制快捷键</span>}</>
  }
  const view = render(<ShortcutRuntimeProvider settings={defaultShortcutSettings}><Probe /></ShortcutRuntimeProvider>)
  expect(screen.queryByText('系统复制快捷键')).toBeNull()
  fireEvent.click(screen.getByText('copy'))
  fireEvent.click(screen.getByText('paste'))
  expect(copy).not.toHaveBeenCalled()
  expect(paste).toHaveBeenCalledOnce()
  act(() => { capabilities.disconnect(); capabilities = clipboardCapabilitiesFixture('unsupported', 'ready') })
  expect(screen.getByText('系统复制快捷键')).toBeVisible()
  fireEvent.click(screen.getByText('copy'))
  expect(copy).toHaveBeenCalledOnce()
  act(() => capabilities.update({ status: 'disconnected' }))
  expect(screen.getByText('系统复制快捷键')).toBeVisible()
  fireEvent.click(screen.getByText('copy'))
  expect(copy).toHaveBeenCalledOnce()
  act(() => capabilities.update({ status: 'connected' }))
  fireEvent.click(screen.getByText('copy'))
  expect(copy).toHaveBeenCalledTimes(2)
  view.unmount()
  capabilities.disconnect()
})
