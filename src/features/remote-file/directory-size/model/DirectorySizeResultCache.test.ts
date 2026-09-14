import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDirectorySize } from '#entities/file'
import {
  DirectorySizeResultCache,
  directorySizeResultCacheLimit,
} from './DirectorySizeResultCache.ts'
import type { DirectorySizeSource } from './types.ts'

function source(
  path: string,
  fileSessionId = 'file-session-1',
  connectionGeneration = 3,
): DirectorySizeSource {
  return {
    fileSessionId,
    connectionGeneration,
    path,
    listingReadAt: '2026-09-14T10:00:00Z',
  }
}

function result(input: DirectorySizeSource, totalBytes: number): RemoteDirectorySize {
  return {
    file_session_id: input.fileSessionId,
    path: input.path,
    total_bytes: totalBytes,
    estimated: false,
    connection_generation: input.connectionGeneration,
    calculated_at: '2026-09-14T10:01:00Z',
    duration_ms: 10,
  }
}

test('每个文件会话最多保留三十条目录大小结果', () => {
  const cache = new DirectorySizeResultCache()
  for (let index = 0; index < directorySizeResultCacheLimit; index += 1) {
    const current = source(`/srv/${index}`)
    cache.set(current, result(current, index))
  }

  const newest = source('/srv/newest')
  cache.set(newest, result(newest, 100))

  assert.equal(cache.peek(source('/srv/0')), undefined)
  assert.equal(cache.peek(source('/srv/1'))?.total_bytes, 1)
  assert.equal(cache.peek(newest)?.total_bytes, 100)
})

test('读取命中和更新已有结果都会提升到队头', () => {
  const cache = new DirectorySizeResultCache()
  for (let index = 0; index < directorySizeResultCacheLimit; index += 1) {
    const current = source(`/srv/${index}`)
    cache.set(current, result(current, index))
  }

  assert.equal(cache.get(source('/srv/0'))?.total_bytes, 0)
  const replacement = source('/srv/1')
  cache.set(replacement, result(replacement, 101))
  const newest = source('/srv/newest')
  cache.set(newest, result(newest, 200))

  assert.equal(cache.peek(source('/srv/2')), undefined)
  assert.equal(cache.peek(source('/srv/0'))?.total_bytes, 0)
  assert.equal(cache.peek(replacement)?.total_bytes, 101)
})

test('不同会话相互隔离且连接代次变化会清除旧结果', () => {
  const cache = new DirectorySizeResultCache()
  const first = source('/srv/data', 'file-session-1', 3)
  const second = source('/srv/data', 'file-session-2', 8)
  cache.set(first, result(first, 10))
  cache.set(second, result(second, 20))

  assert.equal(cache.peek(first)?.total_bytes, 10)
  assert.equal(cache.peek(second)?.total_bytes, 20)
  assert.equal(cache.get(source('/srv/data', 'file-session-1', 4)), undefined)
  assert.equal(cache.peek(first), undefined)
  assert.equal(cache.peek(second)?.total_bytes, 20)
})

test('旧连接代次的迟到访问不会删除或覆盖新结果', () => {
  const cache = new DirectorySizeResultCache()
  const oldSource = source('/srv/data', 'file-session-1', 3)
  const currentSource = source('/srv/data', 'file-session-1', 4)
  cache.set(currentSource, result(currentSource, 40))

  assert.equal(cache.get(oldSource), undefined)
  cache.set(oldSource, result(oldSource, 30))

  assert.equal(cache.peek(currentSource)?.total_bytes, 40)
})

test('会话关闭或不再保留时清除对应缓存', () => {
  const cache = new DirectorySizeResultCache()
  const retained = source('/srv/retained', 'file-session-1', 3)
  const closing = source('/srv/closing', 'file-session-2', 4)
  const removed = source('/srv/removed', 'file-session-3', 5)
  cache.set(retained, result(retained, 10))
  cache.set(closing, result(closing, 20))
  cache.set(removed, result(removed, 30))

  cache.retainSessions([
    { id: 'file-session-1', connectionGeneration: 3, closing: false },
    { id: 'file-session-2', connectionGeneration: 4, closing: true },
  ])

  assert.equal(cache.peek(retained)?.total_bytes, 10)
  assert.equal(cache.peek(closing), undefined)
  assert.equal(cache.peek(removed), undefined)
})
