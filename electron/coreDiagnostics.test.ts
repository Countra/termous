import assert from 'node:assert/strict'
import test from 'node:test'
import { formatStartupDiagnostics } from './coreDiagnostics.ts'
import { initialCoreStartupSnapshot } from './coreStartupState.ts'

test('复制诊断只使用启动字段并保留已确认的迁移版本和脱敏原因', () => {
  const text = formatStartupDiagnostics({
    snapshot: {
      ...initialCoreStartupSnapshot(), attemptId: 'test-attempt', phase: 'failed',
      database: { status: 'failed', operation: 'upgrade', fromVersion: 25, targetVersion: 37 },
      failure: {
        code: 'DB_MIGRATION_FAILED', message: 'disk full; token=private-value',
        confirmedVersion: 30, migrationVersion: 31, migrationFile: '00031_fixture.sql',
      },
    },
    fatal: { title: '失败', code: 'CORE_START_FAILED', message: 'generic error' },
    appVersion: 'test', logDirectory: 'D:/logs',
  })
  assert.match(text, /Confirmed version: 30/)
  assert.match(text, /Migration: 31/)
  assert.match(text, /DB_MIGRATION_FAILED/)
  assert.doesNotMatch(text, /private-value|generic error|apiToken/)
})

test('非迁移失败保留具体原因，未知数据库版本不伪造为零', () => {
  const text = formatStartupDiagnostics({
    snapshot: initialCoreStartupSnapshot(),
    fatal: { title: '失败', message: 'permission denied', code: 'CORE_PROCESS_ERROR' },
    appVersion: 'test', logDirectory: 'D:/logs',
  })
  assert.match(text, /permission denied/)
  assert.doesNotMatch(text, /Confirmed version:|From version:/)
})
