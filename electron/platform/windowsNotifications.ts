import path from 'node:path'
import type { ShortcutDetails } from 'electron'
import type { DesktopIdentity } from '#common/desktop-identity'

export interface ShortcutAccess {
  exists(file: string): boolean
  read(file: string): ShortcutDetails
  write(file: string, operation: 'create' | 'update', details: ShortcutDetails): boolean
  mkdir(directory: string): void
}

const samePath = (a: string, b: string) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()

export function prepareWindowsNotificationShortcut(identity: DesktopIdentity, executable: string, programs: string, access: ShortcutAccess) {
  const shortcut = path.win32.join(programs, `${identity.name}.lnk`)
  access.mkdir(programs)
  const existing = access.exists(shortcut) ? access.read(shortcut) : null
  // 只修复本程序的固定入口，不能覆盖同名但指向其他应用的用户快捷方式。
  const ownedIdentity = existing?.appUserModelId === identity.appId
    && existing.toastActivatorClsid?.replace(/[{}]/g, '').toLowerCase() === identity.toastClsid
  if (existing && !samePath(existing.target, executable) && !ownedIdentity) throw new Error('notification_shortcut_target_conflict')
  const expected: ShortcutDetails = {
    target: executable, cwd: path.win32.dirname(executable), args: '',
    icon: executable, iconIndex: 0, appUserModelId: identity.appId,
    toastActivatorClsid: identity.toastClsid, description: identity.name,
  }
  const matches = (value: ShortcutDetails) => samePath(value.target, expected.target)
    && samePath(value.cwd || '', expected.cwd || '') && value.args === ''
    && samePath(value.icon || '', executable) && value.iconIndex === 0
    && value.appUserModelId === identity.appId
    && value.toastActivatorClsid?.replace(/[{}]/g, '').toLowerCase() === identity.toastClsid
  if (!existing || !matches(existing)) {
    if (!access.write(shortcut, existing ? 'update' : 'create', expected)) throw new Error('notification_shortcut_write_failed')
  }
  if (!matches(access.read(shortcut))) throw new Error('notification_shortcut_verify_failed')
  return shortcut
}
