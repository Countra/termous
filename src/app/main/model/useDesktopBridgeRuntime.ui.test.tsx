import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type {
  AppBuildInfo,
  CoreFatalEvent,
  TermousBridge,
  TrayCommand,
  TrayMenuState,
} from '#common/contracts'
import { useDesktopBridgeRuntime } from './useDesktopBridgeRuntime'

const originalBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'termous')

const initialBuildInfo: AppBuildInfo = {
  product_name: 'Termous',
  version: '0.0.0-dev',
  core_version: null,
  platform: 'win32',
  arch: 'x64',
  packaged: false,
  update_supported: false,
  update_support_reason: 'development',
}

const trayState: TrayMenuState = {
  language: 'zh-CN',
  recentHosts: [{ id: 'host-1', name: '测试主机' }],
  labels: {
    openApp: '打开 Termous',
    connectHost: '连接主机',
    recentHosts: '最近主机',
    emptyRecentHosts: '暂无最近主机',
    forwards: '端口转发',
    updateAvailable: '有可用更新',
    updateDownloading: '正在下载更新',
    updateDownloaded: '更新已下载',
    quit: '退出',
  },
}

type HookOptions = Parameters<typeof useDesktopBridgeRuntime>[0]

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createBridge(options: {
  buildInfo?: Promise<AppBuildInfo>
  fatal?: Promise<CoreFatalEvent | null>
  trayUpdate?: (state: TrayMenuState) => Promise<boolean>
} = {}) {
  let fatalListener: ((fatal: CoreFatalEvent) => void) | null = null
  let trayListener: ((command: TrayCommand) => void) | null = null
  const fatalCleanup = vi.fn()
  const trayCleanup = vi.fn()
  const ready = vi.fn(async () => true)
  const setTheme = vi.fn(async () => true)
  const updateState = vi.fn(options.trayUpdate ?? (async () => true))
  const onFatal = vi.fn((listener: (fatal: CoreFatalEvent) => void) => {
    fatalListener = listener
    return fatalCleanup
  })
  const onCommand = vi.fn((listener: (command: TrayCommand) => void) => {
    trayListener = listener
    return trayCleanup
  })
  const bridge: TermousBridge = {
    getConfig: async () => ({}),
    getBuildInfo: () => options.buildInfo ?? Promise.resolve(initialBuildInfo),
    platform: 'win32',
    core: {
      status: async () => ({
        config: { apiBaseUrl: '', apiToken: '' },
        fatal: null,
      }),
      shutdown: async () => true,
      getFatal: () => options.fatal ?? Promise.resolve(null),
      onFatal,
    },
    startup: { ready },
    appearance: { setTheme },
    tray: { updateState, onCommand },
  }
  return {
    bridge,
    emitFatal: (fatal: CoreFatalEvent) => fatalListener?.(fatal),
    emitTrayCommand: (command: unknown) => {
      const listener = trayListener as ((value: unknown) => void) | null
      listener?.(command)
    },
    fatalCleanup,
    onCommand,
    ready,
    setTheme,
    trayCleanup,
    updateState,
  }
}

function installBridge(bridge: TermousBridge | null) {
  if (!bridge) {
    Reflect.deleteProperty(window, 'termous')
    return
  }
  Object.defineProperty(window, 'termous', {
    configurable: true,
    value: bridge,
  })
}

function runtimeOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    initialBuildInfo,
    initializing: true,
    startupFailed: false,
    apiReady: false,
    appearanceTheme: 'dark',
    onThemeChange: vi.fn(),
    trayState,
    onTrayCommand: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  if (originalBridgeDescriptor) {
    Object.defineProperty(window, 'termous', originalBridgeDescriptor)
  } else {
    Reflect.deleteProperty(window, 'termous')
  }
})

test('没有桌面桥接时保留初始构建信息且不产生副作用', () => {
  installBridge(null)
  const onThemeChange = vi.fn()
  const onTrayCommand = vi.fn()

  const { result } = renderHook(() => useDesktopBridgeRuntime(runtimeOptions({
    onThemeChange,
    onTrayCommand,
  })))

  expect(result.current).toEqual({
    buildInfo: initialBuildInfo,
    nativeCoreFatal: null,
  })
  expect(onThemeChange).not.toHaveBeenCalled()
  expect(onTrayCommand).not.toHaveBeenCalled()
})

test('桥接替换后忽略旧异步结果并清理旧订阅', async () => {
  const firstBuild = deferred<AppBuildInfo>()
  const firstFatal = deferred<CoreFatalEvent | null>()
  const first = createBridge({ buildInfo: firstBuild.promise, fatal: firstFatal.promise })
  installBridge(first.bridge)
  const options = runtimeOptions()
  const harness = renderHook(
    (current: HookOptions) => useDesktopBridgeRuntime(current),
    { initialProps: options },
  )

  const latestBuild = { ...initialBuildInfo, version: '2.0.0' }
  const latestFatal: CoreFatalEvent = {
    title: 'Core 启动失败',
    message: 'latest fatal',
    code: 'LATEST_FATAL',
  }
  const second = createBridge({
    buildInfo: Promise.resolve(latestBuild),
    fatal: Promise.resolve(latestFatal),
  })
  installBridge(second.bridge)
  harness.rerender(options)
  await act(async () => undefined)

  expect(harness.result.current).toEqual({
    buildInfo: latestBuild,
    nativeCoreFatal: latestFatal,
  })
  expect(first.fatalCleanup).toHaveBeenCalledTimes(1)
  expect(first.trayCleanup).toHaveBeenCalledTimes(1)

  await act(async () => {
    firstBuild.resolve({ ...initialBuildInfo, version: '1.0.0' })
    firstFatal.resolve({
      title: '旧错误',
      message: 'stale fatal',
      code: 'STALE_FATAL',
    })
  })
  expect(harness.result.current).toEqual({
    buildInfo: latestBuild,
    nativeCoreFatal: latestFatal,
  })
})

test('桥接替换后不会保留旧桥接上报的 Core fatal', async () => {
  const firstFatal: CoreFatalEvent = {
    title: '旧 Core 启动失败',
    message: 'stale fatal',
    code: 'STALE_FATAL',
  }
  const first = createBridge({ fatal: Promise.resolve(firstFatal) })
  installBridge(first.bridge)
  const options = runtimeOptions()
  const harness = renderHook(
    (current: HookOptions) => useDesktopBridgeRuntime(current),
    { initialProps: options },
  )
  await act(async () => undefined)
  expect(harness.result.current.nativeCoreFatal).toEqual(firstFatal)

  const second = createBridge({ fatal: Promise.resolve(null) })
  installBridge(second.bridge)
  harness.rerender(options)
  await act(async () => undefined)

  expect(harness.result.current.nativeCoreFatal).toBeNull()
  expect(first.fatalCleanup).toHaveBeenCalledTimes(1)
})

test('卸载时同时清理 Core fatal 与托盘命令订阅', () => {
  const desktop = createBridge()
  installBridge(desktop.bridge)
  const { unmount } = renderHook(() => useDesktopBridgeRuntime(runtimeOptions()))

  unmount()

  expect(desktop.fatalCleanup).toHaveBeenCalledTimes(1)
  expect(desktop.trayCleanup).toHaveBeenCalledTimes(1)
})

test('初始化结束、启动失败或原生 fatal 均会通知启动就绪', async () => {
  const desktop = createBridge()
  installBridge(desktop.bridge)
  const initialOptions = runtimeOptions()
  const harness = renderHook(
    (current: HookOptions) => useDesktopBridgeRuntime(current),
    { initialProps: initialOptions },
  )
  await act(async () => undefined)
  expect(desktop.ready).not.toHaveBeenCalled()

  harness.rerender({ ...initialOptions, startupFailed: true })
  expect(desktop.ready).toHaveBeenCalledTimes(1)

  harness.rerender({ ...initialOptions, initializing: false })
  expect(desktop.ready).toHaveBeenCalledTimes(2)

  harness.rerender(initialOptions)
  act(() => desktop.emitFatal({
    title: 'Core 启动失败',
    message: 'fatal',
    code: 'CORE_FATAL',
  }))
  expect(desktop.ready).toHaveBeenCalledTimes(3)
})

test('仅在 API 就绪且初始化完成后同步外观主题', () => {
  const desktop = createBridge()
  installBridge(desktop.bridge)
  const onThemeChange = vi.fn()
  const initialOptions = runtimeOptions({ onThemeChange })
  const harness = renderHook(
    (current: HookOptions) => useDesktopBridgeRuntime(current),
    { initialProps: initialOptions },
  )

  harness.rerender({ ...initialOptions, apiReady: true })
  expect(onThemeChange).not.toHaveBeenCalled()
  expect(desktop.setTheme).not.toHaveBeenCalled()

  harness.rerender({ ...initialOptions, apiReady: true, initializing: false })
  expect(onThemeChange).toHaveBeenLastCalledWith('dark')
  expect(desktop.setTheme).toHaveBeenLastCalledWith('dark')

  harness.rerender({
    ...initialOptions,
    apiReady: true,
    initializing: false,
    appearanceTheme: 'light',
  })
  expect(onThemeChange).toHaveBeenLastCalledWith('light')
  expect(desktop.setTheme).toHaveBeenLastCalledWith('light')
})

test('托盘状态更新失败被隔离且不阻断 Hook', async () => {
  const desktop = createBridge({
    trayUpdate: async () => { throw new Error('tray update failed') },
  })
  installBridge(desktop.bridge)

  const { result } = renderHook(() => useDesktopBridgeRuntime(runtimeOptions()))
  await act(async () => undefined)

  expect(desktop.updateState).toHaveBeenCalledWith(trayState)
  expect(result.current.buildInfo).toEqual(initialBuildInfo)
})

test('托盘命令只转交合法值并始终调用最新业务回调', () => {
  const desktop = createBridge()
  installBridge(desktop.bridge)
  const firstHandler = vi.fn()
  const latestHandler = vi.fn()
  const initialOptions = runtimeOptions({ onTrayCommand: firstHandler })
  const harness = renderHook(
    (current: HookOptions) => useDesktopBridgeRuntime(current),
    { initialProps: initialOptions },
  )

  harness.rerender({ ...initialOptions, onTrayCommand: latestHandler })
  expect(desktop.onCommand).toHaveBeenCalledTimes(1)

  desktop.emitTrayCommand(null)
  desktop.emitTrayCommand({ type: 'unknown' })
  desktop.emitTrayCommand({ type: 'connect-recent-host' })
  desktop.emitTrayCommand({ type: 'connect-recent-host', hostId: '' })
  expect(firstHandler).not.toHaveBeenCalled()
  expect(latestHandler).not.toHaveBeenCalled()

  const commands: TrayCommand[] = [
    { type: 'open-app' },
    { type: 'open-host-launcher' },
    { type: 'open-forwards' },
    { type: 'connect-recent-host', hostId: 'host-1' },
  ]
  commands.forEach(desktop.emitTrayCommand)

  expect(firstHandler).not.toHaveBeenCalled()
  expect(latestHandler.mock.calls.map(([command]) => command)).toEqual(commands)
})
