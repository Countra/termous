import RFB from '@novnc/novnc'
import { expect, test, vi } from 'vitest'

// 直接运行固定依赖的实际方法，验证补丁与二进制报文，不用适配器替身覆盖协议行为。
function fixture() {
  const bytes: number[] = []
  const sock = {
    sQpush8: (value: number) => bytes.push(value & 255),
    sQpush16: (value: number) => bytes.push(value >> 8 & 255, value & 255),
    sQpush32: (value: number) => bytes.push(value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255),
    flush: vi.fn(), rQwait: () => false, rQpeek8: () => 1, rQskipBytes: vi.fn(), rQshift32: () => 0,
  }
  const viewer = Object.assign(Object.create(RFB.prototype) as RFB, {
    _listeners: new Map(), _sock: sock, _rfbConnectionState: 'connected', _localInputEnabled: true,
    _viewOnly: false, _supportsSetDesktopSize: true, _pendingRemoteResize: false, _resizeSession: false,
    _screenID: 0, _screenFlags: 0, _fbWidth: 1920, _fbHeight: 1080, _capabilities: {},
    _FBU: { x: 1, y: 0, width: 1280, height: 720 }, _resize: vi.fn(),
  }) as unknown as RFB & { _handleExtendedDesktopSize(): boolean; _FBU: { x: number; y: number; width: number; height: number }; _localInputEnabled: boolean; _pendingRemoteResize: boolean; _supportsSetDesktopSize: boolean }
  return { viewer, bytes, sock }
}

test('真实 noVNC 显式分辨率请求使用既有报文，收到成功或拒绝回执后释放在途状态', () => {
  const f = fixture(), result = vi.fn()
  f.viewer.addEventListener('desktopresize', result)
  expect(f.viewer.requestDesktopSize(1280, 720)).toBe(true)
  expect(f.bytes.slice(0, 8)).toEqual([251, 0, 5, 0, 2, 208, 1, 0])
  expect(() => f.viewer.requestDesktopSize(1600, 900)).toThrow('desktop_resize_unavailable')
  f.viewer._handleExtendedDesktopSize()
  expect(result.mock.lastCall?.[0].detail).toMatchObject({ success: true, width: 1280, height: 720 })
  expect(f.viewer._pendingRemoteResize).toBe(false)
  expect(f.viewer.requestDesktopSize(1600, 900)).toBe(true)
  f.viewer._FBU.y = 1
  f.viewer._handleExtendedDesktopSize()
  expect(result.mock.lastCall?.[0].detail.success).toBe(false)
  expect(f.viewer._pendingRemoteResize).toBe(false)
})

test('真实 noVNC 保留权限限制并发布动态分辨率能力', () => {
  const f = fixture()
  f.viewer._localInputEnabled = false
  expect(() => f.viewer.requestDesktopSize(1280, 720)).toThrow('desktop_resize_unavailable')
  expect(f.sock.flush).not.toHaveBeenCalled()
  expect(() => f.viewer.requestDesktopSize(0, 720)).toThrow('desktop_invalid_size')
  f.viewer._supportsSetDesktopSize = false
  f.viewer._FBU.x = 0
  const capability = vi.fn()
  f.viewer.addEventListener('capabilities', capability)
  f.viewer._handleExtendedDesktopSize()
  expect(capability.mock.lastCall?.[0].detail.capabilities.resize).toBe(true)
})
