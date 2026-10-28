import { afterEach, expect, it, vi } from 'vitest'
import type { RemoteDesktopSession } from '@termous/remote-protocol/desktop'
import { bindDesktopInput } from './desktopInput'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  const target = document.createElement('video')
  target.setPointerCapture = vi.fn()
  target.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
  const input = vi.fn()
  const session = { owned: true, controlGeneration: 1n, dimensions: { width: 200, height: 100 }, input }
  const dispose = bindDesktopInput(target, session as unknown as RemoteDesktopSession, error => { throw error })
  const pointer = (type: string, x: number, y: number) => target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0 }))
  return { target, session, input, pointer, dispose }
}

it('releases a captured button outside the video at the last valid coordinate', () => {
  const f = fixture()
  f.pointer('pointerdown', 30, 40)
  f.pointer('pointerup', 250, 150)
  expect(f.input.mock.calls.map(([v]) => v)).toEqual([
    { kind: 'button', button: 'left', down: true, x: 30, y: 40 },
    { kind: 'button', button: 'left', down: false, x: 30, y: 40 },
  ])
  f.dispose()
})

it('passes movement directly to the shared window and never releases old pressed state under a replacement lease', () => {
  const f = fixture()
  f.pointer('pointerdown', 10, 20)
  f.pointer('pointermove', 40, 50)
  f.session.controlGeneration = 2n
  f.target.dispatchEvent(new Event('lostpointercapture'))
  expect(f.input).toHaveBeenCalledTimes(2)
  expect(f.input.mock.calls[1][0]).toEqual({ kind: 'move', x: 40, y: 50 })
  f.dispose()
})

it('clears held keys and buttons when pointer capture is lost', () => {
  const f = fixture()
  f.pointer('pointerdown', 10, 20)
  f.target.dispatchEvent(new KeyboardEvent('keydown', { code: 'ControlLeft' }))
  f.target.dispatchEvent(new Event('lostpointercapture'))
  expect(f.input.mock.calls.slice(-2).map(([v]) => v)).toEqual([
    { kind: 'key', code: 'ControlLeft', down: false },
    { kind: 'button', button: 'left', down: false, x: 10, y: 20 },
  ])
  f.dispose()
})
