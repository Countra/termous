import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
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

test('普通父级重渲染保持 RuntimeGateways 及各领域 gateway 引用稳定', () => {
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

    view.rerender({ marker: 'second' })

    expect(view.result.current.marker).toBe('second')
    expect(view.result.current.state.gateways).toBe(firstGateways)
    for (const [name, gateway] of firstDomainGateways) {
      expect(view.result.current.state.gateways[name as keyof typeof firstGateways]).toBe(gateway)
    }
  } finally {
    view.unmount()
    restoreProperty(window, 'termous', originalBridge)
  }
})
