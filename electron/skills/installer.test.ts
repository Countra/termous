import assert from 'node:assert/strict'
import fs, { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { testAgentSkillBundle } from '../agent/skillBundleTestFixture.ts'
import { AppExitCoordinator } from '../appExitCoordinator.ts'
import { SkillInstaller } from './installer.ts'
import { resolveSkillInstallDirectory } from './installPaths.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'termous-skill-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const base = path.join(root, '用户 项目')
  await mkdir(source)
  await mkdir(base)
  const snapshot = testAgentSkillBundle()
  const installer = new SkillInstaller({ snapshot: async () => snapshot }, source)
  return { root, source, base, snapshot, installer }
}

test('客户端规则区分父目录与自定义目标，预览只读，安装内容来自已校验快照', async (t) => {
  const { base, installer, snapshot } = await fixture(t)
  assert.equal(resolveSkillInstallDirectory(base, 'codex'), path.join(base, '.agents', 'skills'))
  assert.equal(resolveSkillInstallDirectory(base, 'claude-code'), path.join(base, '.claude', 'skills'))
  assert.equal(resolveSkillInstallDirectory(base, 'custom'), base)
  for (const client of ['codex', 'claude-code', 'custom'] as const) {
    const plan = await installer.prepare(base, client, 1)
    assert.equal(plan.skills[0].exists, false)
    if (client === 'codex') assert.deepEqual(await readdir(base), [])
    const result = await installer.install(plan.id, 'skip', 1)
    assert.equal(result.items[0].status, 'installed')
    assert.equal(await readFile(path.join(plan.target_directory, 'termous-test', 'SKILL.md'), 'utf8'), snapshot.resources[0].content)
    assert.deepEqual((await readdir(plan.target_directory)).filter((name) => name.startsWith('.termous-')), [])
    await assert.rejects(installer.install(plan.id, 'replace', 1), /plan_expired/)
  }
})

test('同名默认跳过，显式替换整个 Skill 目录且保留无关目录', async (t) => {
  const { base, installer } = await fixture(t)
  await mkdir(path.join(base, 'termous-test'))
  await writeFile(path.join(base, 'termous-test', 'old.md'), 'local changes')
  await mkdir(path.join(base, 'unrelated-skill'))
  await writeFile(path.join(base, 'unrelated-skill', 'keep.txt'), 'keep')
  let plan = await installer.prepare(base, 'custom', 1)
  assert.equal(plan.skills[0].exists, true)
  assert.equal((await installer.install(plan.id, 'skip', 1)).items[0].status, 'skipped')
  assert.equal(await readFile(path.join(base, 'termous-test', 'old.md'), 'utf8'), 'local changes')
  plan = await installer.prepare(base, 'custom', 1)
  assert.equal((await installer.install(plan.id, 'replace', 1)).items[0].status, 'installed')
  assert.deepEqual(await readdir(path.join(base, 'termous-test')), ['SKILL.md'])
  assert.equal(await readFile(path.join(base, 'unrelated-skill', 'keep.txt'), 'utf8'), 'keep')
})

test('预览后新增的同名目标不会被替换，计划绑定窗口且新预览使旧计划失效', async (t) => {
  const { base, installer } = await fixture(t)
  const first = await installer.prepare(base, 'custom', 1)
  await assert.rejects(installer.install(first.id, 'replace', 2), /plan_expired/)
  const plan = await installer.prepare(base, 'custom', 1)
  await assert.rejects(installer.install(first.id, 'replace', 1), /plan_expired/)
  await mkdir(path.join(base, 'termous-test'))
  await writeFile(path.join(base, 'termous-test', 'concurrent.txt'), 'preserve')
  const result = await installer.install(plan.id, 'replace', 1)
  assert.equal(result.items[0].error, 'target_changed')
  assert.equal(await readFile(path.join(base, 'termous-test', 'concurrent.txt'), 'utf8'), 'preserve')
})

test('拒绝源目录重叠、客户端目录链接和非目录冲突，不产生额外文件', async (t) => {
  const { base, source, installer } = await fixture(t)
  await assert.rejects(installer.prepare(source, 'custom', 1), /unsafe_path/)
  await symlink(source, path.join(base, '.agents'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(installer.prepare(base, 'codex', 1), /unsafe_path/)
  await writeFile(path.join(base, 'termous-test'), 'not a directory')
  await assert.rejects(installer.prepare(base, 'custom', 1), /unsafe_path/)
  assert.deepEqual(await readdir(source), [])
})

test('发布失败恢复原目录，清理失败保留可见的恢复路径', async (t) => {
  const { base, installer } = await fixture(t)
  const target = path.join(base, 'termous-test')
  await mkdir(target)
  await writeFile(path.join(target, 'old.md'), 'keep old')
  let plan = await installer.prepare(base, 'custom', 1)
  const originalRename = fs.rename
  const injected = t.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    if (String(from).endsWith('incoming')) throw Object.assign(new Error('locked'), { code: 'EPERM' })
    return originalRename(from, to)
  })
  const failed = await installer.install(plan.id, 'replace', 1)
  injected.mock.restore()
  assert.equal(failed.items[0].error, 'permission_denied')
  assert.equal(failed.items[0].recovery_path, undefined)
  assert.equal(await readFile(path.join(target, 'old.md'), 'utf8'), 'keep old')
  assert.deepEqual(await readdir(base), ['termous-test'])
  plan = await installer.prepare(base, 'custom', 1)
  const cleanup = t.mock.method(fs, 'rm', async () => { throw new Error('cleanup failure') })
  const result = await installer.install(plan.id, 'replace', 1)
  cleanup.mock.restore()
  assert.equal(result.items[0].status, 'installed')
  assert.equal(result.items[0].error, 'cleanup_failed')
  assert.equal(await readFile(path.join(result.items[0].recovery_path!, 'previous', 'old.md'), 'utf8'), 'keep old')
})

test('恢复目标被外部占用时保留备份，不覆盖新内容', async (t) => {
  const { base, installer } = await fixture(t)
  const target = path.join(base, 'termous-test')
  await mkdir(target)
  await writeFile(path.join(target, 'old.md'), 'old')
  const plan = await installer.prepare(base, 'custom', 1)
  const originalRename = fs.rename
  const injected = t.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    if (String(from).endsWith('incoming')) {
      await mkdir(target)
      await writeFile(path.join(target, 'external.md'), 'external')
      throw new Error('concurrent writer')
    }
    return originalRename(from, to)
  })
  const result = await installer.install(plan.id, 'replace', 1)
  injected.mock.restore()
  assert.equal(result.items[0].status, 'failed')
  assert.equal(result.items[0].error, 'recovery_failed')
  assert.equal(await readFile(path.join(result.items[0].recovery_path!, 'previous', 'old.md'), 'utf8'), 'old')
  assert.equal(await readFile(path.join(target, 'external.md'), 'utf8'), 'external')
})

test('源包失败时不修改目标，过期计划不可安装', async (t) => {
  const { base, source, installer } = await fixture(t)
  const broken = new SkillInstaller({ snapshot: async () => { throw new Error('bad integrity') } }, source)
  await assert.rejects(broken.prepare(base, 'custom', 1), /bundle_unavailable/)
  assert.deepEqual(await readdir(base), [])
  const plan = await installer.prepare(base, 'custom', 1)
  t.mock.method(Date, 'now', () => Number.MAX_SAFE_INTEGER)
  await assert.rejects(installer.install(plan.id, 'skip', 1), /plan_expired/)
})

test('备份原目录失败时不移除旧内容并清理本次暂存', async (t) => {
  const { base, installer } = await fixture(t)
  const target = path.join(base, 'termous-test')
  await mkdir(target)
  await writeFile(path.join(target, 'old.md'), 'keep old')
  const plan = await installer.prepare(base, 'custom', 1)
  const originalRename = fs.rename
  const injected = t.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    if (String(from) === target) throw Object.assign(new Error('locked'), { code: 'EPERM' })
    return originalRename(from, to)
  })
  const result = await installer.install(plan.id, 'replace', 1)
  injected.mock.restore()
  assert.equal(result.items[0].error, 'permission_denied')
  assert.equal(result.items[0].recovery_path, undefined)
  assert.equal(await readFile(path.join(target, 'old.md'), 'utf8'), 'keep old')
  assert.deepEqual(await readdir(base), ['termous-test'])
})

test('应用退出等待发布失败后的恢复完成，恢复服务后必须重新预览', async (t) => {
  const { base, installer } = await fixture(t)
  const target = path.join(base, 'termous-test')
  await mkdir(target)
  await writeFile(path.join(target, 'old.md'), 'keep old')
  const plan = await installer.prepare(base, 'custom', 1)
  const publishing = deferred()
  const release = deferred()
  t.after(() => release.resolve())
  const originalRename = fs.rename
  const injected = t.mock.method(fs, 'rename', async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
    if (String(from).endsWith('incoming')) {
      publishing.resolve()
      await release.promise
      throw new Error('publish failure')
    }
    return originalRename(from, to)
  })
  const installing = installer.install(plan.id, 'replace', 1)
  await publishing.promise
  let quit = false
  const coordinator = new AppExitCoordinator({
    shutdownCore: async () => { await installer.suspend(); return true },
    prepareForExit: () => undefined,
    closeAllWindows: () => undefined,
    quitApplication: () => { quit = true },
  })
  const exiting = coordinator.requestApplicationExit('main_window')
  await assert.rejects(installer.prepare(base, 'custom', 1), /busy/)
  await assert.rejects(installer.install(plan.id, 'skip', 1), /busy/)
  assert.equal(quit, false)
  release.resolve()
  assert.equal((await installing).items[0].status, 'failed')
  await exiting
  injected.mock.restore()
  assert.equal(quit, true)
  assert.equal(await readFile(path.join(target, 'old.md'), 'utf8'), 'keep old')
  assert.deepEqual(await readdir(base), ['termous-test'])
  await assert.rejects(installer.prepare(base, 'custom', 1), /busy/)
  installer.resume()
  await assert.rejects(installer.install(plan.id, 'skip', 1), /plan_expired/)
  const next = await installer.prepare(base, 'custom', 1)
  assert.equal((await installer.install(next.id, 'replace', 1)).items[0].status, 'installed')
})

test('暂停期间完成的只读预览失效，不产生文件且恢复后可重新选择', async (t) => {
  const { base, source, snapshot } = await fixture(t)
  const read = deferred()
  t.after(() => read.resolve())
  const installer = new SkillInstaller({ snapshot: async () => { await read.promise; return snapshot } }, source)
  const preparing = installer.prepare(base, 'codex', 1)
  const suspended = installer.suspend()
  read.resolve()
  const plan = await preparing
  await suspended
  assert.deepEqual(await readdir(base), [])
  installer.resume()
  await assert.rejects(installer.install(plan.id, 'skip', 1), /plan_expired/)
  const next = await installer.prepare(base, 'codex', 1)
  assert.equal((await installer.install(next.id, 'skip', 1)).items[0].status, 'installed')
})
