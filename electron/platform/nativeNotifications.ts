import { app, Notification, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { desktopChannel, identity } from './environment'
import { prepareWindowsNotificationShortcut } from './windowsNotifications'
import { migrateWindowsLoginItem } from './windowsMigration'
import { windowsRegistry } from './windowsRegistry'
import { prepareLinuxDevelopmentEntry } from './linuxDesktop'
import { pendingLegacyShortcuts, migrateLegacyShortcuts } from './legacyShortcuts'

type Report = (event: string, fields: Record<string, unknown>) => void

export async function prepareNativeNotifications(report: Report): Promise<boolean> {
  let stage = 'platform'
  try {
    if (process.platform === 'linux' && desktopChannel === 'development') {
      stage = 'desktop_entry'
      const dataHome = process.env.XDG_DATA_HOME
      prepareLinuxDevelopmentEntry(identity, process.execPath, path.join(process.resourcesPath, 'icon.png'), dataHome && path.isAbsolute(dataHome) ? dataHome : path.join(app.getPath('home'), '.local/share'))
    }
    if (process.platform === 'win32') {
      const programs = path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs')
      const registry = windowsRegistry()
      const journal = path.join(app.getPath('userData'), 'desktop-identity-migration.json')
      let legacy: ReturnType<typeof pendingLegacyShortcuts> = []
      if (desktopChannel === 'production') {
        try { legacy = pendingLegacyShortcuts(programs, journal, file => shell.readShortcutLink(file)) }
        catch {
          // 旧注册材料未保存时不能覆盖入口，否则下次无法核对原 CLSID 的归属。
          report('desktop-identity-migration-failed', { stage: 'legacy_shortcuts_read', channel: desktopChannel })
          return false
        }
        try { await migrateWindowsLoginItem(registry, process.execPath, identity.appId) }
        catch { report('desktop-identity-migration-failed', { stage: 'login_item', channel: desktopChannel }) }
      }
      stage = 'shortcut'
      const shortcut = prepareWindowsNotificationShortcut(identity, process.execPath, programs, {
        exists: existsSync, read: file => shell.readShortcutLink(file),
        write: (file, operation, details) => shell.writeShortcutLink(file, operation, details),
        mkdir: directory => { mkdirSync(directory, { recursive: true }) },
      })
      if (desktopChannel === 'production') {
        // 迁移失败可下次重试，不影响已具备独立身份的新通知入口。
        await migrateLegacyShortcuts(legacy, journal, shortcut, process.execPath, registry, file => shell.readShortcutLink(file), () => report('desktop-identity-migration-failed', { stage: 'legacy_notification', channel: desktopChannel }))
      }
    }
    stage = 'notification_presenter'
    return Notification.isSupported()
  } catch (error) {
    report('native-notification-registration-failed', { channel: desktopChannel, stage, error: error instanceof Error ? error.message : 'unknown' })
    return false
  }
}
