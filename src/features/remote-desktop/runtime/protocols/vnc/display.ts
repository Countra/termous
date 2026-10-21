import type RFB from '@novnc/novnc'
import { DesktopResolution, DesktopResizeUnconfirmedError, type DesktopResolutionState, type DesktopSize } from '../../core/desktopResolution.ts'

export class VncDisplay {
  private readonly resolution: DesktopResolution
  private readonly observer: ResizeObserver
  private readonly listeners = new AbortController()
  private active = true
  private disposed = false
  private pending?: { resolve(): void; reject(error: Error): void }
  private timer?: ReturnType<typeof setTimeout>

  constructor(private readonly rfb: RFB, private readonly target: HTMLElement,
    private readonly allowed: () => boolean, followWindow: boolean,
    changed: (state: DesktopResolutionState) => void) {
    // 显式尺寸统一由协调器调度，不与 noVNC 的自动跟随并行发送。
    rfb.resizeSession = false
    this.resolution = new DesktopResolution({ followWindow, changed,
      normalize: size => ({ width: Math.min(65535, Math.floor(size.width)), height: Math.min(65535, Math.floor(size.height)) }),
      send: size => this.send(size),
    })
    this.observer = new ResizeObserver(() => this.refresh())
    try {
      this.observer.observe(target)
      rfb.addEventListener('desktopframe', this.refresh)
      rfb.addEventListener('capabilities', this.refresh)
      rfb.addEventListener('desktopresize', this.result)
      document.addEventListener('visibilitychange', this.refresh, { signal: this.listeners.signal })
      this.refresh()
    } catch (error) { this.dispose(); throw error }
  }

  refresh = () => {
    if (this.disposed) return
    this.resolution.setAvailability(this.active && !document.hidden, this.allowed(), this.rfb.capabilities.resize === true)
    const state = this.rfb.desktopState
    if (state.sequence) this.resolution.updateSize({ width: state.width, height: state.height })
    this.resolution.updateViewport({ width: this.target.clientWidth, height: this.target.clientHeight })
  }

  setFollowWindow(value: boolean) { this.resolution.setFollowWindow(value) }
  setActive(value: boolean) { this.active = value; this.refresh() }

  dispose() {
    this.disposed = true
    this.resolution.dispose()
    this.listeners.abort()
    // noVNC 的 EventTargetMixin 不处理 AbortSignal，协议监听必须显式移除。
    this.rfb.removeEventListener('desktopframe', this.refresh)
    this.rfb.removeEventListener('capabilities', this.refresh)
    this.rfb.removeEventListener('desktopresize', this.result)
    this.observer.disconnect()
    this.reject()
  }

  private reject(error: Error = new DesktopResizeUnconfirmedError()) {
    clearTimeout(this.timer)
    const previous = this.pending
    this.pending = undefined
    previous?.reject(error)
  }

  private send(size: DesktopSize) {
    return new Promise<void>((resolve, reject) => {
      if (this.pending || this.disposed || !this.active || document.hidden || !this.allowed()) { reject(new Error('desktop_resize_unavailable')); return }
      this.pending = { resolve, reject }
      try {
        if (!this.rfb.requestDesktopSize(size.width, size.height)) { this.pending = undefined; resolve(); return }
        this.timer = setTimeout(() => this.reject(), 10_000)
      } catch (error) { this.reject(error instanceof Error ? error : new Error('desktop_resize_failed')) }
    })
  }

  private result = (event: Event) => {
    const pending = this.pending
    if (!pending) return
    clearTimeout(this.timer)
    this.pending = undefined
    if ((event as CustomEvent<{ success: boolean }>).detail.success) pending.resolve()
    else pending.reject(new Error('desktop_resize_rejected'))
  }
}
