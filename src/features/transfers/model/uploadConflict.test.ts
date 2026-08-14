import assert from 'node:assert/strict'
import test from 'node:test'
import type { LocalGrantItem, RemoteFileEntry } from '#entities/file'
import { TermousApiError } from '#shared/api'
import {
  createUploadWithConflictDecision,
  findUploadFileConflicts,
  preflightUploadFileConflicts,
  remapConfirmedOverwriteItemIds,
} from './uploadConflict.ts'

function grant(id: string, items: LocalGrantItem[]) {
  return {
    id,
    source: 'picker' as const,
    items,
    created_at: '2026-08-14T00:00:00Z',
    expires_at: '2026-08-14T00:10:00Z',
  }
}

function localItem(
  name: string,
  kind: LocalGrantItem['kind'] = 'file',
): LocalGrantItem {
  return { id: `local-${name}`, name, kind, size: 128 }
}

function remoteEntry(
  name: string,
  kind: RemoteFileEntry['kind'] = 'file',
): RemoteFileEntry {
  return {
    name,
    path: `/srv/${name}`,
    kind,
    size: 256,
    is_hidden: false,
  }
}

test('上传冲突只匹配本地文件和远端文件的完全同名项', () => {
  const conflicts = findUploadFileConflicts(
    [
      localItem('report.txt'),
      localItem('REPORT.txt'),
      localItem('assets', 'directory'),
      localItem('notes.txt'),
    ],
    [
      remoteEntry('report.txt'),
      remoteEntry('REPORT.TXT'),
      remoteEntry('assets'),
      remoteEntry('notes.txt', 'symlink'),
    ],
  )

  assert.deepEqual(
    conflicts.map(({ incoming, existing }) => [incoming.name, existing.path]),
    [['report.txt', '/srv/report.txt']],
  )
})

test('上传冲突保持本地选择顺序且不修改输入集合', () => {
  const items = [localItem('b.txt'), localItem('a.txt')]
  const entries = [remoteEntry('a.txt'), remoteEntry('b.txt')]

  const conflicts = findUploadFileConflicts(items, entries)

  assert.deepEqual(conflicts.map(({ incoming }) => incoming.name), ['b.txt', 'a.txt'])
  assert.equal(items.length, 2)
  assert.equal(entries.length, 2)
})

test('异步预检拼接目标路径且仅返回远端普通文件冲突', async () => {
  const paths: string[] = []
  const conflicts = await preflightUploadFileConflicts(
    [
      localItem('report.txt'),
      localItem('missing.txt'),
      localItem('remote-directory.txt'),
    ],
    '/srv/releases/',
    async (path) => {
      paths.push(path)
      if (path.endsWith('/missing.txt')) {
        throw new TermousApiError('not found', 'SFTP_PATH_NOT_FOUND', 404)
      }
      if (path.endsWith('/remote-directory.txt')) {
        return remoteEntry('remote-directory.txt', 'directory')
      }
      return remoteEntry('report.txt')
    },
  )

  assert.deepEqual(paths.sort(), [
    '/srv/releases/missing.txt',
    '/srv/releases/remote-directory.txt',
    '/srv/releases/report.txt',
  ])
  assert.deepEqual(conflicts.map(({ incoming }) => incoming.name), ['report.txt'])
})

test('异步预检传播非缺失错误', async () => {
  const failure = new TermousApiError('session closed', 'SFTP_SESSION_CLOSED', 409)

  await assert.rejects(
    preflightUploadFileConflicts(
      [localItem('report.txt')],
      '/srv',
      async () => {
        throw failure
      },
    ),
    (error) => error === failure,
  )
})

test('混合目录或批内重名时仍预检其他可安全覆盖的唯一文件', async () => {
  let statCalls = 0
  const stat = async (path: string) => {
    statCalls += 1
    return remoteEntry(path.slice(path.lastIndexOf('/') + 1))
  }

  const mixedConflicts = await preflightUploadFileConflicts(
    [localItem('report.txt'), localItem('assets', 'directory')],
    '/srv',
    stat,
  )
  const duplicateConflicts = await preflightUploadFileConflicts(
    [localItem('report.txt'), localItem('report.txt'), localItem('notes.txt')],
    '/srv',
    stat,
  )
  const mixedNameConflicts = await preflightUploadFileConflicts(
    [localItem('report.txt'), localItem('report.txt', 'directory'), localItem('notes.txt')],
    '/srv',
    stat,
  )

  assert.deepEqual(mixedConflicts.map(({ incoming }) => incoming.name), ['report.txt'])
  assert.deepEqual(duplicateConflicts.map(({ incoming }) => incoming.name), ['notes.txt'])
  assert.deepEqual(mixedNameConflicts.map(({ incoming }) => incoming.name), ['notes.txt'])
  assert.equal(statCalls, 3)
})

test('异步预检最多并发八个远端 stat 请求并保持输入顺序', async () => {
  const items = Array.from({ length: 10 }, (_, index) => localItem(`${index}.txt`))
  let active = 0
  let maximumActive = 0

  const conflicts = await preflightUploadFileConflicts(items, '/srv', async (path) => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active -= 1
    const name = path.slice(path.lastIndexOf('/') + 1)
    return remoteEntry(name)
  })

  assert.equal(maximumActive, 8)
  assert.deepEqual(
    conflicts.map(({ incoming }) => incoming.name),
    items.map((item) => item.name),
  )
})

test('会话在异步预检期间失效时停止后续请求并静默释放授权', async () => {
  const items = Array.from({ length: 12 }, (_, index) => localItem(`${index}.txt`))
  const released: string[] = []
  const pendingStats: Array<{
    name: string
    resolve: (entry: RemoteFileEntry) => void
    reject: (error: unknown) => void
  }> = []
  let current = true
  let statCalls = 0
  let policyCalls = 0
  let uploadCalls = 0
  let markBatchStarted: (() => void) | undefined
  let markStaleObserved: (() => void) | undefined
  const batchStarted = new Promise<void>((resolve) => { markBatchStarted = resolve })
  const staleObserved = new Promise<void>((resolve) => { markStaleObserved = resolve })

  const pending = createUploadWithConflictDecision({
    source: 'picker',
    paths: items.map((item) => `C:/${item.name}`),
    targetPath: '/srv',
    createGrant: async () => grant('stale-preflight', items),
    releaseGrant: async (id) => { released.push(id) },
    stat: async (path) => {
      statCalls += 1
      if (statCalls === 8) {
        markBatchStarted?.()
      }
      const name = path.slice(path.lastIndexOf('/') + 1)
      return new Promise<RemoteFileEntry>((resolve, reject) => {
        pendingStats.push({ name, resolve, reject })
      })
    },
    requestPolicy: async () => {
      policyCalls += 1
      return 'overwrite'
    },
    isCurrent: () => {
      if (!current) {
        markStaleObserved?.()
      }
      return current
    },
    createUpload: async () => {
      uploadCalls += 1
      return { id: 'unexpected' }
    },
  })

  await batchStarted
  current = false
  pendingStats[0]?.reject(new TermousApiError('old session closed', 'SFTP_SESSION_CLOSED', 409))
  await staleObserved
  current = true
  for (const pendingStat of pendingStats.slice(1)) {
    pendingStat.resolve(remoteEntry(pendingStat.name))
  }

  assert.equal(await pending, null)
  assert.equal(statCalls, 8)
  assert.equal(policyCalls, 0)
  assert.equal(uploadCalls, 0)
  assert.deepEqual(released, ['stale-preflight'])
})

test('刷新本地授权后仅映射用户确认过且未变化的文件项', () => {
  const original = [localItem('report.txt'), localItem('assets', 'directory'), localItem('notes.txt')]
  const refreshed = original.map((item, index) => ({ ...item, id: `refreshed-${index}` }))
  const conflicts = [
    { incoming: original[0]!, existing: remoteEntry('report.txt') },
    { incoming: original[2]!, existing: remoteEntry('notes.txt') },
  ]

  assert.deepEqual(
    remapConfirmedOverwriteItemIds(original, refreshed, conflicts),
    ['refreshed-0', 'refreshed-2'],
  )
  assert.equal(
    remapConfirmedOverwriteItemIds(
      original,
      [{ ...refreshed[0]!, name: 'changed.txt' }, ...refreshed.slice(1)],
      conflicts,
    ),
    null,
  )
})

test('覆盖确认后刷新授权且只把已确认文件标记为覆盖', async () => {
  const originalItems = [localItem('report.txt'), localItem('notes.txt')]
  const refreshedItems = originalItems.map((item, index) => ({ ...item, id: `fresh-${index}` }))
  const grants = [grant('inspect', originalItems), grant('fresh', refreshedItems)]
  const released: string[] = []
  const uploads: Array<{ grantId: string; overwriteItemIds: string[] }> = []

  const result = await createUploadWithConflictDecision({
    source: 'picker',
    paths: ['C:/report.txt', 'C:/notes.txt'],
    targetPath: '/srv',
    createGrant: async () => grants.shift()!,
    releaseGrant: async (id) => { released.push(id) },
    stat: async (path) => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      if (name === 'notes.txt') {
        throw new TermousApiError('not found', 'SFTP_PATH_NOT_FOUND', 404)
      }
      return remoteEntry(name)
    },
    requestPolicy: async () => 'overwrite',
    isCurrent: () => true,
    createUpload: async (grantId, overwriteItemIds) => {
      uploads.push({ grantId, overwriteItemIds })
      return { id: 'transfer' }
    },
  })

  assert.deepEqual(result, { id: 'transfer' })
  assert.deepEqual(released, ['inspect'])
  assert.deepEqual(uploads, [{ grantId: 'fresh', overwriteItemIds: ['fresh-0'] }])
})

test('取消冲突确认会释放检查授权且不创建上传任务', async () => {
  const released: string[] = []
  let uploads = 0

  const result = await createUploadWithConflictDecision({
    source: 'drop',
    paths: ['C:/report.txt'],
    targetPath: '/srv',
    createGrant: async () => grant('inspect', [localItem('report.txt')]),
    releaseGrant: async (id) => { released.push(id) },
    stat: async () => remoteEntry('report.txt'),
    requestPolicy: async () => null,
    isCurrent: () => true,
    createUpload: async () => {
      uploads += 1
      return { id: 'unexpected' }
    },
  })

  assert.equal(result, null)
  assert.deepEqual(released, ['inspect'])
  assert.equal(uploads, 0)
})

test('无冲突时直接消费原授权并保持安全重命名策略', async () => {
  const released: string[] = []
  let grantCreations = 0

  const result = await createUploadWithConflictDecision({
    source: 'clipboard',
    paths: ['C:/report.txt'],
    targetPath: '/srv',
    createGrant: async () => {
      grantCreations += 1
      return grant('direct', [localItem('report.txt')])
    },
    releaseGrant: async (id) => { released.push(id) },
    stat: async () => {
      throw new TermousApiError('not found', 'SFTP_PATH_NOT_FOUND', 404)
    },
    requestPolicy: async ({ conflicts }) => conflicts.length === 0 ? 'rename' : null,
    isCurrent: () => true,
    createUpload: async (grantId, overwriteItemIds) => ({ grantId, overwriteItemIds }),
  })

  assert.deepEqual(result, { grantId: 'direct', overwriteItemIds: [] })
  assert.equal(grantCreations, 1)
  assert.deepEqual(released, [])
})

test('会话在授权创建后失效时释放授权且不再预检或上传', async () => {
  const released: string[] = []
  let statCalls = 0
  let uploadCalls = 0

  const result = await createUploadWithConflictDecision({
    source: 'picker',
    paths: ['C:/report.txt'],
    targetPath: '/srv',
    createGrant: async () => grant('stale', [localItem('report.txt')]),
    releaseGrant: async (id) => { released.push(id) },
    stat: async () => {
      statCalls += 1
      return remoteEntry('report.txt')
    },
    requestPolicy: async () => 'overwrite',
    isCurrent: () => false,
    createUpload: async () => {
      uploadCalls += 1
      return { id: 'unexpected' }
    },
  })

  assert.equal(result, null)
  assert.deepEqual(released, ['stale'])
  assert.equal(statCalls, 0)
  assert.equal(uploadCalls, 0)
})

test('任务创建失败时释放刷新后的授权并保留原始错误', async () => {
  const failure = new Error('create transfer failed')
  const originalItems = [localItem('report.txt')]
  const refreshedItems = [{ ...originalItems[0]!, id: 'fresh-item' }]
  const grants = [grant('inspect', originalItems), grant('fresh', refreshedItems)]
  const released: string[] = []

  await assert.rejects(
    createUploadWithConflictDecision({
      source: 'drop',
      paths: ['C:/report.txt'],
      targetPath: '/srv',
      createGrant: async () => grants.shift()!,
      releaseGrant: async (id) => { released.push(id) },
      stat: async () => remoteEntry('report.txt'),
      requestPolicy: async () => 'overwrite',
      isCurrent: () => true,
      createUpload: async () => { throw failure },
    }),
    (error) => error === failure,
  )
  assert.deepEqual(released, ['inspect', 'fresh'])
})
