import { renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useTermousData } from './useTermousData'

function restoreProperty(
  target: Window,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
    return
  }
  Reflect.deleteProperty(target, property)
}

test('普通父级重渲染保持 RuntimeGateways、领域 gateway 及 action 引用稳定', () => {
  const originalBridge = Object.getOwnPropertyDescriptor(window, 'termous')
  const pendingConfig = new Promise<never>(() => undefined)
  Object.defineProperty(window, 'termous', {
    configurable: true,
    value: {
      getConfig: () => pendingConfig,
    },
  })

  const view = renderHook(
    ({ marker }) => ({ marker, state: useTermousData() }),
    { initialProps: { marker: 'first' } },
  )

  try {
    const firstGateways = view.result.current.state.gateways
    const firstDomainGateways = Object.entries(firstGateways)
    const firstActions = view.result.current.state.actions
    const firstDomainActions = Object.entries(firstActions)
    expect(view.result.current.state.runtimeConfigReady).toBe(false)

    view.rerender({ marker: 'second' })

    expect(view.result.current.marker).toBe('second')
    expect(view.result.current.state.gateways).toBe(firstGateways)
    for (const [name, gateway] of firstDomainGateways) {
      expect(view.result.current.state.gateways[name as keyof typeof firstGateways]).toBe(gateway)
    }
    expect(view.result.current.state.actions).toBe(firstActions)
    for (const [name, action] of firstDomainActions) {
      expect(view.result.current.state.actions[name as keyof typeof firstActions]).toBe(action)
    }
  } finally {
    view.unmount()
    restoreProperty(window, 'termous', originalBridge)
  }
})

test('Preload 配置解析成功后才开放依赖 Core 的运行时', async () => {
  const originalBridge = Object.getOwnPropertyDescriptor(window, 'termous')
  Object.defineProperty(window, 'termous', {
    configurable: true,
    value: {
      getConfig: () => Promise.resolve({
        apiBaseUrl: 'http://127.0.0.1:49217',
        apiToken: 'renderer-test-token',
      }),
    },
  })
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('测试不连接 Core')))

  const view = renderHook(() => useTermousData())

  try {
    expect(view.result.current.runtimeConfigReady).toBe(false)
    await waitFor(() => expect(view.result.current.runtimeConfigReady).toBe(true))
    expect(fetch).toHaveBeenCalled()
  } finally {
    view.unmount()
    vi.unstubAllGlobals()
    restoreProperty(window, 'termous', originalBridge)
  }
})

test('Preload 配置解析失败时保持 Core 运行时门禁关闭', async () => {
  const originalBridge = Object.getOwnPropertyDescriptor(window, 'termous')
  Object.defineProperty(window, 'termous', {
    configurable: true,
    value: {
      getConfig: () => Promise.reject(new Error('配置读取失败')),
    },
  })

  const view = renderHook(() => useTermousData())

  try {
    await waitFor(() => expect(view.result.current.initializing).toBe(false))
    expect(view.result.current.runtimeConfigReady).toBe(false)
    expect(view.result.current.error).toBe('配置读取失败')
  } finally {
    view.unmount()
    restoreProperty(window, 'termous', originalBridge)
  }
})
