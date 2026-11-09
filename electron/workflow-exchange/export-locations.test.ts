import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ExportLocations } from './export-locations.ts'

async function directory(t: test.TestContext) {
  const root = path.resolve('../TEMP/workflow-exchange')
  await mkdir(root, { recursive: true })
  const folder = await mkdtemp(path.join(root, 'export-location-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  return folder
}

test('只打开已登记且属于当前发送方的导出目录，重试不消耗回执', async t => {
  const folder = await directory(t), opened: string[] = []
  const locations = new ExportLocations(async value => { opened.push(value); return '' })
  const id = locations.remember(1, folder)
  await assert.rejects(locations.open(2, id), { code: 'workflow_exchange_location_unavailable' })
  await assert.rejects(locations.open(1, 'unknown'), { code: 'workflow_exchange_location_unavailable' })
  assert.deepEqual(opened, [])
  await locations.open(1, id); await locations.open(1, id)
  assert.deepEqual(opened, [folder, folder])
})

test('目录移动、变成文件及系统打开失败均保留真实错误', async t => {
  const root = await directory(t), folder = path.join(root, '导出目录')
  await mkdir(folder)
  const locations = new ExportLocations(async () => '系统打开失败')
  const id = locations.remember(1, folder)
  await assert.rejects(locations.open(1, id), { code: 'workflow_exchange_directory_open_failed' })
  await rename(folder, path.join(root, '已移动'))
  await assert.rejects(locations.open(1, id), { code: 'workflow_exchange_directory_missing' })
  await writeFile(folder, '已替换为文件')
  await assert.rejects(locations.open(1, id), { code: 'workflow_exchange_directory_missing' })
  const rejected = new ExportLocations(async () => { throw new Error('系统拒绝打开') })
  await assert.rejects(rejected.open(1, rejected.remember(1, root)), { code: 'workflow_exchange_directory_open_failed' })
})

test('原生导出位置有界保留，卸载时释放全部位置', async t => {
  const folder = await directory(t), locations = new ExportLocations(async () => '')
  const first = locations.remember(1, folder)
  let latest = first
  for (let i = 0; i < 32; i++) latest = locations.remember(1, folder)
  await assert.rejects(locations.open(1, first), { code: 'workflow_exchange_location_unavailable' })
  await locations.open(1, latest)
  locations.clear()
  await assert.rejects(locations.open(1, latest), { code: 'workflow_exchange_location_unavailable' })
})
