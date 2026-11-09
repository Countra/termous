import { createHash, randomUUID } from 'node:crypto'
import { notificationTarget, notificationText, type NotificationActivation, type NotificationEvent, type NotificationMessage, type NotificationPreferences } from '#common/contracts'

export interface NativeNotification {
  show(): void
  close(): void
  on(event: 'click' | 'close' | 'failed', listener: () => void): unknown
  removeAllListeners(): unknown
}
interface Options {
  background(): boolean
  supported(): boolean
  preferences(): NotificationPreferences
  language(): string
  create(title: string, body: string, id: string): NativeNotification
  activate(): void
  warn(): void
  deliveryFailed?(): void
  now?: () => number
}

export class NotificationRuntime {
  private watermark: number | null = null
  private active = new Map<NativeNotification, NotificationMessage[]>()
  private deliveries = new Map<string, { native: NativeNotification; messages: NotificationMessage[] }>()
  private consumed = new Set<string>()
  private activations: NotificationActivation[] = []
  private files: NotificationMessage[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private options: Options
  constructor(options: Options) { this.options = options }

  accept(event: NotificationEvent) {
    if (this.closed) return
    const messages = event.type === 'snapshot' ? [...event.page.items].reverse() : [event.message]
    if (event.type === 'snapshot') {
      // 合并等待期间的已读和移除同样生效，不能继续提醒已处理的任务。
      const unread = new Set(event.page.items.filter((m) => !m.read).map((m) => m.id))
      this.files = this.files.filter((m) => unread.has(m.id))
      if (!this.files.length) this.clearPending()
      const visible = new Set(event.page.items.map((m) => m.id))
      for (const [native, delivered] of this.active) {
        if (delivered.some((m) => m.kind === 'approval' && !visible.has(m.id))) this.release(native)
      }
      for (const [id, delivery] of this.deliveries) {
        if (delivery.messages.some(m => m.kind === 'approval' && !visible.has(m.id))) this.deliveries.delete(id)
      }
    }
    if (this.watermark === null) {
      // 首次连接只建立历史水位，Renderer 重载不影响主进程投递记录。
      if (event.type === 'snapshot') this.watermark = event.page.watermark
      return
    }
    if (event.type === 'snapshot' && event.page.watermark < this.watermark) {
      this.watermark = event.page.watermark
      this.clearPending()
      for (const native of this.active.keys()) this.release(native)
      this.deliveries.clear()
      this.activations = []
      this.consumed.clear()
      return
    }
    for (const message of messages) {
      if (message.sequence <= this.watermark) continue
      this.watermark = message.sequence
      const age = (this.options.now?.() ?? Date.now()) - Date.parse(message.occurred_at)
      if (age > 120_000 && !(message.remote && message.kind === 'approval') || age < -60_000 || message.read || !message.native_eligible || !this.allowed(message)) continue
      if (message.kind === 'file') {
        this.files.push(message)
        if (this.files.length > 1000) this.files.shift()
        this.timer ??= setTimeout(() => { this.timer = null; const batch = this.files; this.files = []; this.deliver(batch) }, 2000)
      } else this.deliver([message])
    }
    if (event.type === 'snapshot') this.watermark = Math.max(this.watermark, event.page.watermark)
  }

  private allowed(message: NotificationMessage) {
    const preferences = this.options.preferences()
    const expired = message.expires_at && Date.parse(message.expires_at) <= (this.options.now?.() ?? Date.now())
    return !expired && preferences.enabled && preferences[message.kind] && this.options.background() && this.options.supported()
  }
  private deliver(messages: NotificationMessage[]) {
    if (this.closed || !messages.length || !this.allowed(messages[0])) return
    const language = this.options.language()
    const text = notificationText(messages[0], language)
    if (messages.length > 1) {
      const failed = messages.filter((m) => m.outcome !== 'success').length
      const zh = language.startsWith('zh')
      const subjects = messages.slice(0, 2).map((message) => notificationText(message, language).subject).join(zh ? '、' : ', ')
      const more = messages.length > 2 ? (zh ? ` 等 ${messages.length} 项任务` : ` and ${messages.length - 2} more`) : ''
      text.title = zh ? `${messages.length} 项文件传输已结束` : `${messages.length} file transfers finished`
      text.body = zh ? `${messages.length - failed} 项完成 · ${failed} 项需要关注\n${subjects}${more}` : `${messages.length - failed} completed · ${failed} need attention\n${subjects}${more}`
    }
    try {
      while (this.active.size >= 3) this.release(this.active.keys().next().value!)
      // 同一消息后续修订必须有独立激活标识，不能被上一次点击的去重记录吞掉。
      const id = createHash('sha256').update(JSON.stringify(messages.map(m => [m.id, m.sequence]))).digest('hex').slice(0, 16)
      const native = this.options.create(text.title, text.body, id)
      this.deliveries.set(id, { native, messages })
      if (this.deliveries.size > 64) this.deliveries.delete(this.deliveries.keys().next().value!)
      this.active.set(native, messages)
      native.on('click', () => this.activateNative(id))
      native.on('close', () => this.release(native))
      native.on('failed', () => { (this.options.deliveryFailed ?? this.options.warn)(); this.release(native) })
      try { native.show() } catch { this.release(native); (this.options.deliveryFailed ?? this.options.warn)() }
    } catch { (this.options.deliveryFailed ?? this.options.warn)() }
  }
  activateNative(id: string) {
    if (this.closed) return
    if (!id || id.length > 128) { this.options.activate(); return }
    if (this.consumed.has(id)) return
    this.consumed.add(id)
    if (this.consumed.size > 128) this.consumed.delete(this.consumed.values().next().value!)
    const delivered = this.deliveries.get(id)
    this.deliveries.delete(id)
    if (delivered) {
      const { native, messages } = delivered
      const now = this.options.now?.() ?? Date.now()
      if (!messages.some(message => message.expires_at && Date.parse(message.expires_at) <= now)) {
        this.activations.push({ id: randomUUID(), target: messages.length === 1 ? notificationTarget(messages[0]) : { kind: 'centre', filter: 'file' }, messages })
        if (this.activations.length > 16) this.activations.shift()
      }
      this.release(native)
    }
    // 冷启动或映射已失效时只唤起窗口，不从通知参数构造业务操作。
    this.options.activate()
  }
  private release(native: NativeNotification) {
    if (!this.active.delete(native)) return
    native.removeAllListeners()
    try { native.close() } catch { this.options.warn() }
  }
  pending() { return structuredClone(this.activations) }
  acknowledge(id: unknown) {
    if (typeof id !== 'string' || id.length > 128) throw new Error('NOTIFICATION_ACTIVATION_INVALID')
    this.activations = this.activations.filter((intent) => intent.id !== id)
  }
  private clearPending() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.files = []
  }
  close() {
    this.closed = true
    this.clearPending()
    for (const native of this.active.keys()) this.release(native)
    this.activations = []
    this.deliveries.clear()
    this.consumed.clear()
  }
}
