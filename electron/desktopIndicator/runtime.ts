import { ipcMain } from 'electron'
import type { AppConfig, AppLanguage, AppTheme, DesktopControlSnapshot, DesktopIndicatorState } from '#common/contracts'
import { DesktopIndicatorConnection } from './connection.ts'
import { DesktopIndicatorWindows } from './windows.ts'
import { installIndicatorIPC } from './ipc.ts'
import { indicatorSupported } from './platform.ts'

interface Options {
  config(): Promise<AppConfig>
  appearance(): { language: AppLanguage; theme: AppTheme }
  exitCommitted(): boolean
  preload: string; renderer: string; devURL?: string
  warn(code: string): void
  reclaimFailed(): void
}
export class DesktopIndicatorRuntime {
  private snapshot: DesktopControlSnapshot | null = null
  private revision = 0
  private windows?: DesktopIndicatorWindows
  private connection?: DesktopIndicatorConnection
  private uninstall?: () => void
  constructor(private readonly options: Options) {}
  start() {
    if (this.connection || !indicatorSupported()) return
    const state = (role: DesktopIndicatorState['role']): DesktopIndicatorState => ({ role, revision: this.revision, ...this.options.appearance(),
      instance_id: this.snapshot?.instance_id ?? '', control: this.snapshot?.controls.find(c => c.target.kind === 'host_desktop' && c.active) ?? null })
    this.windows = new DesktopIndicatorWindows({ ...this.options, state })
    this.connection = new DesktopIndicatorConnection({ config: this.options.config, warn: this.options.warn, snapshot: value => {
      this.snapshot = value
      this.revision++
      this.windows?.update(Boolean(state('bar').control))
    } })
    this.uninstall = installIndicatorIPC({ ipc: ipcMain, own: event => this.windows!.own(event), state, snapshot: () => this.snapshot,
      reclaim: request => this.connection!.reclaim(request), failed: this.options.reclaimFailed })
    void this.connection.start()
  }
  close() { this.connection?.close(); this.windows?.close(); this.uninstall?.() }
}
