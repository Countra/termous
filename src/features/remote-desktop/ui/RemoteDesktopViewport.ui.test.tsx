import { fireEvent, render } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import {
  RemoteDesktopRuntimeContext,
  type RemoteDesktopRuntimeValue,
} from '../runtime/core/remoteDesktopRuntimeContext'
import { RemoteDesktopViewport } from './RemoteDesktopViewport'

test('运行态更新不会重复迁移 Viewer 容器', () => {
  const unregister = vi.fn()
  const registerViewport = vi.fn(() => unregister)
  const focusViewer = vi.fn()
  const value = runtimeValue({ registerViewport, focusViewer })
  const { container, rerender, unmount } = render(
    <RemoteDesktopRuntimeContext.Provider value={value}>
      <RemoteDesktopViewport sessionId="rds_test" />
    </RemoteDesktopRuntimeContext.Provider>,
  )

  rerender(
    <RemoteDesktopRuntimeContext.Provider value={{ ...value, viewerStates: {} }}>
      <RemoteDesktopViewport sessionId="rds_test" />
    </RemoteDesktopRuntimeContext.Provider>,
  )
  fireEvent.mouseDown(container.firstElementChild as Element)

  expect(registerViewport).toHaveBeenCalledTimes(1)
  expect(focusViewer).toHaveBeenCalledWith('rds_test')
  unmount()
  expect(unregister).toHaveBeenCalledTimes(1)
})

function runtimeValue(
  patch: Partial<RemoteDesktopRuntimeValue>,
): RemoteDesktopRuntimeValue {
  return {
    sessions: [],
    activeSessionId: null,
    viewerStates: {},
    selectSession: vi.fn(),
    createSession: vi.fn(),
    closeSession: vi.fn(),
    reconnectSession: vi.fn(),
    registerViewport: vi.fn(() => vi.fn()),
    setDisplayMode: vi.fn(),
    setViewOnly: vi.fn(),
    focusViewer: vi.fn(),
    blurViewer: vi.fn(),
    submitCredentials: vi.fn(),
    approveServer: vi.fn(),
    rejectServer: vi.fn(),
    sendCtrlAltDel: vi.fn(),
    sendClipboard: vi.fn(),
    ...patch,
  }
}
