import { i18n } from '#shared/i18n'
import type { AutomationPointerFeed } from './automationPointerState.ts'
import { projectDesktopPointer, type DesktopViewportGeometry } from './automationPointerGeometry.ts'
import { AutomationPointerMotion } from './automationPointerMotion.ts'
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
  const motion = new AutomationPointerMotion()
  let projection = ''
  let effectAt: number | undefined

  function resetMotion() {
    motion.reset()
    projection = ''
    effectAt = undefined
  }

  function pause() {
    const pointer = options.feed!.snapshot()?.event.pointer
    lastInput = pointer ? `${pointer.automation_id}:${pointer.execution_generation}:${pointer.sequence}` : ''
    cancelAnimationFrame(frame)
    frame = 0
    clearTimeout(wake)
    resetMotion()
    root.hidden = true
  }

  function refresh() {
    if (disposed) return
    clearTimeout(wake)
    // 暂停必须同步清理，避免同一帧内隐藏再恢复时旧轨迹仍然生效。
    if (document.hidden || !options.target.isConnected || !options.visible()
      || (!options.feed!.snapshot()?.event.pointer && !options.feed!.control())) { pause(); return }
    if (!frame) frame = requestAnimationFrame(draw)
  }
  function draw() {
    frame = 0
    if (disposed) return
    const sample = options.feed!.snapshot()
    const pointer = sample?.event.pointer
    const control = options.feed!.control()
    const now = Date.now()
    const clock = performance.now()
    const age = pointer ? now - Date.parse(pointer.occurred_at) : Infinity
    const input = pointer ? `${pointer.automation_id}:${pointer.execution_generation}:${pointer.sequence}` : ''
    // 旧 Core 没有接管投影时保留原来的短暂反馈，不把历史坐标误当作持续授权。
    const usable = pointer && age >= -1000 && (control || age < 3000)
    if ((!control && !usable) || document.hidden || !options.target.isConnected || !options.visible()
      || options.target.clientWidth <= 0 || options.target.clientHeight <= 0) {
      pause()
      return
    }
    let geometry: DesktopViewportGeometry | null
    try { geometry = options.geometry() } catch { geometry = null }
    const position = usable && geometry && projectDesktopPointer(pointer.x, pointer.y, pointer.display_epoch, geometry)
    const bounds = options.target.getBoundingClientRect()
    const x = position ? position.x - bounds.left - options.target.clientLeft : -1
    const y = position ? position.y - bounds.top - options.target.clientTop : -1
    const tracking = !!position && x >= 0 && y >= 0 && x < options.target.clientWidth && y < options.target.clientHeight
    if (!tracking && !control) { pause(); return }

    // 续期也会推进事件版本，动作动画只跟随新的输入序号，不能被续期重播。
    const changed = input !== lastInput
    const fresh = sample?.live && age >= 0 && age < 250
    if (tracking && geometry) {
      // 投影或接管代次变化必须直接对齐，不把缩放、裁剪和换代误画成远端鼠标移动。
      const nextProjection = JSON.stringify([pointer!.automation_id, pointer!.execution_generation, geometry.displayEpoch,
        geometry.left - bounds.left - options.target.clientLeft, geometry.top - bounds.top - options.target.clientTop,
        geometry.width, geometry.height, geometry.remoteX, geometry.remoteY, geometry.remoteWidth, geometry.remoteHeight,
        options.target.clientWidth, options.target.clientHeight])
      const reprojected = projection !== nextProjection
      const instant = reprojected || reducedMotion.matches || !sample?.live || (changed && !fresh) || pointer!.action === 'button'
      if (changed || instant) motion.moveTo({ x, y }, clock, instant ? 'instant' : pointer!.buttons ? 'responsive' : 'smooth')
      projection = nextProjection
      if (reprojected || !sample?.live) effectAt = undefined
    } else resetMotion()
    const displayed = motion.sample(clock)
    if (changed) {
      // 点击反馈只在最新落点到位后出现；后续输入会替换它，不排队补播旧操作。
      effectAt = tracking && fresh && ['click', 'wheel'].includes(pointer!.action)
        ? clock + (displayed?.remaining ?? 0) : undefined
    }
    if (reducedMotion.matches && effectAt !== undefined && effectAt > clock) effectAt = clock
    lastInput = input
    root.hidden = false
    root.dataset.mode = tracking ? 'tracking' : 'standby'
    root.dataset.idle = String(tracking && age >= 3000 && !pointer?.buttons)
    root.style.transform = `translate(${options.target.scrollLeft}px, ${options.target.scrollTop}px)`
    root.style.width = `${options.target.clientWidth}px`
    root.style.height = `${options.target.clientHeight}px`
    marker.style.transform = tracking && displayed ? `translate(${displayed.x}px, ${displayed.y}px)` : ''
    marker.dataset.pressed = String(tracking && pointer!.buttons !== 0)
    source.textContent = { agent: 'AI', mcp: 'MCP', workflow: 'Workflow', automation: 'Auto' }[control?.source ?? pointer!.source]
    status.textContent = tracking ? '' : i18n.t('remoteDesktop.automation.pointerStandby')
    label.dataset.flip = String(tracking && displayed!.x > options.target.clientWidth - 110)
    label.dataset.above = String(tracking && displayed!.y > options.target.clientHeight - 52)
    const effect = effectAt !== undefined && clock >= effectAt ? Math.max(0, 1 - (clock - effectAt) / 250) : 0
    ring.style.opacity = String(pointer?.action === 'click' ? effect : 0)
    ring.style.transform = `translate(-50%, -50%) scale(${reducedMotion.matches ? 1 : 0.8 + (1 - effect) * 0.9})`
    scroll.textContent = effect && pointer?.action === 'wheel' ? { up: '↑', down: '↓', left: '←', right: '→' }[pointer.scroll ?? 'down'] : ''

    // 静止状态不逐帧轮询；仅动画期间使用 rAF，续期、几何变化和过期唤醒绘制。
    if (displayed?.remaining || effect > 0) refresh()
    else {
      const expiry = control ? Date.parse(control.expires_at) - now : 3000 - age
      const idle = tracking && age < 3000 ? 3000 - age : Infinity
      wake = setTimeout(refresh, Math.max(1, Math.min(expiry, idle, 2_147_483_647)))
    }
  }
  function visibilityChanged() {
    // 后台的 rAF 可能被浏览器暂停；恢复时只对齐最新位置，不重播期间积累的动作。
    pause()
    refresh()
  }
  const unsubscribe = options.feed.subscribe(refresh)
  const observer = new ResizeObserver(refresh)
  observer.observe(options.target)
  document.addEventListener('visibilitychange', visibilityChanged)
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
      resetMotion()
      unsubscribe()
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibilityChanged)
      document.removeEventListener('scroll', refresh, true)
      window.removeEventListener('resize', refresh)
      reducedMotion.removeEventListener('change', refresh)
      i18n.off('languageChanged', refresh)
      root.remove()
    },
  }
}
