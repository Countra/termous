import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DesktopPointerControl, DesktopPointerEvent } from '#common/contracts'
import { AutomationPointerState } from './automationPointerState.ts'
import { createAutomationPointerOverlay } from './automationPointerOverlay.ts'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-15T01:00:00Z'))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => window.clearTimeout(id))
})
const overlays: ReturnType<typeof createAutomationPointerOverlay>[] = []
afterEach(() => { overlays.splice(0).forEach(o => o.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers() })

function fixture() {
  const target = document.createElement('div')
  document.body.append(target)
  Object.defineProperties(target, { clientWidth: { value: 400 }, clientHeight: { value: 300 } })
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0 } as DOMRect)
  const canvas = document.createElement('canvas'); target.append(canvas)
  const input = vi.fn(); target.addEventListener('pointermove', input)
  const feed = new AutomationPointerState('desktop', 1)
  const geometry = { left: 0, top: 0, width: 400, height: 300, remoteX: 0, remoteY: 0, remoteWidth: 800, remoteHeight: 600, displayEpoch: 1 }
  const overlay = createAutomationPointerOverlay({ target, feed, geometry: () => geometry, visible: () => true })
  overlays.push(overlay)
  const control: DesktopPointerControl = { automation_id: 'grant', source: 'agent', execution_generation: 1, expires_at: new Date(Date.now() + 60_000).toISOString() }
  let revision = 0
  const publish = (pointer: DesktopPointerEvent['pointer'], authority: DesktopPointerControl | null | undefined = control, live = true) => {
    feed.publish({ type: 'automation_pointer', session_id: 'desktop', connection_generation: 1, revision: ++revision, pointer, control: authority }, live)
    vi.advanceTimersByTime(20)
  }
  const pointer = (patch: Partial<NonNullable<DesktopPointerEvent['pointer']>> = {}) => ({ automation_id: 'grant', source: 'agent', execution_generation: 1, display_epoch: 1,
    sequence: revision + 1, x: 200, y: 100, buttons: 0, action: 'click', occurred_at: new Date().toISOString(), ...patch }) as NonNullable<DesktopPointerEvent['pointer']>
  const root = target.querySelector<HTMLElement>('[data-automation-pointer]')!
  const ring = root.querySelector<HTMLElement>('[data-pointer-effect="click"]')!
  return { target, canvas, input, feed, geometry, overlay, control, publish, pointer, root, ring }
}

it('接管即显示待命标识，静止超过三秒仍可见，释放立即隐藏且不产生输入', () => {
  const f = fixture()
  vi.advanceTimersByTime(20)
  expect(f.root.hidden).toBe(true)
  f.publish(null)
  expect(f.root.hidden).toBe(false)
  expect(f.root.dataset.mode).toBe('standby')
  expect(f.root.textContent).toContain('AI')
  vi.advanceTimersByTime(10_000)
  expect(f.root.hidden).toBe(false)
  f.publish(f.pointer())
  expect(f.root.dataset.mode).toBe('tracking')
  expect(f.root.firstElementChild?.getAttribute('style')).toContain('translate(100px, 50px)')
  expect(Number(f.ring.style.opacity)).toBeGreaterThan(0)
  vi.advanceTimersByTime(3100)
  expect(f.root.hidden).toBe(false)
  expect(f.root.dataset.idle).toBe('true')
  expect(f.ring.style.opacity).toBe('0')
  const draws = vi.mocked(window.requestAnimationFrame).mock.calls.length
  vi.advanceTimersByTime(10_000)
  expect(vi.mocked(window.requestAnimationFrame).mock.calls.length).toBe(draws)
  expect(f.canvas.children).toHaveLength(0)
  expect(f.input).not.toHaveBeenCalled()
  f.publish(null, null)
  expect(f.root.hidden).toBe(true)
  f.overlay.dispose()
  overlays.pop()
  expect(f.target.querySelector('[data-automation-pointer]')).toBeNull()
  expect(vi.getTimerCount()).toBe(0)
})

it('裁剪或画面换代时回到待命，不将旧坐标吸附到边缘', () => {
  const f = fixture()
  f.publish(f.pointer())
  f.geometry.remoteX = 300
  document.dispatchEvent(new Event('scroll'))
  vi.advanceTimersByTime(20)
  expect(f.root.dataset.mode).toBe('standby')
  expect(f.root.firstElementChild?.getAttribute('style')).not.toContain('translate')
  f.geometry.remoteX = 0
  f.geometry.displayEpoch = 2
  f.overlay.refresh(); vi.advanceTimersByTime(20)
  expect(f.root.dataset.mode).toBe('standby')
  f.publish(f.pointer({ display_epoch: 2, action: 'move' }))
  expect(f.root.dataset.mode).toBe('tracking')
})

it('恢复快照和授权续期不重播点击，拖拽及滚动保留独立反馈', () => {
  const f = fixture()
  const p = f.pointer()
  f.publish(p, f.control, false)
  expect(f.ring.style.opacity).toBe('0')
  f.publish(p, { ...f.control, expires_at: new Date(Date.now() + 90_000).toISOString() })
  expect(f.ring.style.opacity).toBe('0')
  f.publish(f.pointer({ buttons: 1, action: 'button' }))
  vi.advanceTimersByTime(3100)
  expect((f.root.firstElementChild as HTMLElement).dataset.pressed).toBe('true')
  expect(f.root.dataset.idle).toBe('false')
  f.publish(f.pointer({ action: 'wheel', scroll: 'left' }))
  expect(f.root.textContent).toContain('←')
  vi.advanceTimersByTime(300)
  expect(f.root.textContent).not.toContain('←')
})

it('尚无鼠标输入时授权也会到期，续期后使用新的期限', () => {
  const f = fixture()
  f.publish(null, { ...f.control, expires_at: new Date(Date.now() + 100).toISOString() })
  vi.advanceTimersByTime(50)
  f.publish(null, { ...f.control, expires_at: new Date(Date.now() + 200).toISOString() })
  vi.advanceTimersByTime(100)
  expect(f.root.hidden).toBe(false)
  vi.advanceTimersByTime(150)
  expect(f.root.hidden).toBe(true)
})

it('隐藏窗口暂停展示，回来恢复位置但不重播点击，断线清除待命状态', () => {
  const f = fixture()
  f.publish(f.pointer())
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(20)
  expect(f.root.hidden).toBe(true)
  vi.advanceTimersByTime(4000)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(20)
  expect(f.root.hidden).toBe(false)
  expect(f.ring.style.opacity).toBe('0')
  f.feed.suspend(); vi.advanceTimersByTime(20)
  expect(f.root.hidden).toBe(true)
})

it('旧 Core 未提供接管状态时仍只短暂显示鼠标反馈', () => {
  const f = fixture()
  f.feed.publish({ type: 'automation_pointer', session_id: 'desktop', connection_generation: 1, revision: 1, pointer: f.pointer() })
  vi.advanceTimersByTime(20)
  expect(f.root.hidden).toBe(false)
  vi.advanceTimersByTime(3100)
  expect(f.root.hidden).toBe(true)
})
