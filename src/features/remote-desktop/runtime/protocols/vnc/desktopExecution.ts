import type RFB from '@novnc/novnc'
import type { DesktopControl, DesktopInput, DesktopScreenshotRequest, DesktopSnapshotMetadata, DesktopState } from '#entities/remote-desktop'
import { desktopKeysym } from './desktopKeys.ts'

export class VncDesktopExecution {
  private control: DesktopControl | null = null
  private sequence = 0
  private buttons = 0
  private position = { x: 0, y: 0 }
  private readonly keys = new Map<string, number>()
  private expiry: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly rfb: RFB, private readonly generation: number, private readonly changed: (owned: boolean) => void) {
    rfb.localInputEnabled = false
  }

  describe(): DesktopState {
    const state = this.rfb.desktopState
    return { available: state.width > 0, connection_generation: this.generation, display_epoch: state.displayEpoch, frame_sequence: state.sequence,
      width: state.width, height: state.height, capabilities: { screenshot: true, pointer: true, keyboard: true, text: true }, ...(this.control ? { control: this.control } : {}) }
  }

  watchState(changed: (state: DesktopState) => void) {
    let epoch = -1
    const update = () => { const state = this.describe(); if (state.display_epoch !== epoch) { epoch = state.display_epoch; changed(state) } }
    this.rfb.addEventListener('desktopframe', update)
    return () => this.rfb.removeEventListener('desktopframe', update)
  }

  setControl(control: DesktopControl | null, renew = false) {
    if (renew && (!control || !this.control || control.id !== this.control.id || control.generation !== this.control.generation)) throw new Error('desktop_control_stale')
    if (control?.owner && (!Number.isFinite(Date.parse(control.expires_at)) || Date.parse(control.expires_at) <= Date.now())) throw new Error('desktop_control_stale')
    clearTimeout(this.expiry)
    if (!renew) {
      try {
        this.rfb.localInputEnabled = false
        this.resetPressed()
      } finally {
        // 清理失败也必须撤销旧授权；由桥接错误路径关闭失效连接。
        this.control = null
        this.sequence = 0
        this.rfb.viewOnly = true
        this.changed(false)
      }
    }
    this.control = control?.owner ? control : null
    this.rfb.viewOnly = !this.control
    this.rfb.localInputEnabled = this.control?.owner === 'local-viewer'
    this.changed(this.control?.owner === 'local-viewer')
    if (this.control) this.expiry = setTimeout(() => this.setControl(null), Math.max(0, Date.parse(this.control.expires_at) - Date.now()))
  }

  execute(input: DesktopInput) {
    const lease = this.control
    if (!lease || Date.parse(lease.expires_at) <= Date.now() || lease.id !== input.lease_id || lease.generation !== input.control_generation || input.expected_connection_generation !== this.generation || input.sequence !== this.sequence + 1) throw new Error('desktop_control_stale')
    const op = input.operation
    const pointer = ['move', 'button', 'click', 'wheel'].includes(op.kind)
    const state = this.rfb.desktopState
    if (pointer && input.display_epoch !== state.displayEpoch) throw new Error('desktop_display_stale')
    const x = op.x ?? 0, y = op.y ?? 0
    if (pointer && (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.width || y >= state.height)) throw new Error('desktop_invalid_request')
    const codes = op.kind === 'shortcut' ? op.codes ?? [] : op.kind === 'key' ? [op.code ?? ''] : []
    const keysyms = codes.map(desktopKeysym)
    this.sequence = input.sequence
    if (pointer) this.position = { x, y }
    const key = (index: number, down: boolean) => {
      if (down) this.keys.set(codes[index], keysyms[index])
      this.rfb.sendKey(keysyms[index], codes[index], down)
      if (!down) this.keys.delete(codes[index])
    }
    try { switch (op.kind) {
      case 'move': this.rfb.sendPointer(x, y, this.buttons); break
      case 'button': case 'click': {
        const mask = { left: 1, middle: 2, right: 4 }[op.button ?? 'left']
        if (op.kind === 'click') {
          const previous = this.buttons
          this.buttons |= mask
          this.rfb.sendPointer(x, y, this.buttons)
          this.rfb.sendPointer(x, y, previous)
          this.buttons = previous
        }
        else {
          const next = op.down ? this.buttons | mask : this.buttons & ~mask
          if (op.down) this.buttons = next
          this.rfb.sendPointer(x, y, next)
          this.buttons = next
        }
        break
      }
      case 'wheel': {
        const delta = op.delta ?? 0
        const mask = op.horizontal ? delta > 0 ? 64 : 32 : delta > 0 ? 16 : 8
        for (let i = 0; i < Math.ceil(Math.abs(delta) / 120); i++) { this.rfb.sendPointer(x, y, this.buttons | mask); this.rfb.sendPointer(x, y, this.buttons) }
        break
      }
      case 'key': key(0, op.down === true); break
      case 'shortcut': codes.forEach((_, i) => key(i, true)); for (let i = codes.length - 1; i >= 0; i--) key(i, false); break
      case 'text':
        for (const char of (op.text ?? '').replace(/\r\n/g, '\n')) {
          const point = char.codePointAt(0)!
          this.rfb.sendKey(char === '\n' || char === '\r' ? 0xff0d : char === '\t' ? 0xff09 : point <= 255 ? point : 0x01000000 | point)
        }
        break
      default: throw new Error('desktop_invalid_request')
    } } catch {
      // 组合操作可能部分送达；先释放按键并撤销授权，不能把异常解释为未执行。
      try { this.setControl(null) } catch {
        // RFB 已断开时清理报文也可能失败；撤销本地授权，由 Core 关闭失效桥接。
        this.control = null
        this.changed(false)
      }
      throw new Error('desktop_input_uncertain')
    }
  }

  async capture(request: DesktopScreenshotRequest, signal: AbortSignal): Promise<{ metadata: DesktopSnapshotMetadata; png: Blob }> {
    if (!request.after_sequence && !this.rfb.desktopState.sequence) throw new Error('desktop_not_ready')
    if (request.display_epoch && request.display_epoch !== this.rfb.desktopState.displayEpoch) throw new Error('desktop_display_stale')
    const frame = await this.rfb.captureDesktop(request.after_sequence, signal)
    if (request.display_epoch && request.display_epoch !== frame.displayEpoch) throw new Error('desktop_display_stale')
    const region = request.region ?? { x: 0, y: 0, width: frame.width, height: frame.height }
    if (![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > frame.width || region.y + region.height > frame.height) throw new Error('desktop_invalid_request')
    let width = region.width, height = region.height
    if (request.max_width > 0 && width > request.max_width) { height = Math.max(1, Math.floor(height * request.max_width / width)); width = request.max_width }
    if (request.max_height > 0 && height > request.max_height) { width = Math.max(1, Math.floor(width * request.max_height / height)); height = request.max_height }
    const source = document.createElement('canvas'), target = document.createElement('canvas')
    source.width = frame.width; source.height = frame.height; target.width = width; target.height = height
    try {
      const sourceContext = source.getContext('2d'), targetContext = target.getContext('2d')
      if (!sourceContext || !targetContext) throw new Error('desktop_executor_unavailable')
      sourceContext.putImageData(frame.image, 0, 0)
      targetContext.imageSmoothingEnabled = false
      targetContext.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, width, height)
      const png = await new Promise<Blob>((resolve, reject) => target.toBlob((blob) => blob ? resolve(blob) : reject(new Error('desktop_executor_unavailable')), 'image/png'))
      signal.throwIfAborted()
      if (png.size > 32 * 1024 * 1024) throw new Error('desktop_screenshot_limit')
      return { png, metadata: { connection_generation: this.generation, display_epoch: frame.displayEpoch, frame_sequence: frame.sequence, desktop_width: frame.width, desktop_height: frame.height, region, width, height, captured_at: new Date(frame.capturedAt).toISOString() } }
    } finally { source.width = 0; source.height = 0; target.width = 0; target.height = 0 }
  }

  dispose() { clearTimeout(this.expiry); this.setControl(null) }

  private resetPressed() {
    for (const [code, symbol] of this.keys) this.rfb.sendKey(symbol, code, false)
    this.keys.clear()
    if (this.buttons) {
      const { width, height } = this.rfb.desktopState
      // 释放状态使用当前桌面内坐标；公共坐标操作仍严格拒绝过期尺寸。
      this.rfb.sendPointer(Math.min(this.position.x, width - 1), Math.min(this.position.y, height - 1), 0)
    }
    this.buttons = 0
  }
}
