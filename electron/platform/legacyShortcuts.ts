import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ShortcutDetails } from 'electron'
import { legacyAppId, retireLegacyNotificationRegistration, type IdentityMigrationAccess } from './windowsMigration.ts'

interface Entry { file: string; details: ShortcutDetails }

export function pendingLegacyShortcuts(programs: string, journal: string, read: (file: string) => ShortcutDetails) {
  const files = ['Termous.lnk', 'Termous/Termous.lnk', 'Electron.lnk'].map(name => path.join(programs, name))
  const previous: Entry[] = existsSync(journal) ? JSON.parse(readFileSync(journal, 'utf8')) : []
  if (!Array.isArray(previous) || previous.length > 16 || previous.some(entry => !files.includes(entry.file) || entry.details?.appUserModelId !== legacyAppId || typeof entry.details.target !== 'string')) throw new Error('identity_migration_journal_invalid')
  const entries = [...previous]
  for (const file of files) {
    if (!existsSync(file)) continue
    const details = read(file)
    if (details.appUserModelId === legacyAppId && !entries.some(entry => entry.file === file && entry.details.toastActivatorClsid === details.toastActivatorClsid)) entries.push({ file, details })
  }
  save(journal, entries)
  return entries
}

function save(file: string, entries: Entry[]) {
  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(entries))
  renameSync(temporary, file)
}

export async function migrateLegacyShortcuts(entries: Entry[], journal: string, currentShortcut: string, currentExecutable: string, registry: IdentityMigrationAccess, read: (file: string) => ShortcutDetails, failed: () => void) {
  const pending = [...entries]
  for (const entry of entries) {
    try {
      const owned = [currentExecutable]
      // 旧开发入口必须同时匹配 Termous 源码包和 Electron 分发路径，不能只凭 Electron 文件名清理。
      const normalized = entry.details.target.replace(/\\/g, '/')
      const modules = normalized.indexOf('/node_modules/')
      if (modules > 0 && normalized.endsWith('/node_modules/electron/dist/electron.exe')) {
        const metadataFile = path.join(normalized.slice(0, modules), 'package.json')
        if (existsSync(metadataFile)) {
          const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'))
          if (metadata.name === 'termous' && metadata.main === 'dist-electron/main.js') owned.push(entry.details.target)
        }
      }
      if (await retireLegacyNotificationRegistration(registry, entry.details, owned) && entry.file !== currentShortcut && existsSync(entry.file)) {
        const actual = read(entry.file)
        if (actual.appUserModelId === legacyAppId && actual.target === entry.details.target && actual.toastActivatorClsid === entry.details.toastActivatorClsid) unlinkSync(entry.file)
      }
      pending.splice(pending.indexOf(entry), 1)
      save(journal, pending)
    } catch { failed() }
  }
}
