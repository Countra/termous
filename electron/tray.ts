import { Menu, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { existsSync } from 'node:fs'
import type {
  TrayCommand,
  TrayMenuLabels,
  TrayMenuState as TrayMenuContract,
  TrayRecentHost,
} from '#common/contracts'
import type { UpdateSnapshot } from './updateTypes'

type TrayLanguage = TrayMenuContract['language']

export type TrayMenuState = {
  language?: TrayMenuContract['language']
  recentHosts?: TrayMenuContract['recentHosts']
  labels?: Partial<TrayMenuContract['labels']>
}

export type {
  TrayCommand,
  TrayMenuLabels,
  TrayRecentHost,
} from '#common/contracts'

interface TermousTrayControllerOptions {
  appName: string
  iconCandidates: string[]
  getWindow: () => BrowserWindow | null | undefined
  showMainWindow: () => void
  openUpdateWindow: () => void
  quitApp: () => Promise<void>
}

const labels: Record<TrayLanguage, Record<string, string>> = {
  'zh-CN': {
    openApp: '打开 Termous',
    connectHost: '连接主机...',
    recentHosts: '最近主机',
    emptyRecentHosts: '无最近主机',
    forwards: '端口转发',
    updateAvailable: '发现新版本',
    updateDownloading: '正在下载更新',
    updateDownloaded: '更新已可安装',
    quit: '退出',
  },
  'en-US': {
    openApp: 'Open Termous',
    connectHost: 'Connect Host...',
    recentHosts: 'Recent Hosts',
    emptyRecentHosts: 'No Recent Hosts',
    forwards: 'Port Forwarding',
    updateAvailable: 'Update available',
    updateDownloading: 'Downloading update',
    updateDownloaded: 'Update ready to install',
    quit: 'Quit',
  },
}

export class TermousTrayController {
  private tray: Tray | null = null
  private state: { language: TrayLanguage; recentHosts: TrayRecentHost[]; labels: Partial<TrayMenuLabels> } = {
    language: 'zh-CN',
    recentHosts: [],
    labels: {},
  }
  private updateStatus: Pick<
    UpdateSnapshot,
    'phase' | 'available_version' | 'progress'
  > = {
    phase: 'idle',
    available_version: null,
    progress: null,
  }
  private updateDisplaySignature = 'idle'

  constructor(private readonly options: TermousTrayControllerOptions) {}

  initialize() {
    if (this.tray) {
      return true
    }
    const iconPath = this.resolveIconPath()
    if (!iconPath) {
      return false
    }
    this.tray = new Tray(iconPath)
    this.tray.setToolTip(this.options.appName)
    this.tray.on('click', () => {
      this.options.showMainWindow()
    })
    this.rebuildMenu()
    return true
  }

  updateState(nextState: unknown) {
    const normalizedState = this.normalizeState(nextState)
    this.state = {
      language: this.normalizeLanguage(normalizedState.language),
      recentHosts: this.normalizeRecentHosts(normalizedState.recentHosts),
      labels: this.normalizeLabels(normalizedState.labels),
    }
    this.rebuildMenu()
  }

  updateUpdateStatus(snapshot: UpdateSnapshot) {
    const nextStatus = {
      phase: snapshot.phase,
      available_version: snapshot.available_version,
      progress: snapshot.progress ? { ...snapshot.progress } : null,
    }
    const nextSignature = this.updateStatusSignature(nextStatus)
    if (nextSignature === this.updateDisplaySignature) {
      return
    }
    this.updateStatus = nextStatus
    this.updateDisplaySignature = nextSignature
    this.rebuildMenu()
  }

  destroy() {
    if (!this.tray || this.tray.isDestroyed()) {
      this.tray = null
      return
    }
    this.tray.destroy()
    this.tray = null
  }

  private rebuildMenu() {
    if (!this.tray || this.tray.isDestroyed()) {
      return
    }
    const text = { ...labels[this.state.language], ...this.state.labels }
    const recentHostItems = this.state.recentHosts.length > 0
      ? this.state.recentHosts.map<MenuItemConstructorOptions>((host) => ({
        label: host.name,
        click: () => this.dispatch({ type: 'connect-recent-host', hostId: host.id }),
      }))
      : [{ label: text.emptyRecentHosts, enabled: false }]
    const updateItem = this.buildUpdateMenuItem(text)

    const menu = Menu.buildFromTemplate([
      { label: this.options.appName, enabled: false },
      { type: 'separator' },
      { label: text.openApp, click: () => this.dispatch({ type: 'open-app' }) },
      ...(updateItem ? [updateItem, { type: 'separator' as const }] : []),
      { label: text.connectHost, click: () => this.dispatch({ type: 'open-host-launcher' }) },
      { label: text.recentHosts, submenu: recentHostItems },
      { label: text.forwards, click: () => this.dispatch({ type: 'open-forwards' }) },
      { type: 'separator' },
      { label: text.quit, click: () => void this.options.quitApp() },
    ])
    this.tray.setContextMenu(menu)
  }

  private dispatch(command: TrayCommand) {
    this.options.showMainWindow()
    const target = this.options.getWindow()
    if (!target || target.isDestroyed()) {
      return
    }
    target.webContents.send('tray:command', command)
  }

  private buildUpdateMenuItem(
    text: Record<string, string>,
  ): MenuItemConstructorOptions | null {
    const { phase, available_version: version, progress } = this.updateStatus
    if (phase === 'available') {
      return {
        label: version
          ? `${text.updateAvailable} · v${version}`
          : text.updateAvailable,
        click: this.options.openUpdateWindow,
      }
    }
    if (phase === 'downloading') {
      const percent = this.normalizeProgressPercent(progress?.percent)
      return {
        label: `${text.updateDownloading} · ${percent}%`,
        click: this.options.openUpdateWindow,
      }
    }
    if (phase === 'downloaded') {
      return {
        label: text.updateDownloaded,
        click: this.options.openUpdateWindow,
      }
    }
    return null
  }

  private updateStatusSignature(status: typeof this.updateStatus) {
    if (status.phase === 'available') {
      return `${status.phase}:${status.available_version ?? ''}`
    }
    if (status.phase === 'downloading') {
      return `${status.phase}:${this.normalizeProgressPercent(status.progress?.percent)}`
    }
    return status.phase
  }

  private normalizeProgressPercent(value: number | undefined) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.round(Math.min(100, Math.max(0, value)))
      : 0
  }

  private resolveIconPath() {
    return this.options.iconCandidates.find((candidate) => existsSync(candidate)) ?? null
  }

  private normalizeLanguage(language: TrayMenuState['language']) {
    return language === 'en-US' ? 'en-US' : 'zh-CN'
  }

  private normalizeState(state: unknown): TrayMenuState {
    return state && typeof state === 'object' ? state as TrayMenuState : {}
  }

  private normalizeRecentHosts(hosts: TrayMenuState['recentHosts']) {
    if (!Array.isArray(hosts)) {
      return []
    }
    return hosts
      .filter((host): host is TrayRecentHost => (
        typeof host?.id === 'string' &&
        typeof host?.name === 'string' &&
        Boolean(host.id.trim()) &&
        Boolean(host.name.trim())
      ))
      .slice(0, 5)
  }

  private normalizeLabels(nextLabels: TrayMenuState['labels']) {
    if (!nextLabels || typeof nextLabels !== 'object') {
      return {}
    }
    return Object.fromEntries(
      Object.entries(nextLabels).filter(([, value]) => typeof value === 'string' && value.trim()),
    )
  }
}
