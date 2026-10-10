import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { ConfigProvider } from 'antd'
import type { PropsWithChildren } from 'react'
import { SessionSchema } from '@termous/remote-protocol'
import type { DesktopSessionEvents } from '@termous/remote-protocol/desktop'
import { DesktopStateSchema } from '@termous/remote-protocol/desktop-protocol'
import { beforeEach, expect, test, vi } from 'vitest'
import type { RemoteClient } from '#entities/remote-control'
import { RemoteDesktop } from './RemoteDesktop'

function WithoutMotion({ children }: PropsWithChildren) { return <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider> }

const fixture = vi.hoisted(() => ({ events: undefined as DesktopSessionEvents | undefined, start: vi.fn(), close: vi.fn() }))
beforeEach(() => { fixture.start.mockReset(); fixture.close.mockReset().mockResolvedValue(undefined) })
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }))
vi.mock('@termous/remote-protocol/desktop', () => ({
  RemoteDesktopSession: class {
    // 模拟尚未过期的旧租约，验证界面不依赖远端清理消息才能禁用操作。
    owned = true
    controlGeneration = 1n
    dimensions = { width: 1920, height: 1080 }
    constructor(_gateway: unknown, _id: string, _generation: bigint, events: DesktopSessionEvents) { fixture.events = events }
    start(_target: unknown, _video: unknown, replace: boolean) {
      fixture.start(replace)
      fixture.events?.state(create(DesktopStateSchema, { width: 1920, height: 1080, capabilities: ['resize'] }))
      fixture.events?.status('viewing')
      return Promise.resolve()
    }
    close() { return fixture.close() }
    input() {}
  },
}))

test('父连接失效后立即禁用桌面操作，不等待旧控制租约过期', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  render(<RemoteDesktop client={{} as RemoteClient} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(screen.getByRole('button', { name: '键盘' })).toBeEnabled())
  act(() => fixture.events?.status('closed', 'desktop_disconnected'))
  for (const name of ['键盘', '剪贴板', '目标分辨率', '接管控制']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  expect(screen.getByRole('button', { name: '重新加入' })).toBeEnabled()
})

test('重试等待旧附着释放；显式接替不影响后续普通重试', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  render(<RemoteDesktop client={{} as RemoteClient} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledWith(false))
  act(() => fixture.events?.status('closed', 'desktop_control_locked'))
  fireEvent.click(screen.getByRole('button', { name: '接替远端连接' }))
  let finishCleanup!: () => void
  fixture.close.mockReturnValueOnce(new Promise<void>(resolve => { finishCleanup = resolve }))
  fireEvent.click(await screen.findByRole('button', { name: 'OK' }))
  await waitFor(() => expect(fixture.close).toHaveBeenCalledTimes(1))
  expect(fixture.start).toHaveBeenCalledTimes(1)
  await act(async () => finishCleanup())
  await waitFor(() => expect(fixture.start).toHaveBeenLastCalledWith(true))
  act(() => fixture.events?.status('closed', 'desktop_disconnected'))
  fireEvent.click(screen.getByRole('button', { name: '重新加入' }))
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(3))
  expect(fixture.start).toHaveBeenLastCalledWith(false)
})

test('连接结束立即撤销尚未回答的证书挑战', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  render(<RemoteDesktop client={{} as RemoteClient} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalled())
  let reply: Promise<{ accept: boolean }> | undefined
  act(() => { reply = fixture.events?.challenge({ kind: 'vnc_certificate', fingerprint: 'test-fingerprint' }) })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  act(() => fixture.events?.status('closed', 'desktop_disconnected'))
  await expect(reply).resolves.toEqual({ accept: false })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
