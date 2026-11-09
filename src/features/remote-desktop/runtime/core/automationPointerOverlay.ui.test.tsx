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
  const input = vi.fn()
  for (const event of ['pointermove', 'pointerdown', 'pointerup', 'click', 'wheel']) target.addEventListener(event, input)
  const feed = new AutomationPointerState('desktop', 1)
  const geometry = { left: 0, top: 0, width: 400, height: 300, remoteX: 0, remoteY: 0, remoteWidth: 800, remoteHeight: 600, displayEpoch: 1 }
  const visible = vi.fn(() => true)
  const overlay = createAutomationPointerOverlay({ target, feed, geometry: () => geometry, visible })
  overlays.push(overlay)
  const control: DesktopPointerControl = { automation_id: 'grant', source: 'agent', execution_generation: 1, expires_at: new Date(Date.now() + 60_000).toISOString() }
  let revision = 0
  const publish = (pointer: DesktopPointerEvent['pointer'], authority: DesktopPointerControl | null | undefined = control, live = true, advance = 20) => {
    feed.publish({ type: 'automation_pointer', session_id: 'desktop', connection_generation: 1, revision: ++revision, pointer, control: authority }, live)
    vi.advanceTimersByTime(advance)
  }
  const pointer = (patch: Partial<NonNullable<DesktopPointerEvent['pointer']>> = {}) => ({ automation_id: 'grant', source: 'agent', execution_generation: 1, display_epoch: 1,
    sequence: revision + 1, x: 200, y: 100, buttons: 0, action: 'click', occurred_at: new Date().toISOString(), ...patch }) as NonNullable<DesktopPointerEvent['pointer']>
  const root = target.querySelector<HTMLElement>('[data-automation-pointer]')!
  const ring = root.querySelector<HTMLElement>('[data-pointer-effect="click"]')!
  const marker = root.firstElementChild as HTMLElement
  const displayed = () => marker.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!.slice(1).map(Number)
  return { target, canvas, input, feed, geometry, overlay, control, publish, pointer, root, ring, marker, displayed, visible }
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

it('点击间短时平滑移动，仅在准确到位后播放反馈且不派发输入', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  expect(f.displayed()).toEqual([100, 50])
  f.publish(f.pointer({ x: 600, y: 400 }))
  vi.advanceTimersByTime(32)
  expect(f.displayed()[0]).toBeGreaterThan(100)
  expect(f.displayed()[0]).toBeLessThan(300)
  expect(f.ring.style.opacity).toBe('0')
  vi.advanceTimersByTime(160)
  expect(f.displayed()).toEqual([300, 200])
  expect(Number(f.ring.style.opacity)).toBeGreaterThan(0)
  expect(f.input).not.toHaveBeenCalled()
  vi.advanceTimersByTime(300)
  const frames = vi.mocked(window.requestAnimationFrame).mock.calls.length
  vi.advanceTimersByTime(500)
  expect(vi.mocked(window.requestAnimationFrame).mock.calls.length).toBe(frames)
})

it('连续输入覆盖旧目标与待播点击，移动不排队也不携带旧涟漪', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 700, y: 500 }))
  vi.advanceTimersByTime(32)
  const before = f.displayed()[0]
  f.publish(f.pointer({ x: 40, y: 80, action: 'move' }))
  expect(f.displayed()[0]).toBeGreaterThan(20)
  expect(f.displayed()[0]).toBeLessThanOrEqual(before)
  vi.advanceTimersByTime(80)
  expect(f.displayed()).toEqual([20, 40])
  expect(f.ring.style.opacity).toBe('0')
  vi.advanceTimersByTime(300)
  expect(f.displayed()).toEqual([20, 40])
  expect(f.ring.style.opacity).toBe('0')
})

it('拖拽短时跟随，按钮按下和释放立即对齐确认位置', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 500, y: 300, action: 'button', buttons: 1 }))
  expect(f.displayed()).toEqual([250, 150])
  expect(f.marker.dataset.pressed).toBe('true')
  f.publish(f.pointer({ x: 700, y: 500, action: 'move', buttons: 1 }))
  vi.advanceTimersByTime(64)
  expect(f.displayed()).toEqual([350, 250])
  f.publish(f.pointer({ x: 600, y: 400, action: 'move', buttons: 1 }))
  f.publish(f.pointer({ x: 600, y: 400, action: 'button', buttons: 0 }))
  expect(f.displayed()).toEqual([300, 200])
  expect(f.marker.dataset.pressed).toBe('false')
  expect(f.input).not.toHaveBeenCalled()
})

it('在途续期不重置移动或重播点击，动画使用单调时钟', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  const p = f.pointer({ x: 700, y: 500 })
  f.publish(p)
  vi.advanceTimersByTime(32)
  const before = f.displayed()[0]
  vi.setSystemTime(new Date(Date.now() + 2000))
  f.publish(p, { ...f.control, expires_at: new Date(Date.now() + 60_000).toISOString() })
  expect(f.displayed()[0]).toBeGreaterThan(before)
  expect(f.displayed()[0]).toBeLessThan(350)
  vi.advanceTimersByTime(160)
  expect(f.displayed()).toEqual([350, 250])
  expect(Number(f.ring.style.opacity)).toBeGreaterThan(0)
  vi.advanceTimersByTime(300)
  f.publish(p)
  expect(f.ring.style.opacity).toBe('0')
})

it('缩放和有效画面换代取消旧动画，重新投影到真实位置', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 600, y: 400 }))
  f.geometry.width = 200
  f.geometry.height = 150
  f.overlay.refresh(); vi.advanceTimersByTime(20)
  expect(f.displayed()).toEqual([150, 100])
  expect(f.ring.style.opacity).toBe('0')
  f.geometry.displayEpoch = 2
  f.publish(f.pointer({ x: 400, y: 300, display_epoch: 2, action: 'move' }))
  expect(f.displayed()).toEqual([100, 75])
})

it('快照及迟到回执只对齐位置，新的接管代次不沿旧轨迹移动', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 600, y: 400 }), f.control, false)
  expect(f.displayed()).toEqual([300, 200])
  expect(f.ring.style.opacity).toBe('0')
  f.publish(f.pointer({ x: 400, y: 300, occurred_at: new Date(Date.now() - 1000).toISOString() }))
  expect(f.displayed()).toEqual([200, 150])
  expect(f.ring.style.opacity).toBe('0')
  f.publish(f.pointer({ x: 700, y: 500 }))
  f.publish(f.pointer({ x: 100, y: 100, execution_generation: 2, action: 'move' }), { ...f.control, execution_generation: 2 })
  expect(f.displayed()).toEqual([50, 50])
  expect(f.ring.style.opacity).toBe('0')
})

it('隐藏后快速恢复直接对齐，后台新点击不在前台补播', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 700, y: 500 }))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  f.publish(f.pointer({ x: 600, y: 400 }))
  expect(f.root.hidden).toBe(true)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(20)
  expect(f.displayed()).toEqual([300, 200])
  expect(f.ring.style.opacity).toBe('0')
  vi.advanceTimersByTime(300)
  expect(f.ring.style.opacity).toBe('0')
})

it('减少动态效果时立即对齐，运行中开启也会结束移动', () => {
  const media = new EventTarget() as MediaQueryList
  Object.defineProperty(media, 'matches', { value: false, writable: true })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media)
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 600, y: 400 }))
  Object.defineProperty(media, 'matches', { value: true })
  media.dispatchEvent(new Event('change')); vi.advanceTimersByTime(20)
  expect(f.displayed()).toEqual([300, 200])
  expect(f.ring.style.transform).toContain('scale(1)')
  f.publish(f.pointer({ x: 300, y: 200 }))
  expect(f.displayed()).toEqual([150, 100])
  expect(Number(f.ring.style.opacity)).toBeGreaterThan(0)
})

it('动画途中释放、断线或销毁会清除轨迹与待播反馈', () => {
  for (const stop of ['release', 'disconnect', 'dispose']) {
    const f = fixture()
    f.publish(f.pointer({ action: 'move' }))
    f.publish(f.pointer({ x: 700, y: 500 }))
    if (stop === 'release') f.publish(null, null)
    else if (stop === 'disconnect') f.feed.suspend()
    else f.overlay.dispose()
    vi.advanceTimersByTime(20)
    if (stop === 'dispose') expect(f.root.isConnected).toBe(false)
    else expect(f.root.hidden).toBe(true)
    const frames = vi.mocked(window.requestAnimationFrame).mock.calls.length
    vi.advanceTimersByTime(400)
    expect(vi.mocked(window.requestAnimationFrame).mock.calls.length).toBe(frames)
    expect(f.input).not.toHaveBeenCalled()
    f.overlay.dispose()
  }
  expect(vi.getTimerCount()).toBe(0)
})

it('低帧率下每帧都有新回执时仍能持续跟随，不停在旧坐标', () => {
  vi.mocked(window.requestAnimationFrame).mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 33))
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }), f.control, true, 33)
  let previous = f.displayed()[0]
  for (let index = 1; index <= 10; index++) {
    f.publish(f.pointer({ x: 200 + index * 40, y: 100, action: 'move' }), f.control, true, 33)
    if (index > 1) expect(f.displayed()[0]).toBeGreaterThan(previous)
    expect(f.displayed()[0]).toBeLessThanOrEqual(100 + index * 20)
    previous = f.displayed()[0]
  }
  vi.advanceTimersByTime(80)
  expect(f.displayed()).toEqual([300, 50])
  expect(f.input).not.toHaveBeenCalled()
})

it('同一帧内暂停并恢复视图也会清除旧动画和待播点击', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 700, y: 500 }))
  f.visible.mockReturnValue(false)
  f.overlay.refresh()
  expect(f.root.hidden).toBe(true)
  f.visible.mockReturnValue(true)
  f.overlay.refresh()
  vi.advanceTimersByTime(20)
  expect(f.displayed()).toEqual([350, 250])
  expect(f.ring.style.opacity).toBe('0')
  vi.advanceTimersByTime(300)
  expect(f.ring.style.opacity).toBe('0')
})

it('同一帧内释放后重新接管不延续前一次动画，断线立即隐藏', () => {
  const f = fixture()
  f.publish(f.pointer({ action: 'move' }))
  f.publish(f.pointer({ x: 700, y: 500 }))
  f.publish(null, null, true, 0)
  expect(f.root.hidden).toBe(true)
  f.publish(f.pointer({ x: 300, y: 200, action: 'move' }))
  expect(f.displayed()).toEqual([150, 100])
  expect(f.ring.style.opacity).toBe('0')
  f.feed.suspend()
  expect(f.root.hidden).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})
