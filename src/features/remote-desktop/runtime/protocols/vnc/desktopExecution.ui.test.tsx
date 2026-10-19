import type RFB from '@novnc/novnc'
import { afterEach, expect, test, vi } from 'vitest'
import { VncDesktopExecution } from './desktopExecution.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test.each([false, true])('到期回调延迟时重复租约不能重新启用输入（续租：%s）', (renew) => {
  vi.useFakeTimers()
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer: vi.fn(), desktopState: { width: 800, height: 600, displayEpoch: 1, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 1, vi.fn())
  const lease = { id: 'lease', owner: 'local-viewer', generation: 1, expires_at: '2040-01-01T00:00:00Z', remaining_ms: 1000 }
  execution.setControl(lease)
  // 模拟页面暂停后恢复，单调时间已到期但定时器尚未获得执行机会。
  clock.mockReturnValue(1001)
  expect(() => execution.setControl(lease, renew)).toThrow('desktop_control_stale')
  expect(rfb.localInputEnabled).toBe(false)
  expect(rfb.viewOnly).toBe(true)
  expect(execution.describe().control).toBeUndefined()
  execution.dispose()
})

test('本机日期变化和同一租约重复快照都不能影响控制到期', () => {
  vi.useFakeTimers()
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer: vi.fn(), desktopState: { width: 800, height: 600, displayEpoch: 1, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 1, vi.fn())
  const lease = { id: 'lease', owner: 'program', generation: 1, expires_at: '2000-01-01T00:00:00Z', remaining_ms: 10000 }
  execution.setControl(lease)
  vi.advanceTimersByTime(5000)
  vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
  execution.setControl(lease, true)
  expect(rfb.viewOnly).toBe(false)
  vi.advanceTimersByTime(5001)
  expect(rfb.viewOnly).toBe(true)
  expect(execution.describe().control).toBeUndefined()
  expect(() => execution.setControl(lease)).toThrow('desktop_control_stale')
  expect(rfb.viewOnly).toBe(true)
  execution.dispose()
})

test('主动释放后不能重用旧快照，新租约仍可正常接管', () => {
  vi.useFakeTimers()
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer: vi.fn(), desktopState: { width: 800, height: 600, displayEpoch: 1, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 1, vi.fn())
  const lease = { id: 'lease', owner: 'local-viewer', generation: 1, expires_at: '2040-01-01T00:00:00Z', remaining_ms: 10000 }
  execution.setControl(lease)
  execution.setControl(null)
  expect(() => execution.setControl(lease)).toThrow('desktop_control_stale')
  expect(rfb.localInputEnabled).toBe(false)
  execution.setControl({ ...lease, id: 'next-lease', generation: 2 })
  expect(rfb.localInputEnabled).toBe(true)
  execution.dispose()
})

test('程序接管暂停人工输入，租约过期释放全部按下状态并拒绝迟到输入', () => {
  vi.useFakeTimers()
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer: vi.fn(), desktopState: { width: 800, height: 600, displayEpoch: 2, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 3, vi.fn())
  const lease = { id: 'lease', owner: 'program', generation: 2, expires_at: new Date(Date.now() - 86400000).toISOString(), remaining_ms: 30000 }
  execution.setControl(lease)
  expect(rfb.localInputEnabled).toBe(false)
  const base = { expected_connection_generation: 3, lease_id: 'lease', control_generation: 2, display_epoch: 2 }
  execution.execute({ ...base, sequence: 1, operation: { kind: 'key', code: 'ShiftLeft', down: true } })
  execution.execute({ ...base, sequence: 2, operation: { kind: 'button', button: 'left', down: true, x: 400, y: 300 } })
  vi.advanceTimersByTime(30001)
  expect(rfb.sendKey).toHaveBeenLastCalledWith(0xffe1, 'ShiftLeft', false)
  expect(rfb.sendPointer).toHaveBeenLastCalledWith(400, 300, 0)
  expect(rfb.viewOnly).toBe(true)
  expect(() => execution.execute({ ...base, sequence: 3, operation: { kind: 'move' } })).toThrow('desktop_control_stale')
  execution.dispose()
})

test('过期尺寸和未知键位在发送任何输入前拒绝', () => {
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer: vi.fn(), desktopState: { width: 800, height: 600, displayEpoch: 2, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 1, vi.fn())
  execution.setControl({ id: 'lease', owner: 'program', generation: 1, expires_at: new Date(Date.now() - 86400000).toISOString(), remaining_ms: 30000 })
  const base = { expected_connection_generation: 1, lease_id: 'lease', control_generation: 1, display_epoch: 1, sequence: 1 }
  expect(() => execution.execute({ ...base, operation: { kind: 'click', button: 'left' } })).toThrow('desktop_display_stale')
  expect(() => execution.execute({ ...base, operation: { kind: 'shortcut', codes: ['ShiftLeft', 'Unknown'] } })).toThrow('desktop_capability_unsupported')
  expect(rfb.sendKey).not.toHaveBeenCalled()
  expect(rfb.sendPointer).not.toHaveBeenCalled()
  execution.dispose()
})

test('桌面缩小后仍能释放旧位置的鼠标按钮', () => {
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer: vi.fn(), desktopState: { width: 800, height: 600, displayEpoch: 1, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 1, vi.fn())
  execution.setControl({ id: 'lease', owner: 'program', generation: 1, expires_at: new Date(Date.now() - 86400000).toISOString(), remaining_ms: 30000 })
  execution.execute({ expected_connection_generation: 1, lease_id: 'lease', control_generation: 1, sequence: 1, display_epoch: 1, operation: { kind: 'button', button: 'left', down: true, x: 700, y: 500 } })
  rfb.desktopState = { width: 400, height: 300, displayEpoch: 2, sequence: 2 }
  execution.setControl(null)
  expect(rfb.sendPointer).toHaveBeenLastCalledWith(399, 299, 0)
  expect(execution.describe().control).toBeUndefined()
  execution.dispose()
})

test('点击释放报文失败时补发清理，结果不确定且旧租约失效', () => {
  const sendPointer = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('write failed') })
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer, desktopState: { width: 800, height: 600, displayEpoch: 1, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 1, vi.fn())
  execution.setControl({ id: 'lease', owner: 'program', generation: 1, expires_at: new Date(Date.now() - 86400000).toISOString(), remaining_ms: 30000 })
  const input = { expected_connection_generation: 1, lease_id: 'lease', control_generation: 1, sequence: 1, display_epoch: 1, operation: { kind: 'click' as const, button: 'left' as const, x: 20, y: 30 } }
  expect(() => execution.execute(input)).toThrow('desktop_input_uncertain')
  expect(sendPointer).toHaveBeenLastCalledWith(20, 30, 0)
  expect(sendPointer).toHaveBeenCalledTimes(3)
  expect(() => execution.execute(input)).toThrow('desktop_control_stale')
  execution.dispose()
})

test.each(['key', 'button'] as const)('独立 %s 松开失败后仍保留状态用于补发清理', (kind) => {
  const rfb = { localInputEnabled: true, viewOnly: false, sendKey: vi.fn(), sendPointer: vi.fn(), desktopState: { width: 800, height: 600, displayEpoch: 1, sequence: 1 } }
  const execution = new VncDesktopExecution(rfb as unknown as RFB, 1, vi.fn())
  execution.setControl({ id: 'lease', owner: 'program', generation: 1, expires_at: new Date(Date.now() - 86400000).toISOString(), remaining_ms: 30000 })
  const base = { expected_connection_generation: 1, lease_id: 'lease', control_generation: 1, display_epoch: 1 }
  const operation = kind === 'key' ? { kind, code: 'KeyA' } : { kind, button: 'left' as const, x: 5, y: 6 }
  execution.execute({ ...base, sequence: 1, operation: { ...operation, down: true } })
  const sender = kind === 'key' ? rfb.sendKey : rfb.sendPointer
  sender.mockImplementationOnce(() => { throw new Error('release failed') })
  expect(() => execution.execute({ ...base, sequence: 2, operation: { ...operation, down: false } })).toThrow('desktop_input_uncertain')
  expect(sender).toHaveBeenCalledTimes(3)
  expect(execution.describe().control).toBeUndefined()
  execution.dispose()
})
