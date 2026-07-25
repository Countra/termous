import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import {
  applyUpdatePreferencesPatch,
  createDefaultUpdatePreferences,
  recordSuccessfulUpdateCheck,
  resolveAutomaticUpdateSchedule,
  UpdatePreferencesStore,
  UpdatePreferencesValidationError,
  validateUpdatePreferencesPatch,
} from './updatePreferences.ts'

test('更新偏好默认每天自动检查且不自动下载', () => {
  assert.deepEqual(createDefaultUpdatePreferences(), {
    automatic_check: true,
    check_interval: 'daily',
    automatic_download: false,
    last_checked_at: null,
    revision: 0,
  })
})

test('偏好补丁严格校验并只在有效变化时递增序号', () => {
  const initial = createDefaultUpdatePreferences()
  const unchanged = applyUpdatePreferencesPatch(initial, {
    automatic_check: true,
  })
  const changed = applyUpdatePreferencesPatch(initial, {
    automatic_check: false,
    automatic_download: true,
  })

  assert.equal(unchanged.revision, 0)
  assert.equal(changed.revision, 1)
  assert.equal(changed.automatic_check, false)
  assert.equal(changed.automatic_download, true)
  assert.throws(
    () => validateUpdatePreferencesPatch({ automatic_check: 'yes' }),
    UpdatePreferencesValidationError,
  )
  assert.throws(
    () => validateUpdatePreferencesPatch({ feed_url: 'https://example.com' }),
    UpdatePreferencesValidationError,
  )
})

test('自动检查调度区分启动、每天、每周和禁用状态', () => {
  const now = Date.parse('2026-07-25T00:00:00.000Z')
  const defaults = createDefaultUpdatePreferences()

  assert.deepEqual(
    resolveAutomaticUpdateSchedule(defaults, {
      now,
      checked_this_launch: false,
    }),
    {
      due: true,
      next_check_at: '2026-07-25T00:00:00.000Z',
    },
  )

  const checked = recordSuccessfulUpdateCheck(defaults, '2026-07-25T00:00:00Z')
  assert.deepEqual(
    resolveAutomaticUpdateSchedule(checked, {
      now: now + 60_000,
      checked_this_launch: true,
    }),
    {
      due: false,
      next_check_at: '2026-07-26T00:00:00.000Z',
    },
  )
  assert.equal(
    resolveAutomaticUpdateSchedule(checked, {
      now: now + 24 * 60 * 60 * 1000,
      checked_this_launch: true,
    }).due,
    true,
  )

  const startup = applyUpdatePreferencesPatch(defaults, { check_interval: 'startup' })
  assert.equal(
    resolveAutomaticUpdateSchedule(startup, {
      now,
      checked_this_launch: false,
    }).due,
    true,
  )
  assert.deepEqual(
    resolveAutomaticUpdateSchedule(startup, {
      now,
      checked_this_launch: true,
    }),
    { due: false, next_check_at: null },
  )

  const disabled = applyUpdatePreferencesPatch(defaults, { automatic_check: false })
  assert.deepEqual(
    resolveAutomaticUpdateSchedule(disabled, {
      now,
      checked_this_launch: false,
    }),
    { due: false, next_check_at: null },
  )
})

test('损坏偏好文件回退默认值且后续写入使用原子替换', async () => {
  const fixtureRoot = path.join(process.cwd(), '.tmp-update-preferences-corrupt')
  const filePath = path.join(fixtureRoot, 'update-preferences.json')
  await rm(fixtureRoot, { recursive: true, force: true })
  await mkdir(fixtureRoot, { recursive: true })
  await writeFile(filePath, '{broken json', 'utf8')

  try {
    const store = new UpdatePreferencesStore(filePath)
    assert.deepEqual(await store.load(), createDefaultUpdatePreferences())

    const saved = await store.update({
      automatic_check: false,
      automatic_download: true,
    })
    assert.equal(saved.revision, 1)

    const persisted = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
    assert.equal(persisted.schema_version, 1)
    assert.equal(persisted.automatic_check, false)
    assert.equal(persisted.automatic_download, true)
    assert.deepEqual(
      await new UpdatePreferencesStore(filePath).load(),
      saved,
    )
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('并发偏好写入串行合并且不会丢失较早字段', async () => {
  const fixtureRoot = path.join(process.cwd(), '.tmp-update-preferences-concurrent')
  const filePath = path.join(fixtureRoot, 'update-preferences.json')
  await rm(fixtureRoot, { recursive: true, force: true })

  try {
    const store = new UpdatePreferencesStore(filePath)
    const [first, second] = await Promise.all([
      store.update({ automatic_check: false }),
      store.update({ automatic_download: true }),
    ])

    assert.equal(first.revision, 1)
    assert.equal(second.revision, 2)
    assert.deepEqual(store.getSnapshot(), {
      automatic_check: false,
      check_interval: 'daily',
      automatic_download: true,
      last_checked_at: null,
      revision: 2,
    })
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})
