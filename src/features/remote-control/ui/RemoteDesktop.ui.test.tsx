import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { create } from '@bufbuild/protobuf'
import { ConfigProvider } from 'antd'
import type { PropsWithChildren } from 'react'
import { EventSchema, ResponseSchema, SessionSchema } from '@termous/remote-protocol'
import type { DesktopGateway, DesktopSessionEvents } from '@termous/remote-protocol/desktop'
import { DesktopPresentationPreferences } from '@termous/remote-protocol/presentation'
import { DesktopExchangeSchema, DesktopStateSchema } from '@termous/remote-protocol/desktop-protocol'
import { beforeEach, expect, test, vi } from 'vitest'
import { RemoteError, type RemoteClient } from '#entities/remote-control'
import { RemoteDesktop } from './RemoteDesktop'

function WithoutMotion({ children }: PropsWithChildren) { return <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider> }
function desktopClient(request = vi.fn()) { return { request, bridge: {}, connection: { id: 'parent' }, presentations: new DesktopPresentationPreferences() } as unknown as RemoteClient }

const fixture = vi.hoisted(() => ({ events: undefined as DesktopSessionEvents | undefined, gateways: [] as DesktopGateway[], controlAvailable: true, cleanupConfirmed: true, start: vi.fn(), close: vi.fn(), input: vi.fn(), display: vi.fn(), openFileExchange: vi.fn(), readClipboard: vi.fn() }))
beforeEach(() => { fixture.gateways = []; fixture.controlAvailable = true; fixture.cleanupConfirmed = true; fixture.start.mockReset(); fixture.close.mockReset().mockResolvedValue(undefined); fixture.input.mockReset(); fixture.display.mockReset(); fixture.openFileExchange.mockReset(); fixture.readClipboard.mockReset() })
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }))
vi.mock('@termous/remote-protocol/desktop', () => ({
  RemoteDesktopSession: class {
    // 模拟尚未过期的旧租约，验证界面不依赖远端清理消息才能禁用操作。
    get owned() { return fixture.controlAvailable }
    holdsControl = true
    get controlAvailable() { return fixture.controlAvailable }
    controlGeneration = 1n
    get cleanupConfirmed() { return fixture.cleanupConfirmed }
    dimensions = { width: 1920, height: 1080 }
    constructor(gateway: DesktopGateway, _id: string, _generation: bigint, events: DesktopSessionEvents) { fixture.events = events; fixture.gateways.push(gateway) }
    start(_target: unknown, _video: unknown, replace: boolean) {
      fixture.start(replace)
      fixture.events?.state(create(DesktopStateSchema, { width: 1920, height: 1080, capabilities: ['resize', 'pointer', 'keyboard', 'text', 'clipboard', 'ctrl_alt_del', 'files'] }))
      fixture.events?.status('viewing')
      return Promise.resolve()
    }
    close() { return fixture.close() }
    input = fixture.input
    display = fixture.display
    openFileExchange = fixture.openFileExchange
    readClipboard = fixture.readClipboard
  },
}))

test('内容恢复只更新输入可用性，保留画面且不显示切换加载层', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const view = render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  const video = view.container.querySelector('video')
  const state = create(DesktopStateSchema, { width: 1920, height: 1080, capabilities: ['pointer', 'keyboard', 'text'] })
  act(() => fixture.events?.state(state))
  expect(screen.getByRole('button', { name: '键盘' })).toBeEnabled()
  act(() => {
    fixture.controlAvailable = false
    fixture.events?.inputReset?.()
    fixture.events?.state(state)
  })
  expect(screen.getByRole('button', { name: '键盘' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '释放控制' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('当前由你控制')
  expect(view.container.querySelector('.ant-spin')).toBeNull()
  expect(screen.queryByText('正在切换桌面')).not.toBeInTheDocument()
  expect(screen.queryByText('正在连接桌面')).not.toBeInTheDocument()
  expect(view.container.querySelector('video')).toBe(video)
  act(() => { fixture.controlAvailable = true; fixture.events?.state(state) })
  expect(screen.getByRole('button', { name: '键盘' })).toBeEnabled()
  expect(fixture.start).toHaveBeenCalledTimes(1)
  expect(fixture.close).not.toHaveBeenCalled()
})

test('兼容重连等待清理时切换代次，迟到结果不重启新会话', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const client = desktopClient()
  const view = render(<RemoteDesktop client={client} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  act(() => fixture.events?.status('closed', 'desktop_h264_unsupported'))
  let finish!: () => void
  fixture.close.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: '以兼容模式重新连接' }))
  view.rerender(<RemoteDesktop client={client} session={{ ...session, generation: 2n }} active />)
  await act(async () => finish())
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(2))
  expect(fixture.gateways).toHaveLength(2)
  expect(fixture.gateways[1].receiverPolicy).toBeUndefined()
})

test('兼容重连必须确认旧附着清理，暂停观看清除媒体展示', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const client = desktopClient(), changed = vi.fn()
  const view = render(<RemoteDesktop client={client} session={session} active onMediaDetails={changed} />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  act(() => fixture.events?.status('closed', 'desktop_h264_unsupported'))
  fixture.cleanupConfirmed = false
  fireEvent.click(screen.getByRole('button', { name: '以兼容模式重新连接' }))
  expect(await screen.findByText('desktop_cleanup_uncertain')).toBeInTheDocument()
  expect(fixture.start).toHaveBeenCalledTimes(1)
  view.rerender(<RemoteDesktop client={client} session={session} active={false} onMediaDetails={changed} />)
  expect(changed).toHaveBeenLastCalledWith('desktop', undefined)
})

test('隐藏 VNC 页签清除媒体详情但保留既有观看会话', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'vnc', generation: 1n, state: 'streaming' })
  const client = desktopClient(), changed = vi.fn()
  const view = render(<RemoteDesktop client={client} session={session} active onMediaDetails={changed} />, { wrapper: WithoutMotion })
  fireEvent.click(screen.getByRole('button', { name: '切换至此设备' }))
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  expect(changed).toHaveBeenLastCalledWith('desktop', expect.objectContaining({ transport: 'rfb' }))
  view.rerender(<RemoteDesktop client={client} session={session} active={false} onMediaDetails={changed} />)
  expect(changed).toHaveBeenLastCalledWith('desktop', undefined)
  expect(fixture.close).not.toHaveBeenCalled()
  view.rerender(<RemoteDesktop client={client} session={session} active onMediaDetails={changed} />)
  expect(changed).toHaveBeenLastCalledWith('desktop', expect.objectContaining({ transport: 'rfb' }))
  expect(fixture.start).toHaveBeenCalledTimes(1)
})

test('文件授权失败只在文件面板提示，重试成功不重建桌面连接', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const exchange = create(DesktopExchangeSchema, { id: 'exchange', resourceGeneration: 3n, targetPath: '\\\\tsclient\\TRM00001' })
  fixture.openFileExchange.mockRejectedValueOnce(new RemoteError('desktop_files_unauthorized')).mockResolvedValue(exchange)
  const request = vi.fn().mockResolvedValue(create(ResponseSchema, { result: { case: 'directory', value: { entries: [] } } }))
  render(<RemoteDesktop client={desktopClient(request)} session={session} active />, { wrapper: WithoutMotion })
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
  const client = desktopClient()
  const view = render(<RemoteDesktop client={client} session={session} active />, { wrapper: WithoutMotion })
  const files = await screen.findByRole('button', { name: 'RDP 文件交换' })
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
  render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
  const files = await screen.findByRole('button', { name: 'RDP 文件交换' })
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
    render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
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
  render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(screen.getByRole('button', { name: '键盘' })).toBeEnabled())
  act(() => fixture.events?.status('closed', 'desktop_disconnected'))
  for (const name of ['键盘', '剪贴板', '接管控制']) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  fireEvent.click(screen.getByRole('button', { name: '显示与画质' }))
  expect(screen.getByRole('combobox', { name: '远端桌面分辨率' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '重新加入' })).toBeEnabled()
})

test('全屏状态切换不重建观看，显示设置浮层保持在桌面容器内', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const view = render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  const descriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
  try {
    fireEvent.click(screen.getByRole('button', { name: '显示与画质' }))
    expect(view.container).not.toContainElement(await screen.findByRole('dialog'))
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: view.container.querySelector('video')!.closest('[class*="desktop_"]') })
    fireEvent(document, new Event('fullscreenchange'))
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeInTheDocument()
    await waitFor(() => expect(view.container).toContainElement(screen.getByRole('dialog')))
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null })
    fireEvent(document, new Event('fullscreenchange'))
    expect(screen.getByRole('button', { name: '全屏' })).toBeInTheDocument()
    await waitFor(() => expect(view.container).not.toContainElement(screen.getByRole('dialog')))
    expect(fixture.start).toHaveBeenCalledTimes(1)
    expect(fixture.close).not.toHaveBeenCalled()
  } finally {
    if (descriptor) Object.defineProperty(document, 'fullscreenElement', descriptor)
    else Reflect.deleteProperty(document, 'fullscreenElement')
  }
})

test('窗口模式浮层使用页面容器，避免分屏面板裁剪详情和下拉菜单', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const view = render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '桌面连接详情' }))
  const details = await screen.findByRole('region', { name: '桌面媒体' })
  expect(document.body).toContainElement(details)
  expect(view.container).not.toContainElement(details)
})

test('VNC 隐藏页签关闭输入弹窗，恢复观看时不会重新弹出旧草稿', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'vnc', generation: 1n, state: 'streaming' })
  const client = desktopClient()
  const view = render(<RemoteDesktop client={client} session={session} active />, { wrapper: WithoutMotion })
  fireEvent.click(screen.getByRole('button', { name: '切换至此设备' }))
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '键盘' }))
  fireEvent.change(screen.getByRole('textbox', { name: '输入文本' }), { target: { value: '旧草稿' } })
  view.rerender(<RemoteDesktop client={client} session={session} active={false} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  view.rerender(<RemoteDesktop client={client} session={session} active />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(fixture.close).not.toHaveBeenCalled()
  expect(fixture.start).toHaveBeenCalledTimes(1)
})

test('旧观看代次的剪贴板结果不能覆盖新连接的输入', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  let finish!: (value: string) => void
  fixture.readClipboard.mockReturnValue(new Promise<string>(resolve => { finish = resolve }))
  const client = desktopClient()
  const view = render(<RemoteDesktop client={client} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: '剪贴板' }))
  fireEvent.click(screen.getByRole('button', { name: '接收远端剪贴板' }))
  expect(screen.getByRole('button', { name: '键盘' })).toBeDisabled()
  view.rerender(<RemoteDesktop client={client} session={{ ...session, generation: 2n }} active />)
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '键盘' }))
  fireEvent.change(screen.getByRole('textbox', { name: '输入文本' }), { target: { value: '新连接输入' } })
  await act(async () => finish('旧剪贴板'))
  expect(screen.getByRole('textbox', { name: '输入文本' })).toHaveValue('新连接输入')
})

test('重附着恢复实际尺寸，新的目标连接代次恢复默认缩放', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const client = desktopClient()
  const view = render(<RemoteDesktop client={client} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(1))
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '显示方式' }))
  fireEvent.click(await screen.findByText('原始比例'))
  await waitFor(() => expect(fixture.display).toHaveBeenLastCalledWith(false))
  fixture.display.mockClear()
  act(() => fixture.events?.status('closed', 'desktop_display_changed'))
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(fixture.display).toHaveBeenLastCalledWith(false))
  view.rerender(<RemoteDesktop client={client} session={{ ...session, generation: 2n }} active />)
  await waitFor(() => expect(fixture.start).toHaveBeenCalledTimes(3))
  await waitFor(() => expect(fixture.display).toHaveBeenLastCalledWith(true))
})

test('重试等待旧附着释放；显式接替不影响后续普通重试', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
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
  render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalled())
  let reply: Promise<{ accept: boolean }> | undefined
  act(() => { reply = fixture.events?.challenge({ kind: 'vnc_certificate', fingerprint: 'test-fingerprint' }) })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  act(() => fixture.events?.status('closed', 'desktop_disconnected'))
  await expect(reply).resolves.toEqual({ accept: false })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('桌面候选网关只转交 ICE 事件并保留解除订阅能力', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  const client = desktopClient()
  const listeners = new Set<Parameters<RemoteClient['onEvent']>[0]>()
  client.onEvent = listener => { listeners.add(listener); return () => { listeners.delete(listener) } }
  render(<RemoteDesktop client={client} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalled())
  const received = vi.fn(), unsubscribe = fixture.gateways[0].onICE(received)
  const ice = create(EventSchema, { type: 'desktop_ice', value: { case: 'desktopIce', value: { attachmentId: 'view', negotiationId: 'negotiation' } } })
  const stream = create(EventSchema, { type: 'desktop_stream_state', value: { case: 'desktopStreamState', value: { streamId: 'view' } } })
  for (const listener of listeners) { listener(stream); listener(ice) }
  expect(received).toHaveBeenCalledExactlyOnceWith(ice.value.value)
  unsubscribe()
  expect(listeners.size).toBe(0)
})

test('桌面网络配置错误展示具体原因和错误码，且不回显任意异常正文', async () => {
  const session = create(SessionSchema, { id: 'desktop', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' })
  render(<RemoteDesktop client={desktopClient()} session={session} active />, { wrapper: WithoutMotion })
  await waitFor(() => expect(fixture.start).toHaveBeenCalled())
  act(() => fixture.events?.status('closed', 'desktop_ice_invalid'))
  expect(screen.getByText('桌面网络配置无效，请检查 STUN/TURN 设置。')).toBeInTheDocument()
  expect(screen.getByText('desktop_ice_invalid')).toBeInTheDocument()
  act(() => fixture.events?.status('closed', 'invalid turn:private.invalid credential=synthetic'))
  expect(screen.queryByText(/credential=synthetic/)).not.toBeInTheDocument()
  expect(screen.getByText('desktop_operation_failed')).toBeInTheDocument()
})
