import path from 'node:path'
import type { ShortcutDetails } from 'electron'

export const legacyAppId = 'dev.termous.app'
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const approvedKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
export interface RegistryValue { type: 'REG_SZ' | 'REG_BINARY'; data: string }
export interface IdentityMigrationAccess {
  read(key: string, name: string): Promise<RegistryValue | null>
  write(key: string, name: string, value: RegistryValue): Promise<void>
  removeValue(key: string, name: string): Promise<void>
  removeKey(key: string): Promise<void>
}
const normalized = (value: string) => path.win32.normalize(value).toLowerCase()
function ownsCommand(command: string, executable: string) {
  return command.toLowerCase() === executable.toLowerCase() || command.toLowerCase() === `"${executable.toLowerCase()}"`
}

export async function migrateWindowsLoginItem(registry: IdentityMigrationAccess, executable: string, appId: string) {
  const old = await registry.read(runKey, legacyAppId)
  if (!old || old.type !== 'REG_SZ' || !ownsCommand(old.data, executable)) return
  const current = await registry.read(runKey, appId)
  if (current && (current.type !== 'REG_SZ' || !ownsCommand(current.data, executable))) throw new Error('login_item_migration_conflict')
  if (!current) {
    // 先迁移系统禁用标记，再写启动命令；中断或失败也不能重新启用已被关闭的启动项。
    const approved = await registry.read(approvedKey, legacyAppId)
    if (approved) await registry.write(approvedKey, appId, approved)
    await registry.write(runKey, appId, old)
  }
  await registry.removeValue(runKey, legacyAppId)
  await registry.removeValue(approvedKey, legacyAppId)
}

export async function retireLegacyNotificationRegistration(registry: IdentityMigrationAccess, shortcut: ShortcutDetails, ownedExecutables: string[]) {
  if (shortcut.appUserModelId !== legacyAppId || shortcut.args || !ownedExecutables.some(exe => normalized(exe) === normalized(shortcut.target))) return false
  const clsid = shortcut.toastActivatorClsid?.replace(/[{}]/g, '')
  // 无 CLSID 的旧安装器入口也可以迁移，但绝不推测、枚举其他 Electron 注册。
  if (!clsid) return true
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(clsid)) return false
  const key = `HKCU\\Software\\Classes\\CLSID\\{${clsid}}`
  const command = await registry.read(`${key}\\LocalServer32`, '')
  if (!command) return true
  if (command.type !== 'REG_SZ' || !ownsCommand(command.data, shortcut.target)) return false
  await registry.removeKey(key)
  return true
}
