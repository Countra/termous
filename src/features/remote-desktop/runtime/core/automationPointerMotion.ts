interface Point { x: number; y: number }
type MotionMode = 'smooth' | 'responsive' | 'instant'

// 只插值展示坐标，不产生远端输入；调用方提供单调时钟，避免系统时间调整影响动画。
export class AutomationPointerMotion {
  private origin: Point | null = null
  private target: Point | null = null
  private displayed: Point | null = null
  private sampledAt = 0
  private startedAt = 0
  private duration = 0

  moveTo(target: Point, now: number, mode: MotionMode) {
    const current = this.displayed
    if (!current || mode === 'instant') {
      this.origin = this.target = this.displayed = { ...target }
      this.sampledAt = now
      this.startedAt = now
      this.duration = 0
      return
    }
    // 续期、重复落点与逐帧刷新不能重置进度，否则连续回执会使指针永远到不了终点。
    if (this.target?.x === target.x && this.target.y === target.y) return
    const distance = Math.hypot(target.x - current.x, target.y - current.y)
    const continuing = now < this.startedAt + this.duration || (this.duration > 0 && now - this.startedAt < 120)
    const following = mode === 'responsive' || continuing
    // 从上一帧实际绘制的位置改向，避免在新回执的首帧继续外推旧轨迹而产生跳跃。
    this.origin = { x: current.x, y: current.y }
    this.target = { ...target }
    this.duration = distance < 1 ? 0 : following ? 60 : Math.min(180, Math.max(80, 60 + distance * 0.25))
    // 连续目标要计入上一帧至今的时间，否则每帧重定向都会从零进度开始而停滞。
    this.startedAt = continuing ? Math.max(this.sampledAt, now - this.duration) : now
  }

  sample(now: number) {
    if (!this.target || !this.origin) return null
    this.sampledAt = now
    const remaining = Math.max(0, this.startedAt + this.duration - now)
    if (!remaining || !this.duration) {
      this.displayed = { ...this.target }
      return { ...this.displayed, remaining: 0 }
    }
    const progress = Math.max(0, Math.min(1, (now - this.startedAt) / this.duration))
    const eased = 1 - (1 - progress) ** 3
    this.displayed = { x: this.origin.x + (this.target.x - this.origin.x) * eased,
      y: this.origin.y + (this.target.y - this.origin.y) * eased }
    return { ...this.displayed, remaining }
  }

  reset() {
    this.origin = this.target = this.displayed = null
    this.duration = 0
  }
}
