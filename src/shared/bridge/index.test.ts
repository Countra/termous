import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getTermousBridge,
  getTermousUpdateBridge,
} from './index.ts'

type MainBridge = NonNullable<ReturnType<typeof getTermousBridge>>
type UpdateBridge = NonNullable<ReturnType<typeof getTermousUpdateBridge>>

function restoreWindowDescriptor(descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, 'window', descriptor)
    return
  }
  Reflect.deleteProperty(globalThis, 'window')
}

test('bridge getter 每次读取当前窗口且不依赖模块加载时的全局对象', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

  try {
    Reflect.deleteProperty(globalThis, 'window')
    assert.equal(getTermousBridge(), null)
    assert.equal(getTermousUpdateBridge(), null)

    const firstMainBridge = { identity: 'first-main' } as unknown as MainBridge
    const firstUpdateBridge = { identity: 'first-update' } as unknown as UpdateBridge
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      enumerable: true,
      value: {
        termous: firstMainBridge,
        termousUpdate: firstUpdateBridge,
      },
      writable: true,
    })
    assert.strictEqual(getTermousBridge(), firstMainBridge)
    assert.strictEqual(getTermousUpdateBridge(), firstUpdateBridge)

    const secondMainBridge = { identity: 'second-main' } as unknown as MainBridge
    const secondUpdateBridge = { identity: 'second-update' } as unknown as UpdateBridge
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      enumerable: false,
      value: {
        termous: secondMainBridge,
        termousUpdate: secondUpdateBridge,
      },
      writable: false,
    })
    assert.strictEqual(getTermousBridge(), secondMainBridge)
    assert.strictEqual(getTermousUpdateBridge(), secondUpdateBridge)

    Reflect.deleteProperty(globalThis, 'window')
    assert.equal(getTermousBridge(), null)
    assert.equal(getTermousUpdateBridge(), null)
  } finally {
    restoreWindowDescriptor(originalDescriptor)
  }

  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, 'window'),
    originalDescriptor,
  )
})
