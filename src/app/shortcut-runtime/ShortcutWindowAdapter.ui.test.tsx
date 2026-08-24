import { fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ShortcutSettings } from '#entities/shortcuts'
import {
  ShortcutRuntimeProvider,
  ShortcutWindowAdapter,
} from './ShortcutRuntimeProvider'

const shortcutSettings: ShortcutSettings = {
  schema_version: 1,
  overrides: {},
}

test('远程桌面 Viewer 会直接阻断允许在输入框触发的应用快捷键', () => {
  const handler = vi.fn(() => 'handled' as const)
  const { getByTestId } = render(
    <ShortcutRuntimeProvider settings={shortcutSettings}>
      <ShortcutWindowAdapter handlers={{ 'app.host_launcher.open': handler }} />
      <div data-termous-shortcut-exclusive="true">
        <canvas data-testid="viewer-canvas" />
      </div>
    </ShortcutRuntimeProvider>,
  )

  fireEvent.keyDown(getByTestId('viewer-canvas'), {
    code: 'KeyH',
    key: 'H',
    ctrlKey: true,
    shiftKey: true,
  })

  expect(handler).not.toHaveBeenCalled()
})
