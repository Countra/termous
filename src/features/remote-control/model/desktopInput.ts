import type { RemoteDesktopSession } from '@termous/remote-protocol/desktop'

// 播放器只转换原始桌面坐标；限频和编号前合并由共享输入窗口统一处理。
export function bindDesktopInput(target: HTMLVideoElement, session: RemoteDesktopSession, failed: (error: unknown) => void) {
  const abort = new AbortController()
  const keys = new Set<string>()
  const buttons = new Set<'left' | 'middle' | 'right'>()
  let position = { x: 0, y: 0 }
  let generation = session.controlGeneration
  const current = () => {
    if (generation !== session.controlGeneration) {
      generation = session.controlGeneration
      keys.clear(); buttons.clear()
    }
    return session.owned
  }
  const send = (operation: Parameters<RemoteDesktopSession['input']>[0]) => { try { session.input(operation) } catch (error) { failed(error) } }
  const point = (event: PointerEvent | WheelEvent) => {
    const box = target.getBoundingClientRect(), size = session.dimensions
    if (!size.width || !size.height || !box.width || !box.height) return
    const scale = Math.min(box.width / size.width, box.height / size.height)
    const x = (event.clientX - box.left - (box.width - size.width * scale) / 2) / scale
    const y = (event.clientY - box.top - (box.height - size.height * scale) / 2) / scale
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) return
    return { x: Math.floor(x), y: Math.floor(y) }
  }
  const pointer = (event: PointerEvent) => {
    if (!current()) return
    // 捕获期间在画面外松开仍需发送边沿，沿用最后有效坐标以免遗留按下状态。
    const p = point(event) ?? (event.type === 'pointerup' ? position : undefined)
    if (!p) return
    event.preventDefault(); position = p
    if (event.type === 'pointermove') { send({ kind: 'move', ...p }); return }
    const button = (['left', 'middle', 'right'] as const)[event.button]
    if (!button) return
    const down = event.type === 'pointerdown'
    if (down) { target.focus(); target.setPointerCapture(event.pointerId); buttons.add(button) } else { if (!buttons.delete(button)) return }
    send({ kind: 'button', button, down, ...p })
  }
  const release = () => {
    if (current()) { for (const code of keys) send({ kind: 'key', code, down: false }); for (const button of buttons) send({ kind: 'button', button, down: false, ...position }) }
    keys.clear(); buttons.clear()
  }
  const key = (event: KeyboardEvent) => {
    if (!current() || event.isComposing || event.code === 'Unidentified') return
    event.preventDefault()
    const down = event.type === 'keydown'
    if (down) keys.add(event.code); else keys.delete(event.code)
    send({ kind: 'key', code: event.code, down })
  }
  for (const name of ['pointerdown', 'pointerup', 'pointermove'] as const) target.addEventListener(name, pointer, { signal: abort.signal })
  for (const name of ['keydown', 'keyup'] as const) target.addEventListener(name, key, { signal: abort.signal })
  target.addEventListener('blur', release, { signal: abort.signal })
  target.addEventListener('pointercancel', release, { signal: abort.signal })
  target.addEventListener('lostpointercapture', release, { signal: abort.signal })
  target.addEventListener('contextmenu', event => event.preventDefault(), { signal: abort.signal })
  target.addEventListener('wheel', event => { const p = point(event); if (!current() || !p) return; event.preventDefault(); send({ kind: 'wheel', ...p, delta: Math.sign(event.deltaY || event.deltaX) * 120, horizontal: !event.deltaY }) }, { passive: false, signal: abort.signal })
  return () => { release(); abort.abort() }
}
