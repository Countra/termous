import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hostAssetInputsEqual,
  hostAssetToInput,
  normalizeHostAssetInput,
  sortHostAssets,
  validateHostAssetInput,
} from './hostAsset.ts'
import type { HostAsset, HostAssetInput } from './types.ts'

const asset: HostAsset = {
  id: 'hst_b',
  name: 'Beta',
  platform: 'linux',
  group_id: '',
  tags: ['prod'],
  favorite: false,
  created_at: '2026-08-25T00:00:00Z',
  updated_at: '2026-08-25T00:00:00Z',
}

test('主机资产草稿只保留资产字段并规范可编辑内容', () => {
  const input = normalizeHostAssetInput({
    ...hostAssetToInput(asset),
    name: '  Beta  ',
    tags: [' prod ', 'PROD', ' edge node '],
    note: '  note  ',
  })

  assert.deepEqual(input.tags, ['prod', 'edge node'])
  assert.equal(input.name, 'Beta')
  assert.equal(input.note, 'note')
  assert.equal('address' in normalizeHostAssetInput({
    ...input,
    address: 'must-not-leak',
  } as HostAssetInput & { address: string }), false)
  assert.equal(hostAssetInputsEqual(input, hostAssetToInput(asset)), false)
})

test('主机资产名称边界与排序保持稳定', () => {
  assert.deepEqual(validateHostAssetInput({ ...hostAssetToInput(asset), name: '' }), { name: 'required' })
  assert.deepEqual(validateHostAssetInput({ ...hostAssetToInput(asset), name: '测'.repeat(81) }), { name: 'too_long' })
  assert.deepEqual(sortHostAssets([
    asset,
    { ...asset, id: 'hst_a', name: 'Alpha' },
  ]).map((item) => item.id), ['hst_a', 'hst_b'])
})
