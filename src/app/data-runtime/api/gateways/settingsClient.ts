import type { AppConfig, AppLanguage, AppearanceSettings, CompletionSettings, Settings, ShortcutSettingsPatch, TerminalFont, TerminalSettings, WindowSettings } from '#common/contracts';
import { TermousApiTransport } from '#shared/api';

type Language = AppLanguage

export class SettingsClient extends TermousApiTransport {
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

settings() {
    return this.request<Settings>('/api/v1/settings')
  }

updateLanguage(language: Language) {
    return this.request<Settings>('/api/v1/settings/language', {
      method: 'PATCH',
      body: { language },
    })
  }

updateAppearanceSettings(appearance: AppearanceSettings) {
    return this.request<Settings>('/api/v1/settings/appearance', {
      method: 'PATCH',
      body: appearance,
    })
  }

updateTerminalSettings(terminal: TerminalSettings) {
    return this.request<Settings>('/api/v1/settings/terminal', {
      method: 'PATCH',
      body: terminal,
    })
  }

updateCompletionSettings(completion: CompletionSettings) {
    return this.request<Settings>('/api/v1/settings/completion', {
      method: 'PATCH',
      body: completion,
    })
  }

updateShortcutSettings(patch: ShortcutSettingsPatch) {
    return this.request<Settings>('/api/v1/settings/shortcuts', {
      method: 'PATCH',
      body: patch,
    })
  }

updateWindowSettings(windowSettings: WindowSettings) {
    return this.request<Settings>('/api/v1/settings/window', {
      method: 'PATCH',
      body: windowSettings,
    })
  }

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
