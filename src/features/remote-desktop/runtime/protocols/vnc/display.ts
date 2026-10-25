import type RFB from '@novnc/novnc'
import { resizeVnc } from '@termous/remote-protocol/vnc'
import { DesktopResolution, DesktopResizeUnconfirmedError, type DesktopResolutionState, type DesktopSize } from '../../core/desktopResolution.ts'

export class VncDisplay {
  private readonly resolution: DesktopResolution
  private readonly observer: ResizeObserver
  private readonly listeners = new AbortController()
  private active = true
  private disposed = false

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

  resizeDesktop(width: number, height: number) { this.resolution.request({ width, height }) }
  setFollowWindow(value: boolean) { this.resolution.setFollowWindow(value) }
  setActive(value: boolean) { this.active = value; this.refresh() }

  dispose() {
    this.disposed = true
    this.resolution.dispose()
    this.listeners.abort()
    // noVNC 的 EventTargetMixin 不处理 AbortSignal，协议监听必须显式移除。
    this.rfb.removeEventListener('desktopframe', this.refresh)
    this.rfb.removeEventListener('capabilities', this.refresh)
    this.observer.disconnect()
  }

  private async send(size: DesktopSize) {
    if (this.disposed || !this.active || document.hidden || !this.allowed()) throw new Error('desktop_resize_unavailable')
    try { await resizeVnc(this.rfb, size.width, size.height, this.listeners.signal) }
    catch (error) {
      if (error instanceof Error && error.message === 'desktop_resize_unconfirmed') throw new DesktopResizeUnconfirmedError()
      throw error
    }
  }
}
