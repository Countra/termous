import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RemoteBootstrap } from '#common/contracts'

const bridge = vi.hoisted(() => ({ bootstrap: vi.fn(), close: vi.fn(), onAppearance: vi.fn() }))
vi.mock('#shared/bridge', () => ({ getRemoteWindowBridge: () => bridge }))
vi.mock('#app/ui-runtime', () => ({ TermousUiProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('#pages/remote-control', () => ({ RemoteControlPage: ({ bootstrap }: { bootstrap: RemoteBootstrap }) => <div>{bootstrap.deviceName}</div> }))
import RemoteWindowRoot from './RemoteWindowRoot'

beforeEach(() => {
  vi.resetAllMocks()
  bridge.onAppearance.mockReturnValue(() => {})
  bridge.close.mockResolvedValue(undefined)
})

test('初始化失败的无边框窗口仍能关闭，关闭失败保留重试入口', async () => {
  bridge.bootstrap.mockRejectedValue(new Error('synthetic-bootstrap-failure'))
  bridge.close.mockRejectedValueOnce(new Error('synthetic-close-failure'))
  render(<RemoteWindowRoot />)
  const close = await screen.findByRole('button', { name: /关闭窗口|Close window/ })
  fireEvent.click(close)
  expect(await screen.findByText(/无法关闭窗口|Could not close the window/)).toBeVisible()
  fireEvent.click(close)
  expect(bridge.close).toHaveBeenCalledTimes(2)
})

test.each([true, false])('外观事件先到达后，初始化的迟到结果不覆盖已打开的窗口（失败：%s）', async failed => {
  let resolve!: (value: RemoteBootstrap) => void
  let reject!: (reason: Error) => void
  bridge.bootstrap.mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail }))
  render(<RemoteWindowRoot />)
  const bootstrap = { generation: '1', deviceId: 'host', deviceName: '当前设备', language: 'zh-CN', theme: 'dark' } as RemoteBootstrap
  act(() => bridge.onAppearance.mock.calls[0]![0](bootstrap))
  await act(async () => { if (failed) reject(new Error('synthetic-late-failure')); else resolve({ ...bootstrap, deviceName: '旧设备' }) })
  expect(screen.getByText('当前设备')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
