import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { fromJson, toJson, type JsonValue } from '@bufbuild/protobuf'
import { RequestSchema } from '@termous/remote-protocol'
import type { AppLanguage, AppTheme, RemoteBootstrap, RemoteConnection, RemoteDevice, RemotePolicy, RemoteLocalTask, RemoteLocalSelection } from '#common/contracts'
import { RemoteCore, RemoteCoreError, result, validId } from './core'
import { RemoteTerminalStream } from './stream'
import { RemoteLocalTransfers } from './files'

interface Options {
  core: RemoteCore
  trusted(event: IpcMainInvokeEvent): boolean
  preload: string; renderer: string; devURL?: string; icon?: string
  appearance(): { language: AppLanguage; theme: AppTheme }
  warn(code: string): void
}
interface Entry {
  window: BrowserWindow; bootstrap: RemoteBootstrap
  opening: Promise<RemoteConnection>; connection?: RemoteConnection
  stream?: RemoteTerminalStream
  streamOpening?: Promise<void>
  files: RemoteLocalTransfers
  allowClose?: boolean; closing?: boolean
}

export class RemoteControlRuntime {
  private entries = new Map<string, Entry>()
  private timer: ReturnType<typeof setInterval>
  private checking = false
  constructor(private options: Options) {
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
  private async active(event: IpcMainInvokeEvent) {
    const entry = this.own(event)
    const connection = await entry.opening
    if (entry.window.isDestroyed()) throw new RemoteCoreError('remote_disconnected')
    return { entry, connection, base: `/remote-control/connections/${encodeURIComponent(connection.id)}` }
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
      return this.options.core.request<RemotePolicy>('/remote-control/policy', { generation, revision, enabled, profile_ids: ids }, 'PUT')
    }))
    ipcMain.handle('remote:profiles', event => result(async () => {
      this.main(event)
      const profiles = await this.options.core.request<{ id: string; name: string }[]>('/ssh-access-profiles')
      return (profiles ?? []).map(({ id, name }) => ({ id, name }))
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
    ipcMain.handle('remote:select-transfer', (event, input: RemoteLocalSelection) => result(async () => {
      const { entry, base } = await this.active(event)
      return entry.files.select(entry.window, base, entry.bootstrap.generation, input)
    }))
    ipcMain.handle('remote:local-transfers', event => result(async () => {
      const { entry, base } = await this.active(event)
      return (await this.options.core.request<{ tasks: RemoteLocalTask[] }>(`${base}/local-transfers?generation=${encodeURIComponent(entry.bootstrap.generation)}`)).tasks ?? []
    }))
    ipcMain.handle('remote:local-transfer-action', (event, id: string, action: string) => result(async () => {
      const { entry, base } = await this.active(event)
      if (!validId(id) || !['resume', 'cancel'].includes(action)) throw new RemoteCoreError('remote_invalid_request')
      return this.options.core.request<RemoteLocalTask>(`${base}/local-transfers/${encodeURIComponent(id)}/action`, { generation: entry.bootstrap.generation, action })
    }))
    ipcMain.handle('remote:connection', event => result(async () => {
      const { entry, base } = await this.active(event)
      return this.options.core.request<RemoteConnection>(`${base}?generation=${encodeURIComponent(entry.bootstrap.generation)}`)
    }))
    ipcMain.handle('remote:request', (event, input: JsonValue) => result(async () => {
      const { entry, base } = await this.active(event)
      if (JSON.stringify(input).length > 65536) throw new RemoteCoreError('remote_invalid_request')
      const request = fromJson(RequestSchema, input)
      if (!request.operation.case || request.operation.case === 'hello') throw new RemoteCoreError('remote_invalid_request')
      if (request.operation.case === 'transfer') {
        const transfer = request.operation.value
        if (!['create', 'read', 'cancel'].includes(transfer.action) || transfer.sources.some(value => value.kind === 'controller_local') || transfer.target?.kind === 'controller_local') throw new RemoteCoreError('remote_invalid_request')
      }
      return this.options.core.request<JsonValue>(`${base}/request`, { generation: entry.bootstrap.generation, request: toJson(RequestSchema, request) })
    }))
    ipcMain.handle('remote:subscribe', event => result(async () => {
      const { entry, connection } = await this.active(event)
      if (entry.streamOpening) { await entry.streamOpening; return true }
      if (entry.stream) return true
      const stream = new RemoteTerminalStream((sequence, data) => {
        if (!entry.window.isDestroyed()) entry.window.webContents.send('remote:frame', sequence, data)
      }, () => {
        if (entry.stream === stream) entry.stream = undefined
        if (!entry.window.isDestroyed()) entry.window.webContents.send('remote:stream-closed')
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
    ipcMain.handle('remote:send', (event, data: Uint8Array) => result(async () => {
      const entry = this.own(event)
      if (!entry.stream) throw new RemoteCoreError('remote_stream_unavailable')
      return entry.stream.send(data)
    }))
    ipcMain.on('remote:consume', (event, sequence: number) => {
      try { if (Number.isSafeInteger(sequence)) this.own(event).stream?.consume(sequence) } catch { this.options.warn('remote_ipc_forbidden') }
    })
    ipcMain.handle('remote:disconnect', event => result(async () => {
      const entry = this.own(event)
      if (!await this.confirmDisconnect(entry)) return false
      await this.disconnect(entry)
      return true
    }))
    ipcMain.handle('remote:close', event => { this.own(event).window.close() })
  }

  private async open(generation: string, deviceId: string, name: string) {
    const status = await this.options.core.request<{ generation: string; available: boolean }>('/remote-control/status')
    if (!status.available || status.generation !== generation) throw new RemoteCoreError('remote_account_unavailable')
    const key = `${generation}:${deviceId}`
    const existing = this.entries.get(key)
    if (existing && !existing.window.isDestroyed()) { existing.window.show(); existing.window.focus(); return }
    const appearance = this.options.appearance()
    const window = new BrowserWindow({ width: 1220, height: 800, minWidth: 860, minHeight: 560, show: false, title: `Termous · ${name}`, icon: this.options.icon, autoHideMenuBar: true, backgroundColor: appearance.theme === 'dark' ? '#0f1116' : '#f4f5f7', webPreferences: { preload: this.options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } })
    const opening = this.options.core.request<RemoteConnection>('/remote-control/connections', { generation, device_id: deviceId, operation_id: randomUUID() })
    const entry: Entry = { window, bootstrap: { generation, deviceId, deviceName: name, ...appearance }, opening, files: new RemoteLocalTransfers(this.options.core, this.options.warn) }
    this.entries.set(key, entry)
    void opening.then(async connection => { entry.connection = connection; if (window.isDestroyed()) await this.disconnect(entry) }).catch(() => this.options.warn('remote_connection_failed'))
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.once('ready-to-show', () => window.show())
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
    entry.stream?.close()
    if (entry.connection) await this.options.core.request(`/remote-control/connections/${encodeURIComponent(entry.connection.id)}/close`, { generation: entry.bootstrap.generation })
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
