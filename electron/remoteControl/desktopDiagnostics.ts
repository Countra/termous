import { desktopDiagnosticLevel, sanitizeDesktopDiagnostic } from '@termous/remote-protocol/desktop-diagnostics'

// 每个远控窗口独立限量，终态另留额度，避免状态抖动淹没真正的失败。
export class DesktopDiagnosticLog {
  private windowStarted = 0
  private progress = 0
  private terminal = 0

  accept(input: unknown, debug = false, now = performance.now()) {
    const value = sanitizeDesktopDiagnostic(input)
    if (!value) return
    if (!debug && desktopDiagnosticLevel(value.event) === 'debug') return
    if (now - this.windowStarted >= 60_000) {
      this.windowStarted = now; this.progress = 0; this.terminal = 0
    }
    if (value.event === 'failed' || value.event === 'connected') {
      if (this.terminal++ >= 24) return
    } else if (this.progress++ >= 240) return
    return value
  }
}
