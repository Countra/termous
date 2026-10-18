import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { ConfigProvider } from 'antd'
import type { PropsWithChildren } from 'react'
import { ResponseSchema, SessionSchema } from '@termous/remote-protocol'
import type { DesktopSessionEvents } from '@termous/remote-protocol/desktop'
import { DesktopExchangeSchema, DesktopStateSchema } from '@termous/remote-protocol/desktop-protocol'
import { beforeEach, expect, test, vi } from 'vitest'
import { RemoteError, type RemoteClient } from '#entities/remote-control'
import { RemoteDesktop } from './RemoteDesktop'

function WithoutMotion({ children }: PropsWithChildren) { return <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider> }

const fixture = vi.hoisted(() => ({ events: undefined as DesktopSessionEvents | undefined, start: vi.fn(), close: vi.fn(), input: vi.fn(), display: vi.fn(), openFileExchange: vi.fn() }))
beforeEach(() => { fixture.start.mockReset(); fixture.close.mockReset().mockResolvedValue(undefined); fixture.input.mockReset(); fixture.display.mockReset(); fixture.openFileExchange.mockReset() })
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
    input = fixture.input
    display = fixture.display
    openFileExchange = fixture.openFileExchange
  },
}))

test('文件授权失败只在文件面板提示，重试成功不重建桌面连接', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const exchange = create(DesktopExchangeSchema, { id: 'exchange', resourceGeneration: 3n, targetPath: '\\\\tsclient\\TRM00001' })
  fixture.openFileExchange.mockRejectedValueOnce(new RemoteError('desktop_files_unauthorized')).mockResolvedValue(exchange)
  const request = vi.fn().mockResolvedValue(create(ResponseSchema, { result: { case: 'directory', value: { entries: [] } } }))
  render(<RemoteDesktop client={{ request } as unknown as RemoteClient} session={session} active />, { wrapper: WithoutMotion })
  const files = await screen.findByRole('button', { name: 'RDP 文件交换' })
  await waitFor(() => expect(files).toBeEnabled())
  fireEvent.click(files)
  expect(await screen.findByRole('alert')).toHaveTextContent('请在被控电脑为此 RDP 配置开启“RDP 文件交换”授权')
  expect(screen.queryByText('桌面连接已断开')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重新加入' })).not.toBeInTheDocument()
  expect(fixture.close).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  expect(request.mock.calls[0][0].operation.value.location).toMatchObject({ kind: 'desktop_exchange', resourceId: 'exchange', generation: 3n })
  expect(fixture.start).toHaveBeenCalledTimes(1)
  expect(fixture.close).not.toHaveBeenCalled()
})

test('文件准备只提交一次，观看停止后不展示迟到的交换区', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const exchange = create(DesktopExchangeSchema, { id: 'old-exchange', resourceGeneration: 3n })
  let finish!: (value: typeof exchange) => void
  fixture.openFileExchange.mockReturnValue(new Promise<typeof exchange>(resolve => { finish = resolve }))
  const client = { request: vi.fn() } as unknown as RemoteClient
  const view = render(<RemoteDesktop client={client} session={session} active />, { wrapper: WithoutMotion })
  const files = screen.getByRole('button', { name: 'RDP 文件交换' })
  await waitFor(() => expect(files).toBeEnabled())
  fireEvent.click(files); fireEvent.click(files)
  expect(fixture.openFileExchange).toHaveBeenCalledTimes(1)
  expect(screen.getByText('正在准备文件交换区…')).toBeInTheDocument()
  view.rerender(<RemoteDesktop client={client} session={session} active={false} />)
  await act(async () => finish(exchange))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(client.request).not.toHaveBeenCalled()
  view.rerender(<RemoteDesktop client={client} session={session} active />)
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(2))
  expect(fixture.openFileExchange).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each([
  ['desktop_files_unsupported', '当前无法使用 RDP 文件交换'],
  ['desktop_directory_operation_failed', '交换目录映射失败'],
  ['desktop_directory_path_too_long', '本机交换目录路径超出 RDP 支持的长度'],
  ['private path=C:\\Users\\sensitive', '操作未能完成'],
])('文件错误与观看状态分离：%s', async (code, message) => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  fixture.openFileExchange.mockRejectedValue(new Error(code))
  render(<RemoteDesktop client={{} as RemoteClient} session={session} active />, { wrapper: WithoutMotion })
  const files = screen.getByRole('button', { name: 'RDP 文件交换' })
  await waitFor(() => expect(files).toBeEnabled())
  fireEvent.click(files)
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(screen.queryByText('桌面连接已断开')).not.toBeInTheDocument()
  expect(screen.queryByText(/sensitive/)).not.toBeInTheDocument()
  expect(fixture.close).not.toHaveBeenCalled()
})

test('全屏与窗口尺寸切换只调整显示，不重建媒体或改变目标分辨率', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const fullscreen = Object.getOwnPropertyDescriptor(Element.prototype, 'requestFullscreen')
  const requestFullscreen = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: requestFullscreen })
  try {
    render(<RemoteDesktop client={{} as RemoteClient} session={session} active />, { wrapper: WithoutMotion })
    await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 3; i++) {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: '全屏' })))
      fireEvent(window, new Event('resize'))
      fireEvent(document, new Event('fullscreenchange'))
    }
    expect(requestFullscreen).toHaveBeenCalledTimes(3)
    expect(fixture.start).toHaveBeenCalledTimes(1)
    expect(fixture.close).not.toHaveBeenCalled()
    expect(fixture.input).not.toHaveBeenCalled()
    act(() => fixture.events?.status('recovering'))
    expect(screen.getByRole('status')).toHaveTextContent('正在恢复桌面连接')
    expect(screen.getByRole('button', { name: '键盘' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '重新加入' })).not.toBeInTheDocument()
    act(() => fixture.events?.status('viewing'))
    expect(fixture.start).toHaveBeenCalledTimes(1)
  } finally {
    if (fullscreen) Object.defineProperty(Element.prototype, 'requestFullscreen', fullscreen)
    else Reflect.deleteProperty(Element.prototype, 'requestFullscreen')
  }
})

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

test('桌面网络配置错误展示具体原因和错误码，且不回显任意异常正文', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  render(<RemoteDesktop client={{} as RemoteClient} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalled())
  act(() => fixture.events?.status('closed', 'desktop_ice_invalid'))
  expect(screen.getByText('桌面网络配置无效，请检查 STUN/TURN 设置。')).toBeInTheDocument()
  expect(screen.getByText('desktop_ice_invalid')).toBeInTheDocument()
  act(() => fixture.events?.status('closed', 'invalid turn:private.invalid credential=synthetic'))
  expect(screen.queryByText(/credential=synthetic/)).not.toBeInTheDocument()
  expect(screen.getByText('desktop_operation_failed')).toBeInTheDocument()
})
