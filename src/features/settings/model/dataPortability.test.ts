import assert from 'node:assert/strict'
import test from 'node:test'
import type { DataPortabilitySummary } from '#common/contracts'
import { normalizePortabilitySummary, portabilityDatasets } from './dataPortability.ts'

test('选择性备份恢复包含文件重命名预设且数据集不重复', () => {
  assert.equal(portabilityDatasets.filter((key) => key === 'file_rename_presets').length, 1)
  assert.equal(new Set(portabilityDatasets).size, portabilityDatasets.length)
})

test('便携数据摘要保留服务端返回的文件重命名预设统计', () => {
  const summary: DataPortabilitySummary = {
    datasets: [{ key: 'file_rename_presets', count: 3 }],
    total_items: 3,
    asset_count: 0,
    asset_bytes: 0,
  }

  assert.deepEqual(normalizePortabilitySummary(summary), summary)
})
