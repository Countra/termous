import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeAuditSettings } from './auditSettings.ts'

test('审计策略接受开关和合法边界，拒绝缺失及错误类型', () => {
  const settings = { enabled: false, retention_days: 1, max_records: 0 }
  assert.deepEqual(decodeAuditSettings(settings), settings)
  assert.deepEqual(decodeAuditSettings({ enabled: true, retention_days: 3650, max_records: 1_000_000 }), { enabled: true, retention_days: 3650, max_records: 1_000_000 })
  for (const invalid of [null, {}, { ...settings, enabled: null }, { ...settings, enabled: 'false' }, { ...settings, retention_days: 0 }, { ...settings, retention_days: 1.5 }, { ...settings, retention_days: 3651 }, { ...settings, max_records: 999 }, { ...settings, max_records: 1_000_001 }]) {
    assert.throws(() => decodeAuditSettings(invalid))
  }
})
