import { i18n } from '#shared/i18n'
import type { AutomationPointerFeed } from './automationPointerState.ts'
import { projectDesktopPointer, type DesktopViewportGeometry } from './automationPointerGeometry.ts'
import styles from './automationPointerOverlay.module.scss'

interface Options {
  target: HTMLElement
  feed?: AutomationPointerFeed
  geometry(): DesktopViewportGeometry | null
  visible(): boolean
}

// 接管决定展示生命周期，回执决定真实位置；覆盖层不派发输入，也不进入像素画布。
export function createAutomationPointerOverlay(options: Options) {
  if (!options.feed) return { dispose() {}, refresh() {} }
  const root = document.createElement('span')
  root.className = styles.overlay
  root.setAttribute('aria-hidden', 'true')
  root.dataset.automationPointer = ''
  root.hidden = true
  const marker = document.createElement('span')
  marker.className = styles.marker
  // 与移动端共用视觉规格：圆润橙色、白描边及左上 (2, 2) 热点，不改变回执坐标。
  marker.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30" fill="none"><path d="M2 2C2.7 1.7 3.4 2 4.2 2.6L22 18.3C23.4 19.5 22.8 21.4 21 21.5L13.4 21.7C12.2 21.7 11.3 22.1 10.4 22.9L5.3 27C3.8 28.2 1.7 27.3 1.7 25.3L1.5 4.4C1.5 3.2 1.6 2.4 2 2Z" fill="currentColor" stroke="white" stroke-width="1.9" stroke-linejoin="round"/></svg>'
  const label = document.createElement('span')
  label.className = styles.label
  const dot = document.createElement('span')
  dot.className = styles.dot
  const source = document.createElement('span')
  const status = document.createElement('span')
  status.className = styles.status
  label.append(dot, source, status)
  const ring = document.createElement('span')
  ring.className = styles.ring
  ring.dataset.pointerEffect = 'click'
  const scroll = document.createElement('span')
  scroll.className = styles.scroll
  marker.append(ring, label, scroll)
  root.append(marker)
  options.target.append(root)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let disposed = false
  let frame = 0
  let wake: ReturnType<typeof setTimeout> | undefined
  const initial = options.feed.snapshot()?.event.pointer
  let lastInput = initial ? `${initial.automation_id}:${initial.execution_generation}:${initial.sequence}` : ''
  let effectUntil = 0

  function refresh() {
    clearTimeout(wake)
    if (!disposed && !frame) frame = requestAnimationFrame(draw)
  }
  function draw() {
    frame = 0
    if (disposed) return
    const sample = options.feed!.snapshot()
    const pointer = sample?.event.pointer
    const control = options.feed!.control()
    const now = Date.now()
    const age = pointer ? now - Date.parse(pointer.occurred_at) : Infinity
    // 旧 Core 没有接管投影时保留原来的短暂反馈，不把历史坐标误当作持续授权。
    const usable = pointer && age >= -1000 && (control || age < 3000)
    if ((!control && !usable) || document.hidden || !options.target.isConnected || !options.visible()
      || options.target.clientWidth <= 0 || options.target.clientHeight <= 0) { root.hidden = true; return }
    let geometry: DesktopViewportGeometry | null
    try { geometry = options.geometry() } catch { geometry = null }
    const position = usable && geometry && projectDesktopPointer(pointer.x, pointer.y, pointer.display_epoch, geometry)
    const bounds = options.target.getBoundingClientRect()
    const x = position ? position.x - bounds.left - options.target.clientLeft : -1
    const y = position ? position.y - bounds.top - options.target.clientTop : -1
    const tracking = !!position && x >= 0 && y >= 0 && x < options.target.clientWidth && y < options.target.clientHeight
    if (!tracking && !control) { root.hidden = true; return }

    // 续期也会推进事件版本，动作动画只跟随新的输入序号，不能被续期重播。
    const input = pointer ? `${pointer.automation_id}:${pointer.execution_generation}:${pointer.sequence}` : ''
    if (input !== lastInput) {
      lastInput = input
      effectUntil = tracking && sample?.live && age >= 0 && age < 250 && ['click', 'wheel'].includes(pointer!.action)
        ? Date.parse(pointer!.occurred_at) + 250 : 0
    }
    if (!tracking) effectUntil = 0
    root.hidden = false
    root.dataset.mode = tracking ? 'tracking' : 'standby'
    root.dataset.idle = String(tracking && age >= 3000 && !pointer?.buttons)
    root.style.transform = `translate(${options.target.scrollLeft}px, ${options.target.scrollTop}px)`
    root.style.width = `${options.target.clientWidth}px`
    root.style.height = `${options.target.clientHeight}px`
    marker.style.transform = tracking ? `translate(${x}px, ${y}px)` : ''
    marker.dataset.pressed = String(tracking && pointer!.buttons !== 0)
    source.textContent = { agent: 'AI', mcp: 'MCP', workflow: 'Workflow', automation: 'Auto' }[control?.source ?? pointer!.source]
    status.textContent = tracking ? '' : i18n.t('remoteDesktop.automation.pointerStandby')
    label.dataset.flip = String(tracking && x > options.target.clientWidth - 110)
    label.dataset.above = String(tracking && y > options.target.clientHeight - 52)
    const effect = Math.max(0, (effectUntil - now) / 250)
    ring.style.opacity = String(pointer?.action === 'click' ? effect : 0)
    ring.style.transform = `translate(-50%, -50%) scale(${reducedMotion.matches ? 1 : 0.8 + (1 - effect) * 0.9})`
    scroll.textContent = effect && pointer?.action === 'wheel' ? { up: '↑', down: '↓', left: '←', right: '→' }[pointer.scroll ?? 'down'] : ''

    // 静止状态不逐帧轮询；仅动画期间使用 rAF，续期、几何变化和过期唤醒绘制。
    if (effect > 0) refresh()
    else {
      const expiry = control ? Date.parse(control.expires_at) - now : 3000 - age
      const idle = tracking && age < 3000 ? 3000 - age : Infinity
      wake = setTimeout(refresh, Math.max(1, Math.min(expiry, idle, 2_147_483_647)))
    }
  }
  const unsubscribe = options.feed.subscribe(refresh)
  const observer = new ResizeObserver(refresh)
  observer.observe(options.target)
  document.addEventListener('visibilitychange', refresh)
  document.addEventListener('scroll', refresh, true)
  window.addEventListener('resize', refresh)
  reducedMotion.addEventListener('change', refresh)
  i18n.on('languageChanged', refresh)
  refresh()
  return {
    refresh,
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      clearTimeout(wake)
      unsubscribe()
      observer.disconnect()
      document.removeEventListener('visibilitychange', refresh)
      document.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
      reducedMotion.removeEventListener('change', refresh)
      i18n.off('languageChanged', refresh)
      root.remove()
    },
  }
}
