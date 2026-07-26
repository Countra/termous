import assert from 'node:assert/strict'
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareUpdateSimulationDirectories } from './updateSimulationFilesystem.ts'

test('模拟运行目录只允许规范隔离目录和已知报告', async () => {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'termous-update-simulation-root-'),
  )
  const root = path.join(parent, 'run')
  try {
    const prepared = prepareUpdateSimulationDirectories(root)
    assert.equal(prepared.root, root)
    assert.equal(
      prepared.cacheRoot,
      path.join(root, 'cache-root'),
    )
    const staleCache = path.join(prepared.cacheRoot, 'stale-installer.exe')
    await writeFile(staleCache, 'stale')
    await writeFile(path.join(root, 'acceptance-report.json'), '{}\n')
    const staleReportTemporary = path.join(
      root,
      'acceptance-report.json.tmp-1234-7a5a348d-585d-4cba-8e20-4998f7195f4d',
    )
    await writeFile(staleReportTemporary, '{}\n')
    prepareUpdateSimulationDirectories(root)
    await assert.rejects(stat(staleCache), { code: 'ENOENT' })
    await assert.rejects(
      stat(path.join(root, 'acceptance-report.json')),
      { code: 'ENOENT' },
    )
    await assert.rejects(stat(staleReportTemporary), { code: 'ENOENT' })

    await writeFile(path.join(root, 'unexpected.txt'), 'blocked')
    assert.throws(
      () => prepareUpdateSimulationDirectories(root),
      /未知条目/,
    )
  } finally {
    await rm(parent, { force: true, recursive: true })
  }
})

test('模拟运行目录拒绝伪装成报告临时文件的目录', async () => {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'termous-update-simulation-report-entry-'),
  )
  const root = path.join(parent, 'run')
  try {
    prepareUpdateSimulationDirectories(root)
    await mkdir(path.join(
      root,
      'acceptance-report.json.tmp-4321-0e993c4c-e5e6-4eb7-a518-85e35a27dc71',
    ))
    assert.throws(
      () => prepareUpdateSimulationDirectories(root),
      /临时条目不是普通文件/,
    )
  } finally {
    await rm(parent, { force: true, recursive: true })
  }
})

test('模拟运行根目录拒绝符号链接或目录联接', async () => {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), 'termous-update-simulation-link-'),
  )
  const target = path.join(parent, 'target')
  const linked = path.join(parent, 'linked')
  try {
    prepareUpdateSimulationDirectories(target)
    await symlink(
      target,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    assert.throws(
      () => prepareUpdateSimulationDirectories(linked),
      /不是普通目录|路径别名/,
    )
  } finally {
    await rm(parent, { force: true, recursive: true })
  }
})
