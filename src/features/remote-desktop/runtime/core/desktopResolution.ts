export type DesktopScaleMode = 'fit' | 'actual'
export interface DesktopSize { width: number; height: number }
export interface DesktopResolutionState {
  size?: DesktopSize
  fixed?: DesktopSize
  supported: boolean
  status: 'idle' | 'waiting' | 'pending' | 'unsupported' | 'failed' | 'timeout'
}

// 没有最终回执时，旧请求仍可能生效，不能按明确拒绝处理。
export class DesktopResizeUnconfirmedError extends Error {
  constructor() { super('desktop_resize_unconfirmed') }
}

const same = (a?: DesktopSize, b?: DesktopSize) => !!a && !!b && a.width === b.width && a.height === b.height
const valid = (size: DesktopSize) => Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0

// 只协调分辨率意图；本地缩放、输入权限与协议回执仍由各自的适配器负责。
export class DesktopResolution {
  private size?: DesktopSize
  private fixed?: DesktopSize
  private viewport?: DesktopSize
  private following: boolean
  private restoring = false
  private active = true
  private allowed = false
  private supported = false
  private disposed = false
  private debounce?: ReturnType<typeof setTimeout>
  private deadline?: ReturnType<typeof setTimeout>
  private pending?: { size: DesktopSize; accepted: boolean }
  private unconfirmed?: DesktopSize
  private failure?: 'failed' | 'timeout'
  private published = ''

  constructor(private readonly options: {
    followWindow: boolean
    normalize(size: DesktopSize): DesktopSize | undefined
    send(size: DesktopSize): Promise<void>
    changed(state: DesktopResolutionState): void
  }) { this.following = options.followWindow }

  setFollowWindow(value: boolean) {
    if (this.disposed) return
    // 尚未完成恢复时保留进入跟随前的基准，快速切换不能把中间尺寸当作固定尺寸。
    if (value && !this.following && !this.restoring && !this.pending && !this.unconfirmed) this.fixed = this.size
    if (!value && this.following) this.restoring = true
    this.following = value
    this.failure = undefined
    this.reconcile()
  }

  updateSize(size: DesktopSize) {
    if (this.disposed || !valid(size)) return
    this.size = { ...size }
    if (same(this.unconfirmed, size)) { this.unconfirmed = undefined; this.failure = undefined }
    if (!this.fixed || (!this.following && !this.restoring && !this.pending && !this.unconfirmed)) this.fixed = this.size
    this.complete()
    this.reconcile()
  }

  updateViewport(size: DesktopSize) {
    if (this.disposed) return
    const next = valid(size) ? this.options.normalize(size) : undefined
    if (same(this.viewport, next) || (!this.viewport && !next)) return
    this.viewport = next
    // 固定尺寸恢复失败后，窗口布局变化不代表用户要求重试。
    if (this.following) {
      this.failure = undefined
      clearTimeout(this.debounce)
      this.debounce = undefined
    }
    this.reconcile()
  }

  setAvailability(active: boolean, allowed: boolean, supported: boolean) {
    this.active = active
    this.allowed = allowed
    this.supported = supported
    this.reconcile()
  }

  dispose() {
    this.disposed = true
    clearTimeout(this.debounce)
    clearTimeout(this.deadline)
    this.pending = undefined
  }

  private target() { return this.following ? this.viewport : this.restoring ? this.fixed : undefined }

  private complete() {
    if (this.pending && this.pending.accepted && same(this.pending.size, this.size)) {
      this.pending = undefined
      this.unconfirmed = undefined
      clearTimeout(this.deadline)
    }
    if (!this.pending && !this.unconfirmed && same(this.target(), this.size)) {
      this.failure = undefined
      if (!this.following) this.restoring = false
    }
  }

  private reconcile() {
    if (this.disposed) return
    this.complete()
    const target = this.target()
    const eligible = this.active && this.allowed && this.supported && !!this.size && !!target
    if (!eligible || this.pending || this.failure || (same(target, this.size) && !this.unconfirmed)) {
      clearTimeout(this.debounce)
      this.debounce = undefined
    } else if (this.debounce === undefined) {
      // 同一目标的画面帧和续租消息不会重置防抖，窗口真正变化时才重新计时。
      this.debounce = setTimeout(() => {
        this.debounce = undefined
        const latest = this.target()
        if (!this.disposed && this.active && this.allowed && this.supported && latest && !this.pending && !this.failure && (!same(latest, this.size) || this.unconfirmed)) this.send(latest)
      }, 300)
    }
    this.publish()
  }

  private send(size: DesktopSize) {
    const request = { size: { ...size }, accepted: false }
    this.pending = request
    this.deadline = setTimeout(() => {
      if (this.disposed || this.pending !== request) return
      this.pending = undefined
      // 超时仍可能迟到生效，不能把旧画面当作已恢复，也不能重写原固定尺寸。
      this.unconfirmed = request.size
      this.failure = 'timeout'
      this.reconcile()
    }, 10_000)
    this.publish()
    // 命令回执表示协议已接收，实际尺寸必须由后续完整画面确认。
    void Promise.resolve().then(() => {
      if (this.disposed || this.pending !== request) return
      if (!this.active || !this.allowed || !this.supported) {
        // 尚未交给协议层，不属于失败或结果不明；恢复条件后继续协调当前目标。
        clearTimeout(this.deadline)
        this.pending = undefined
        this.reconcile()
        return
      }
      return this.options.send(request.size)
    }).then(() => {
      if (this.disposed || this.pending !== request) return
      request.accepted = true
      this.reconcile()
    }, (error: unknown) => {
      if (this.disposed || this.pending !== request) return
      clearTimeout(this.deadline)
      this.pending = undefined
      this.failure = error instanceof DesktopResizeUnconfirmedError ? 'timeout' : 'failed'
      if (error instanceof DesktopResizeUnconfirmedError) this.unconfirmed = request.size
      this.reconcile()
    })
  }

  private publish() {
    const target = this.target()
    const needed = !!target && !same(target, this.size)
    const status: DesktopResolutionState['status'] = this.failure ?? (this.pending ? 'pending' : this.unconfirmed ? 'timeout'
      : needed ? !this.supported ? 'unsupported' : !this.active || !this.allowed ? 'waiting' : 'pending' : 'idle')
    const state = { size: this.size, fixed: this.fixed, supported: this.supported, status }
    const serialized = JSON.stringify(state)
    if (serialized !== this.published) {
      this.published = serialized
      this.options.changed(state)
    }
  }
}
