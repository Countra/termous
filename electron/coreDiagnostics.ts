import type { CoreFatalEvent, CoreStartupSnapshot } from '#common/contracts'
import { sanitizeCoreStartupText } from './coreStartupProtocol.ts'

interface StartupDiagnosticsOptions {
  snapshot: CoreStartupSnapshot
  fatal: CoreFatalEvent | null
  appVersion: string
  logDirectory: string
}

// 诊断只投影启动字段；完整 CoreStatus 含认证配置，不能直接序列化。
export function formatStartupDiagnostics({ snapshot, fatal, appVersion, logDirectory }: StartupDiagnosticsOptions): string {
  const failure = snapshot.failure ?? fatal
  const database = snapshot.database
  const entries: Array<[string, unknown]> = [
    ['Termous', appVersion],
    ['Core', snapshot.coreVersion],
    ['Time', snapshot.updatedAt],
    ['Startup', snapshot.attemptId],
    ['Process instance', snapshot.instanceId],
    ['Phase', snapshot.phase],
    ['Database', snapshot.failure?.databaseRole ?? (failure ? undefined : database?.role)],
    ['Operation', failure ? undefined : database?.operation],
    ['From version', snapshot.failure?.fromVersion ?? (failure ? undefined : database?.fromVersion)],
    ['Target version', snapshot.failure?.targetVersion ?? (failure ? undefined : database?.targetVersion)],
    ['Confirmed version', snapshot.failure?.confirmedVersion ?? (failure ? undefined : database?.confirmedVersion)],
    ['Migration', snapshot.failure?.migrationVersion],
    ['Migration file', snapshot.failure?.migrationFile],
    ['Error', failure?.code],
    ['Reason', failure?.message],
    ['Details', failure?.details],
    ['Logs', logDirectory],
  ]
  // 各库事实独立保留，不能用最后一个库的版本补齐另一个库的未知失败版本。
  const databases = snapshot.databases?.length ? snapshot.databases : database ? [database] : []
  for (const current of databases) {
    const label = [current.domain, current.role, current.id].filter(Boolean).join(' / ') || 'current'
    entries.push(
      [`Database ${label}`, current.status],
      [`${label} operation`, current.operation],
      [`${label} from version`, current.fromVersion],
      [`${label} target version`, current.targetVersion],
      [`${label} confirmed version`, current.confirmedVersion],
      [`${label} error`, current.code],
    )
  }
  return entries.filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `${label}: ${sanitizeCoreStartupText(String(value))}`).join('\n')
}
