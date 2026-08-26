import { render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type {
  HostLauncherData,
  HostLauncherModalProps,
} from '#features/hosts'
import { ConnectionLauncherRuntimeBridge } from './ConnectionLauncherRuntimeBridge'

const bridgeMock = vi.hoisted(() => ({
  createSession: vi.fn<(profileId: string) => Promise<void>>(async () => undefined),
  launcherProps: undefined as HostLauncherModalProps | undefined,
}))

vi.mock('#features/hosts', () => ({
  HostLauncherModal: (props: HostLauncherModalProps) => {
    bridgeMock.launcherProps = props
    return null
  },
}))

vi.mock('#features/remote-desktop', () => ({
  useRemoteDesktopRuntime: () => ({
    createSession: bridgeMock.createSession,
  }),
}))

afterEach(() => {
  bridgeMock.createSession.mockReset()
  bridgeMock.createSession.mockResolvedValue(undefined)
  bridgeMock.launcherProps = undefined
})

test('向统一连接器透传原有属性并注入远程桌面连接回调', () => {
  const launcherProps = createLauncherProps()

  render(
    <ConnectionLauncherRuntimeBridge
      {...launcherProps}
      onRemoteDesktopConnected={vi.fn()}
      onRemoteDesktopConnectionError={vi.fn()}
    />,
  )

  const captured = getLauncherProps()
  expect(captured.open).toBe(launcherProps.open)
  expect(captured.instanceKey).toBe(launcherProps.instanceKey)
  expect(captured.intent).toBe(launcherProps.intent)
  expect(captured.data).toBe(launcherProps.data)
  expect(captured.selectedHostId).toBe(launcherProps.selectedHostId)
  expect(captured.actionBusy).toBe(launcherProps.actionBusy)
  expect(captured.onClose).toEqual(expect.any(Function))
  expect(captured.onSelectHost).toBe(launcherProps.onSelectHost)
  expect(captured.onConnectSSHProfile).toBe(launcherProps.onConnectSSHProfile)
  expect(captured.onCreateHost).toBe(launcherProps.onCreateHost)
  expect(captured.onEditHost).toBe(launcherProps.onEditHost)
  expect(captured.onManageHostAccess).toBe(launcherProps.onManageHostAccess)
  expect(captured.onOpenFileProfile).toBe(launcherProps.onOpenFileProfile)
  expect(captured.onOpenForward).toBe(launcherProps.onOpenForward)
  expect(captured.onToggleFavorite).toBe(launcherProps.onToggleFavorite)
  expect(captured.onRefreshReachability).toBe(launcherProps.onRefreshReachability)
  expect(captured.getHostIconUrl).toBe(launcherProps.getHostIconUrl)
  expect(captured.onOpenRemoteDesktopProfile).toEqual(expect.any(Function))
  captured.onClose()
  expect(launcherProps.onClose).toHaveBeenCalledTimes(1)
})

test('远程桌面会话创建完成后再通知应用切换页面', async () => {
  let resolveCreateSession!: () => void
  bridgeMock.createSession.mockReturnValueOnce(new Promise<void>((resolve) => {
    resolveCreateSession = resolve
  }))
  const onRemoteDesktopConnected = vi.fn()
  render(
    <ConnectionLauncherRuntimeBridge
      {...createLauncherProps()}
      onRemoteDesktopConnected={onRemoteDesktopConnected}
      onRemoteDesktopConnectionError={vi.fn()}
    />,
  )

  const opening = getLauncherProps().onOpenRemoteDesktopProfile('rdp_profile_1')
  expect(bridgeMock.createSession).toHaveBeenCalledWith('rdp_profile_1')
  expect(onRemoteDesktopConnected).not.toHaveBeenCalled()

  resolveCreateSession()
  await opening

  expect(onRemoteDesktopConnected).toHaveBeenCalledTimes(1)
})

test('远程桌面会话创建失败时保留错误且不通知切换页面', async () => {
  const failure = new Error('create session failed')
  bridgeMock.createSession.mockRejectedValueOnce(failure)
  const onRemoteDesktopConnected = vi.fn()
  const onRemoteDesktopConnectionError = vi.fn()
  render(
    <ConnectionLauncherRuntimeBridge
      {...createLauncherProps()}
      onRemoteDesktopConnected={onRemoteDesktopConnected}
      onRemoteDesktopConnectionError={onRemoteDesktopConnectionError}
    />,
  )

  await expect(
    getLauncherProps().onOpenRemoteDesktopProfile('rdp_profile_failed'),
  ).rejects.toBe(failure)
  expect(onRemoteDesktopConnected).not.toHaveBeenCalled()
  expect(onRemoteDesktopConnectionError).toHaveBeenCalledWith(failure)
})

test('关闭并重开后旧远程桌面请求不得切页或呈现迟到错误', async () => {
  let resolveCreateSession!: () => void
  bridgeMock.createSession.mockReturnValueOnce(new Promise<void>((resolve) => {
    resolveCreateSession = resolve
  }))
  const onRemoteDesktopConnected = vi.fn()
  const onRemoteDesktopConnectionError = vi.fn()
  const props = createLauncherProps()
  const view = render(
    <ConnectionLauncherRuntimeBridge
      {...props}
      onRemoteDesktopConnected={onRemoteDesktopConnected}
      onRemoteDesktopConnectionError={onRemoteDesktopConnectionError}
    />,
  )
  const opening = getLauncherProps().onOpenRemoteDesktopProfile('rdp_profile_old')

  getLauncherProps().onClose()
  view.rerender(
    <ConnectionLauncherRuntimeBridge
      {...props}
      open
      instanceKey={props.instanceKey + 1}
      intent="terminal"
      onRemoteDesktopConnected={onRemoteDesktopConnected}
      onRemoteDesktopConnectionError={onRemoteDesktopConnectionError}
    />,
  )
  resolveCreateSession()
  await opening

  expect(onRemoteDesktopConnected).not.toHaveBeenCalled()
  expect(onRemoteDesktopConnectionError).not.toHaveBeenCalled()
})

function createLauncherProps(): Omit<HostLauncherModalProps, 'onOpenRemoteDesktopProfile'> {
  return {
    open: true,
    instanceKey: 1,
    intent: 'remote_desktop',
    data: emptyLauncherData(),
    selectedHostId: 'hst_selected',
    actionBusy: true,
    onClose: vi.fn(),
    onSelectHost: vi.fn(),
    onConnectSSHProfile: vi.fn(async () => undefined),
    onCreateHost: vi.fn(),
    onEditHost: vi.fn(),
    onManageHostAccess: vi.fn(),
    onOpenFileProfile: vi.fn(async () => undefined),
    onOpenForward: vi.fn(),
    onToggleFavorite: vi.fn(async () => undefined),
    onRefreshReachability: vi.fn(async () => undefined),
    getHostIconUrl: vi.fn((iconId: string) => `/host-icons/${iconId}`),
  }
}

function emptyLauncherData(): HostLauncherData {
  return {
    hosts: [],
    groups: [],
    proxies: [],
    credentials: [],
    hostReachability: {},
    sshAccessProfiles: [],
    fileAccessProfiles: [],
    remoteDesktopProfiles: [],
  }
}

function getLauncherProps(): HostLauncherModalProps {
  expect(bridgeMock.launcherProps).toBeDefined()
  return bridgeMock.launcherProps!
}
