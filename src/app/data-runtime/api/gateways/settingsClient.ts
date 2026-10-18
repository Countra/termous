import { coreSettingsModules, type CoreSettingsModule } from '#common/contracts'
import { localSettingsStore } from './localSettings'
import type { AppConfig, AppLanguage, AppearanceSettings, CompletionSettingsPatch, ConnectionSettingsPatch, MountCacheState, MountCacheClear, Settings, ShortcutSettingsPatch, TerminalFont, TerminalSettings, WindowSettings } from '#common/contracts'
import { SettingsModuleStore, decodeSettingsCatalogue, decodeSettingsSnapshot } from '#entities/settings'
import { normalizeSettings } from '#features/settings'
import type { SettingsModuleId, SettingsSnapshot } from '#common/contracts'
import { TermousApiTransport } from '#shared/api'
import type { AuditSettingsGateway } from '#features/settings'

type Language = AppLanguage

export class SettingsClient extends TermousApiTransport implements AuditSettingsGateway {
  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  terminalFontFileUrl(id: string, sha256?: string) {
    const url = new URL(`/api/v1/terminal-fonts/${encodeURIComponent(id)}/file`, this.config.apiBaseUrl)
    if (this.config.apiToken) {
      url.searchParams.set('token', this.config.apiToken)
    }
    if (sha256) {
      url.searchParams.set('sha256', sha256)
    }
    return url.toString()
  }

  readonly modules: SettingsModuleStore = new SettingsModuleStore({
    read: async (id, signal) => decodeSettingsSnapshot(await this.request(`/api/v1/settings/${id}`, { signal }), id),
    update: async (id, body, signal) => {
      // 连接接口保留完整策略校验；在模块队列执行时合成正文，避免快速切换其他开关覆盖已确认值。
      if (id === 'connection') body = { ...body, patch: { ...this.modules.snapshot(id)?.value, ...body.patch } }
      return decodeSettingsSnapshot(await this.request(`/api/v1/settings/${id}`, { method: 'PATCH', body, signal }), id)
    },
  })

  eventsUrl() { return this.websocketUrl('/api/v1/settings/events') }
  private instanceId = ''
  private store(id: SettingsModuleId) { return coreSettingsModules.includes(id as CoreSettingsModule) ? this.modules : localSettingsStore }
  getModule(id: SettingsModuleId) { return this.store(id).snapshot(id) }
  subscribeSettings(listener: () => void) {
    const core = this.modules.subscribe(listener)
    const local = localSettingsStore.subscribe(listener)
    return () => { core(); local() }
  }
  acceptInstance(id: string) {
    if (this.instanceId !== id) this.modules.reset()
    this.instanceId = id
  }
  invalidateRequests() { this.modules.invalidateRequests() }
  private preferenceSettings = normalizeSettings(undefined)
  private preferenceSnapshots = new Map<SettingsModuleId, SettingsSnapshot | undefined>()
  currentSettings(): Settings {
    for (const id of ['language', 'appearance', 'terminal', 'completion', 'connection', 'shortcuts', 'window'] as const) {
      const snapshot = this.modules.snapshot(id)
      if (snapshot === this.preferenceSnapshots.get(id)) continue
      this.preferenceSnapshots.set(id, snapshot)
      const saved = snapshot?.value
      const normalized = normalizeSettings(saved ? { [id]: id === 'language' ? saved.language : saved } : undefined)
      // 只替换变化模块的派生值，其他面板不会因无关事件重置尚未保存的草稿。
      this.preferenceSettings = { ...this.preferenceSettings, [id]: normalized[id] }
    }
    return this.preferenceSettings
  }
  async settings() {
    const generation = this.modules.epoch
    const instanceId = this.instanceId
    const catalogue = decodeSettingsCatalogue(await this.request('/api/v1/settings'))
    // 首次事件可能先于启动目录返回；仅接纳明确属于该实例的目录，其他迟到读写仍按代次丢弃。
    const initializedDuringRequest = !instanceId && this.instanceId === catalogue.instance_id && this.modules.epoch === generation + 1
    if (generation !== this.modules.epoch && !initializedDuringRequest) throw new Error('SETTINGS_REQUEST_SUPERSEDED')
    this.acceptInstance(catalogue.instance_id)
    for (const item of catalogue.modules) if (item.snapshot) this.modules.merge(item.snapshot)
    return this.currentSettings()
  }
  readModule(id: SettingsModuleId, signal?: AbortSignal) { return this.store(id).read(id, signal) }
  updateModule(id: SettingsModuleId, patch: Record<string, unknown>, options?: { expectedRevision?: number; signal?: AbortSignal }) { return this.store(id).update(id, patch, options) }
  mountCache() { return this.request<MountCacheState>('/api/v1/mount/cache') }
  clearMountCache() { return this.request<MountCacheClear>('/api/v1/mount/cache/clear', { method: 'POST' }) }
  private async updatePreference(id: SettingsModuleId, patch: Record<string, unknown>) {
    await this.modules.update(id, patch)
    return this.currentSettings()
  }
  updateLanguage(language: Language) { return this.updatePreference('language', { language }) }
  updateAppearanceSettings(value: AppearanceSettings) { return this.updatePreference('appearance', { ...value }) }
  updateTerminalSettings(value: TerminalSettings) { return this.updatePreference('terminal', { ...value }) }
  updateCompletionSettings(value: CompletionSettingsPatch) { return this.updatePreference('completion', { ...value }) }
  updateConnectionSettings(value: ConnectionSettingsPatch) { return this.updatePreference('connection', { ...value }) }
  updateShortcutSettings(value: ShortcutSettingsPatch) { return this.updatePreference('shortcuts', { ...value }) }
  updateWindowSettings(value: WindowSettings) { return this.updatePreference('window', { ...value }) }

  terminalFonts() {
    return this.request<TerminalFont[]>('/api/v1/terminal-fonts')
  }

  uploadTerminalFont(file: File) {
    const body = new FormData()
    body.append('file', file, file.name)
    return this.request<TerminalFont>('/api/v1/terminal-fonts', {
      method: 'POST',
      body,
    })
  }

  deleteTerminalFont(id: string) {
    return this.request<void>(`/api/v1/terminal-fonts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
}
