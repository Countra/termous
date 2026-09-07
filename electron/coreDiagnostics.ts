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
    ['Database', database?.role],
    ['Operation', database?.operation],
    ['From version', snapshot.failure?.fromVersion ?? database?.fromVersion],
    ['Target version', snapshot.failure?.targetVersion ?? database?.targetVersion],
    ['Confirmed version', snapshot.failure?.confirmedVersion ?? database?.confirmedVersion],
    ['Migration', snapshot.failure?.migrationVersion],
    ['Migration file', snapshot.failure?.migrationFile],
    ['Error', failure?.code],
    ['Reason', failure?.message],
    ['Details', failure?.details],
    ['Logs', logDirectory],
  ]
  return entries.filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `${label}: ${sanitizeCoreStartupText(String(value))}`).join('\n')
}
