import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { fromJson, toJson, type JsonValue } from '@bufbuild/protobuf'
import { RequestSchema } from '@termous/remote-protocol'
import type { AppLanguage, AppTheme, RemoteBootstrap, RemoteConnection, RemoteDevice, RemotePolicy, RemoteLocalTask, RemoteLocalSelection } from '#common/contracts'
import { appDebugModeArgument } from '#common/contracts'
import { RemoteCore, RemoteCoreError, result, validId } from './core'
import { RemoteTerminalStream } from './stream'
import { RemoteLocalTransfers } from './files'
import { RemoteAgentContent } from './agentContent'

interface Options {
  core: RemoteCore
  trusted(event: IpcMainInvokeEvent): boolean
  preload: string; renderer: string; devURL?: string; icon?: string; debugMode?: boolean
  appearance(): { language: AppLanguage; theme: AppTheme }
  warn(code: string): void
}
interface Entry {
  window: BrowserWindow; bootstrap: RemoteBootstrap
  opening: Promise<RemoteConnection>; connection?: RemoteConnection
  stream?: RemoteTerminalStream
  streamOpening?: Promise<void>
  reconnecting?: Promise<RemoteConnection>
  files: RemoteLocalTransfers
  allowClose?: boolean; closing?: boolean
}

export class RemoteControlRuntime {
  private agentContent: RemoteAgentContent
  private entries = new Map<string, Entry>()
  private timer: ReturnType<typeof setInterval>
  private checking = false
  constructor(private options: Options) {
    this.agentContent = new RemoteAgentContent(options.core)
    this.register()
    this.timer = setInterval(() => { void this.checkAccount() }, 3000)
    this.timer.unref()
  }

  private async checkAccount() {
    if (this.checking || !this.entries.size) return
    this.checking = true
    try {
      const status = await this.options.core.request<{ generation: string; authenticated: boolean }>('/cloud/status')
      for (const entry of this.entries.values()) {
        if (!status.authenticated || status.generation !== entry.bootstrap.generation) { entry.allowClose = true; entry.window.close() }
      }
    } catch { this.options.warn('remote_account_check_failed') } finally { this.checking = false }
  }

  private own(event: IpcMainInvokeEvent): Entry {
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed() && entry.window.webContents === event.sender && event.senderFrame === event.sender.mainFrame) return entry
    }
    throw new RemoteCoreError('remote_ipc_forbidden')
  }
  private async current(event: IpcMainInvokeEvent) {
    const entry = this.own(event)
    const opening = entry.opening
    const connection = await opening
    if (entry.window.isDestroyed() || entry.opening !== opening) throw new RemoteCoreError('remote_disconnected')
    return { entry, connection, opening, base: `/remote-control/connections/${encodeURIComponent(connection.id)}` }
  }
  private async active(event: IpcMainInvokeEvent, expected: unknown) {
    if (!validId(expected)) throw new RemoteCoreError('remote_disconnected')
    const current = await this.current(event)
    if (expected !== current.connection.id) throw new RemoteCoreError('remote_disconnected')
    return current
  }
  private main(event: IpcMainInvokeEvent, generation?: unknown) {
    if (!this.options.trusted(event) || generation !== undefined && !validId(generation)) throw new RemoteCoreError('remote_ipc_forbidden')
  }
  private policy(generation: string) {
    return this.options.core.request<RemotePolicy>(`/remote-control/policy?generation=${encodeURIComponent(generation)}`)
  }
  private saveDirectories(generation: string, revision: number, directories: { path: string; read: boolean; write: boolean }[]) {
    return this.options.core.request<RemotePolicy>('/remote-control/directories', { generation, revision, directories: directories.map(item => ({ Path: item.path, Read: item.read, Write: item.write })) }, 'PUT')
  }

  private register() {
    // 只允许远控窗口的主 frame 操作其自身窗口，窗口按钮不依赖远端连接状态。
    ipcMain.handle('remote:window-minimize', event => result(async () => {
      this.own(event).window.minimize()
      return true
    }))
    ipcMain.handle('remote:window-toggle-maximize', event => result(async () => {
      const window = this.own(event).window
      if (window.isMaximized()) window.unmaximize(); else window.maximize()
      return window.isMaximized()
    }))
    ipcMain.handle('remote:window-is-maximized', event => result(async () => this.own(event).window.isMaximized()))
    ipcMain.handle('remote:open-agent', (event, generation: string, target: unknown) => result(async () => {
      this.main(event, generation)
      if (!target || typeof target !== 'object' || !('account' in target) || !('device_id' in target) || !('session_id' in target) || !validId(target.account) || !validId(target.device_id) || !validId(target.session_id)) throw new RemoteCoreError('remote_invalid_request')
      const approval = 'approval_id' in target ? target.approval_id : undefined
      if (approval !== undefined && !validId(approval)) throw new RemoteCoreError('remote_invalid_request')
      const status = await this.options.core.request<{ generation: string; scope_id: string; available: boolean }>('/remote-control/status')
      if (!status.available || status.generation !== generation || status.scope_id !== target.account) throw new RemoteCoreError('remote_account_unavailable')
      const devices = await this.options.core.request<{ devices: RemoteDevice[] }>(`/remote-control/devices?generation=${encodeURIComponent(generation)}`)
      const device = devices.devices?.find(device => device.id === target.device_id)
      if (!device) throw new RemoteCoreError('remote_host_unavailable')
      await this.open(generation, device.id, device.name, { id: randomUUID(), sessionId: target.session_id, approvalId: approval })
      return true
    }))
    ipcMain.handle('remote:configure-agent', (event, generation: string, revision: number, enabled: boolean) => result(async () => {
      this.main(event, generation)
      if (!Number.isSafeInteger(revision) || revision < 0 || typeof enabled !== 'boolean') throw new RemoteCoreError('remote_invalid_request')
      return this.options.core.request<RemotePolicy>('/remote-control/agent-policy', { generation, revision, enabled }, 'PUT')
    }))
    ipcMain.handle('remote:agent-upload', (event, data: unknown, mime: unknown, id: string) => result(async () => {
      const { entry, base } = await this.active(event, id)
      return this.agentContent.upload(base, entry.bootstrap.generation, data, mime)
    }))
    ipcMain.handle('remote:desktop-ice', (event, id: string) => result(async () => {
      const { entry, base } = await this.active(event, id)
      return (await this.options.core.request<{ ice_servers: RTCIceServer[] }>(`${base}/desktop-ice`, { generation: entry.bootstrap.generation })).ice_servers
    }))
    ipcMain.handle('remote:configure-desktops', (event, generation: string, revision: number, profiles: unknown, exchangeProfiles: unknown) => result(async () => {
      this.main(event, generation)
      if (!Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(profiles) || profiles.length > 256 || !profiles.every(validId)) throw new RemoteCoreError('remote_invalid_request')
      if (exchangeProfiles !== undefined && (!Array.isArray(exchangeProfiles) || exchangeProfiles.length > 256 || !exchangeProfiles.every(validId))) throw new RemoteCoreError('remote_invalid_request')
      return this.options.core.request<RemotePolicy>('/remote-control/desktop-policy', { generation, revision, profile_ids: profiles, exchange_profile_ids: exchangeProfiles }, 'PUT')
    }))
    ipcMain.handle('remote:desktop-profiles', event => result(async () => {
      this.main(event)
      const profiles = await this.options.core.request<{ id: string; host_id: string; name: string; protocol: string }[]>('/remote-desktop-profiles')
      return profiles.map(({ id, host_id, name, protocol }) => ({ id, host_id, name, protocol }))
    }))
    ipcMain.handle('remote:agent-download', (event, content: unknown, id: string) => result(async () => {
      const { entry, base } = await this.active(event, id)
      return this.agentContent.download(base, entry.bootstrap.generation, content)
    }))
    ipcMain.handle('remote:open', (event, generation: string, deviceId: string, name: string) => result(async () => {
      this.main(event, generation)
      if (!validId(deviceId) || typeof name !== 'string' || name.length > 256) throw new RemoteCoreError('remote_invalid_request')
      await this.open(generation, deviceId, name)
      return true
    }))
    ipcMain.handle('remote:devices', (event, generation: string) => result(async () => {
      this.main(event, generation)
      return (await this.options.core.request<{ devices: RemoteDevice[] }>(`/remote-control/devices?generation=${encodeURIComponent(generation)}`)).devices ?? []
    }))
    ipcMain.handle('remote:policy', (event, generation: string) => result(async () => { this.main(event, generation); return this.policy(generation) }))
    ipcMain.handle('remote:configure', (event, generation: string, revision: number, enabled: boolean, ids: string[]) => result(async () => {
      this.main(event, generation)
      if (!Number.isSafeInteger(revision) || typeof enabled !== 'boolean' || !Array.isArray(ids) || ids.length > 256 || !ids.every(validId)) throw new RemoteCoreError('remote_invalid_request')
      return this.options.core.request<RemotePolicy>('/remote-control/policy', { generation, revision, enabled, host_ids: ids }, 'PUT')
    }))
    ipcMain.handle('remote:hosts', event => result(async () => {
      this.main(event)
      const hosts = await this.options.core.request<{ id: string; name: string }[]>('/host-assets')
      return (hosts ?? []).map(({ id, name }) => ({ id, name }))
    }))
    ipcMain.handle('remote:add-directory', (event, generation: string, revision: number, write: boolean) => result(async () => {
      this.main(event, generation)
      if (!Number.isSafeInteger(revision) || typeof write !== 'boolean') throw new RemoteCoreError('remote_invalid_request')
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) throw new RemoteCoreError('remote_ipc_forbidden')
      const selected = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const policy = await this.policy(generation)
      if (policy.revision !== revision) throw new RemoteCoreError('remote_policy_changed')
      return this.saveDirectories(generation, revision, [...(policy.directories ?? []), { path: selected.filePaths[0], read: true, write }])
    }))
    ipcMain.handle('remote:remove-directory', (event, generation: string, revision: number, id: string) => result(async () => {
      this.main(event, generation)
      if (!validId(id) || !Number.isSafeInteger(revision)) throw new RemoteCoreError('remote_invalid_request')
      const policy = await this.policy(generation)
      if (policy.revision !== revision) throw new RemoteCoreError('remote_policy_changed')
      return this.saveDirectories(generation, revision, (policy.directories ?? []).filter(value => value.id !== id))
    }))
    ipcMain.handle('remote:bootstrap', event => this.own(event).bootstrap)
    ipcMain.handle('remote:reconnect', event => result(() => this.reconnect(this.own(event))))
    ipcMain.handle('remote:select-transfer', (event, input: RemoteLocalSelection, id: string) => result(async () => {
      const { entry, base } = await this.active(event, id)
      return entry.files.select(entry.window, base, entry.bootstrap.generation, input)
    }))
    ipcMain.handle('remote:local-transfers', (event, id: string) => result(async () => {
      const { entry, base } = await this.active(event, id)
      return (await this.options.core.request<{ tasks: RemoteLocalTask[] }>(`${base}/local-transfers?generation=${encodeURIComponent(entry.bootstrap.generation)}`)).tasks ?? []
    }))
    ipcMain.handle('remote:local-transfer-action', (event, id: string, action: string, connection: string) => result(async () => {
      const { entry, base } = await this.active(event, connection)
      if (!validId(id) || !['resume', 'cancel'].includes(action)) throw new RemoteCoreError('remote_invalid_request')
      return this.options.core.request<RemoteLocalTask>(`${base}/local-transfers/${encodeURIComponent(id)}/action`, { generation: entry.bootstrap.generation, action })
    }))
    ipcMain.handle('remote:connection', event => result(async () => {
      const { entry, base } = await this.current(event)
      return this.options.core.request<RemoteConnection>(`${base}?generation=${encodeURIComponent(entry.bootstrap.generation)}`)
    }))
    ipcMain.handle('remote:request', (event, input: JsonValue, id: string) => result(async () => {
      const { entry, base } = await this.active(event, id)
      if (JSON.stringify(input).length > 65536) throw new RemoteCoreError('remote_invalid_request')
      const request = fromJson(RequestSchema, input)
      if (!request.operation.case || request.operation.case === 'hello') throw new RemoteCoreError('remote_invalid_request')
      if (request.operation.case === 'transfer') {
        const transfer = request.operation.value
        if (!['create', 'read', 'cancel'].includes(transfer.action) || transfer.sources.some(value => value.kind === 'controller_local') || transfer.target?.kind === 'controller_local') throw new RemoteCoreError('remote_invalid_request')
      }
      return this.options.core.request<JsonValue>(`${base}/request`, { generation: entry.bootstrap.generation, request: toJson(RequestSchema, request) })
    }))
    ipcMain.handle('remote:subscribe', (event, id: string) => result(async () => {
      const { entry, connection, opening: connectionOpening } = await this.active(event, id)
      // 异步校验返回后可能已开始重连，旧订阅不能重新占用窗口的唯一二进制通道。
      if (entry.opening !== connectionOpening || entry.window.isDestroyed()) throw new RemoteCoreError('remote_disconnected')
      if (entry.streamOpening) { await entry.streamOpening; return true }
      if (entry.stream) return true
      const stream = new RemoteTerminalStream((sequence, data) => {
        if (entry.stream === stream && !entry.window.isDestroyed()) entry.window.webContents.send('remote:frame', connection.id, sequence, data)
      }, () => {
        if (entry.stream !== stream) return
        entry.stream = undefined
        if (!entry.window.isDestroyed()) entry.window.webContents.send('remote:stream-closed', connection.id)
      })
      entry.stream = stream
      const opening = this.options.core.config().then(config => stream.open(config, entry.bootstrap.generation, connection.id))
      entry.streamOpening = opening
      try { await opening } catch (error) {
        stream.close()
        throw error
      } finally { if (entry.streamOpening === opening) entry.streamOpening = undefined }
      return true
    }))
    ipcMain.handle('remote:send', (event, data: Uint8Array, id: string) => result(async () => {
      const entry = this.own(event)
      if (!entry.stream || entry.connection?.id !== id) throw new RemoteCoreError('remote_stream_unavailable')
      return entry.stream.send(data)
    }))
    ipcMain.on('remote:consume', (event, sequence: number, id: string) => {
      try {
        const entry = this.own(event)
        if (Number.isSafeInteger(sequence) && entry.connection?.id === id) entry.stream?.consume(sequence)
      } catch { this.options.warn('remote_ipc_forbidden') }
    })
    ipcMain.handle('remote:disconnect', event => result(async () => {
      const entry = this.own(event)
      if (!await this.confirmDisconnect(entry)) return false
      await this.disconnect(entry)
      return true
    }))
    ipcMain.handle('remote:close', event => { this.own(event).window.close() })
  }

  private async open(generation: string, deviceId: string, name: string, agentTarget?: RemoteBootstrap['agentTarget']) {
    const status = await this.options.core.request<{ generation: string; available: boolean }>('/remote-control/status')
    if (!status.available || status.generation !== generation) throw new RemoteCoreError('remote_account_unavailable')
    const key = `${generation}:${deviceId}`
    const existing = this.entries.get(key)
    if (existing && !existing.window.isDestroyed()) {
      if (agentTarget) { existing.bootstrap = { ...existing.bootstrap, agentTarget }; existing.window.webContents.send('remote:appearance', existing.bootstrap) }
      existing.window.show(); existing.window.focus(); return
    }
    const appearance = this.options.appearance()
    const isMac = process.platform === 'darwin'
    const window = new BrowserWindow({ width: 1220, height: 800, minWidth: 860, minHeight: 560, frame: isMac, titleBarStyle: isMac ? 'hiddenInset' : 'default', show: false, title: `Termous · ${name}`, icon: this.options.icon, autoHideMenuBar: true, backgroundColor: appearance.theme === 'dark' ? '#0f1116' : '#f4f5f7', webPreferences: { preload: this.options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, additionalArguments: this.options.debugMode ? [appDebugModeArgument] : [] } })
    const opening = this.options.core.request<RemoteConnection>('/remote-control/connections', { generation, device_id: deviceId, operation_id: randomUUID() })
    const entry: Entry = { window, bootstrap: { generation, deviceId, deviceName: name, agentTarget, platform: process.platform, ...appearance }, opening, files: new RemoteLocalTransfers(this.options.core, this.options.warn) }
    this.entries.set(key, entry)
    void opening.then(async connection => { entry.connection = connection; if (window.isDestroyed()) await this.disconnect(entry) }).catch(() => this.options.warn('remote_connection_failed'))
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.once('ready-to-show', () => window.show())
    window.on('maximize', () => window.webContents.send('remote:maximize-state', true))
    window.on('unmaximize', () => window.webContents.send('remote:maximize-state', false))
    window.on('close', event => {
      if (entry.allowClose) return
      event.preventDefault()
      if (entry.closing) return
      entry.closing = true
      void this.confirmDisconnect(entry).then(accepted => {
        if (accepted && !window.isDestroyed()) { entry.allowClose = true; window.close() }
      }).catch(() => this.options.warn('remote_close_check_failed')).finally(() => { entry.closing = false })
    })
    window.once('closed', () => { this.entries.delete(key); void this.disconnect(entry).catch(() => this.options.warn('remote_disconnect_failed')) })
    try {
      if (this.options.devURL) { const url = new URL(this.options.devURL); url.searchParams.set('surface', 'remote'); await window.loadURL(url.toString()) }
      else await window.loadFile(this.options.renderer, { query: { surface: 'remote' } })
    } catch { window.destroy(); throw new RemoteCoreError('remote_window_unavailable') }
  }

  private async disconnect(entry: Entry) {
    const stream = entry.stream
    entry.stream = undefined
    stream?.close()
    if (stream && entry.connection && !entry.window.isDestroyed()) entry.window.webContents.send('remote:stream-closed', entry.connection.id)
    if (entry.connection) {
      try { await this.options.core.request(`/remote-control/connections/${encodeURIComponent(entry.connection.id)}/close`, { generation: entry.bootstrap.generation }) }
      catch (error) {
        if (!(error instanceof RemoteCoreError) || error.code !== 'remote_connection_unavailable') throw error
      }
    }
  }

  private reconnect(entry: Entry): Promise<RemoteConnection> {
    if (entry.reconnecting) return entry.reconnecting
    const previous = entry.opening
    const opening = (async () => {
      // 等初次连接结束后再清理，失败的连接也允许用户原地重试。
      await previous.catch(() => undefined)
      await this.disconnect(entry)
      if (entry.streamOpening) await entry.streamOpening.catch(() => undefined)
      const status = await this.options.core.request<{ generation: string; available: boolean }>('/remote-control/status')
      if (!status.available || status.generation !== entry.bootstrap.generation) throw new RemoteCoreError('remote_account_unavailable')
      if (entry.window.isDestroyed()) throw new RemoteCoreError('remote_disconnected')
      const connection = await this.options.core.request<RemoteConnection>('/remote-control/connections', { generation: entry.bootstrap.generation, device_id: entry.bootstrap.deviceId, operation_id: randomUUID() })
      entry.connection = connection
      if (entry.window.isDestroyed()) {
        await this.disconnect(entry)
        throw new RemoteCoreError('remote_disconnected')
      }
      return connection
    })()
    entry.opening = opening
    entry.reconnecting = opening
    void opening.finally(() => { if (entry.reconnecting === opening) entry.reconnecting = undefined }).catch(() => this.options.warn('remote_reconnect_failed'))
    return opening
  }

  private async confirmDisconnect(entry: Entry): Promise<boolean> {
    if (!entry.connection || entry.window.isDestroyed()) return true
    try {
      const base = `/remote-control/connections/${encodeURIComponent(entry.connection.id)}`
      const { tasks } = await this.options.core.request<{ tasks: RemoteLocalTask[] }>(`${base}/local-transfers?generation=${encodeURIComponent(entry.bootstrap.generation)}`)
      if (!(tasks ?? []).some(task => ['preparing', 'running', 'publishing', 'published'].includes(task.state))) return true
    } catch { this.options.warn('remote_transfer_status_unavailable') }
    if (entry.window.isDestroyed()) return true
    const zh = entry.bootstrap.language === 'zh-CN'
    const answer = await dialog.showMessageBox(entry.window, {
      type: 'question', title: 'Termous',
      message: zh ? '断开后，使用此设备文件的传输将暂停。' : 'Transfers using this device will pause when disconnected.',
      detail: zh ? '被控电脑上的会话和任务会保留。' : 'Sessions and tasks on the controlled computer will remain.',
      buttons: zh ? ['保持连接', '断开连接'] : ['Stay connected', 'Disconnect'], defaultId: 0, cancelId: 0,
    })
    return answer.response === 1
  }

  updateAppearance() {
    for (const entry of this.entries.values()) {
      entry.bootstrap = { ...entry.bootstrap, ...this.options.appearance() }
      if (!entry.window.isDestroyed()) entry.window.webContents.send('remote:appearance', entry.bootstrap)
    }
  }
  close() { clearInterval(this.timer); for (const entry of this.entries.values()) entry.window.close() }
}
