import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { RemoteDesktopDisplayControls } from './RemoteDesktopDisplayControls.tsx'
import { emptyRemoteDesktopViewerState } from '../../../features/remote-desktop/runtime/core/viewerContracts.ts'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

test('缩放与分辨率独立切换，固定项展示进入跟随前的尺寸', () => {
  const onScale = vi.fn(), onFollow = vi.fn()
  const state = { ...emptyRemoteDesktopViewerState, connection: 'connected' as const, followWindow: true,
    resolution: { supported: true, status: 'idle' as const, size: { width: 1280, height: 720 }, fixed: { width: 1920, height: 1080 } } }
  render(<RemoteDesktopDisplayControls state={state} onScale={onScale} onFollow={onFollow} />)
  fireEvent.click(screen.getByText('remoteDesktop.display.actual'))
  expect(onScale).toHaveBeenCalledWith('actual')
  expect(onFollow).not.toHaveBeenCalled()
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'remoteDesktop.display.resolution' }))
  fireEvent.click(screen.getByText('remoteDesktop.display.fixed 1920×1080'))
  expect(onFollow).toHaveBeenCalledWith(false)
})

test('只读观看仍可缩放，调整失败保留显式重试入口', () => {
  const onScale = vi.fn(), onFollow = vi.fn()
  render(<RemoteDesktopDisplayControls state={{ ...emptyRemoteDesktopViewerState, connection: 'connected', viewOnly: true,
    resolution: { supported: true, status: 'timeout' }, followWindow: false }} onScale={onScale} onFollow={onFollow} />)
  fireEvent.click(screen.getByText('remoteDesktop.display.actual'))
  expect(onScale).toHaveBeenCalledWith('actual')
  expect(screen.getByRole('status')).toHaveTextContent('remoteDesktop.display.timeout')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.display.retry' }))
  expect(onFollow).toHaveBeenCalledWith(false)
})
