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
  assert.match(text, /current operation: upgrade/)
  assert.match(text, /current from version: 25/)
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

test('多库诊断保留各自状态和版本，主错误不借用最后一个库的版本', () => {
  const text = formatStartupDiagnostics({
    snapshot: {
      ...initialCoreStartupSnapshot(), phase: 'failed',
      database: { id: '2-4', domain: 'agent', role: 'staged', status: 'completed', operation: 'prepare', fromVersion: 2, targetVersion: 4, confirmedVersion: 4 },
      databases: [
        { id: '1-51', domain: 'core', role: 'live', status: 'failed', code: 'DB_MIGRATION_FAILED', targetVersion: 51, confirmedVersion: 50 },
        { id: '2-4', domain: 'agent', role: 'staged', status: 'completed', operation: 'prepare', fromVersion: 2, targetVersion: 4, confirmedVersion: 4 },
        { id: '3-1', domain: 'audit', role: 'live', status: 'failed', code: 'DB_OPEN_FAILED', fromVersion: 0, targetVersion: 1 },
      ],
      failure: { code: 'DB_MIGRATION_FAILED', message: 'fixture', targetVersion: 51, confirmedVersion: 50, databaseRole: 'live' },
    },
    fatal: null, appVersion: 'test', logDirectory: 'D:/logs',
  })
  assert.match(text, /^Database: live$/m)
  assert.match(text, /^Target version: 51$/m)
  assert.match(text, /^Confirmed version: 50$/m)
  assert.doesNotMatch(text, /^From version:|^Operation:/m)
  assert.match(text, /Database core \/ live \/ 1-51: failed/)
  assert.match(text, /agent \/ staged \/ 2-4 confirmed version: 4/)
  assert.match(text, /audit \/ live \/ 3-1 from version: 0/)
  assert.match(text, /audit \/ live \/ 3-1 error: DB_OPEN_FAILED/)
})
