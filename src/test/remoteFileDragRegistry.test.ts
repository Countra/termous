import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beginRemoteFileDrag,
  hasNativeFiles,
  REMOTE_FILE_DRAG_MIME,
  RemoteFileDragRegistry,
  remoteFileDragTransactionId,
  resolveRemoteFileDrag,
  validateRemoteFileDrag,
} from '../features/files/local-download/remoteFileDragRegistry.ts'

function dataTransfer() {
  const values = new Map<string, string>()
  const transfer = {
    effectAllowed: 'uninitialized',
    files: { length: 0 },
    types: [] as string[],
    setData(format: string, value: string) {
      values.set(format, value)
      if (!this.types.includes(format)) {
        this.types.push(format)
      }
    },
    getData(format: string) {
      return values.get(format) ?? ''
    },
  }
  return transfer as unknown as DataTransfer
}

test('DataTransfer 只保存事务 ID，完整多选路径保留在内存注册表', () => {
  let id = 0
  const registry = new RemoteFileDragRegistry({
    createId: () => `drag-${++id}`,
    now: () => 100,
  })
  const transfer = dataTransfer()
  const transaction = beginRemoteFileDrag(transfer, {
    fileSessionId: 'files-1',
    hostId: 'host-1',
    connectionGeneration: 4,
    paths: ['/srv/a', '/srv/b', '/srv/a'],
  }, registry)

  assert.equal(transfer.getData(REMOTE_FILE_DRAG_MIME), 'drag-1')
  assert.equal(transfer.getData(REMOTE_FILE_DRAG_MIME).includes('/srv/a'), false)
  assert.deepEqual(transaction.paths, ['/srv/a', '/srv/b'])
  assert.deepEqual(resolveRemoteFileDrag(transfer, registry)?.paths, ['/srv/a', '/srv/b'])
})

test('单项选择和多项选择均绑定文件会话、主机及连接代际', () => {
  const registry = new RemoteFileDragRegistry({ createId: () => 'drag-1' })
  const transaction = registry.register({
    fileSessionId: 'files-1',
    hostId: 'host-1',
    connectionGeneration: 'generation-2',
    paths: ['/srv/one'],
  })
  const context = {
    connected: true,
    fileSessionId: 'files-1',
    hostId: 'host-1',
    connectionGeneration: 'generation-2',
  }

  assert.equal(validateRemoteFileDrag(transaction, context).ok, true)
  assert.deepEqual(validateRemoteFileDrag(transaction, {
    ...context,
    connectionGeneration: 'generation-3',
  }), {
    ok: false,
    reason: 'connection-generation-mismatch',
  })
  assert.deepEqual(validateRemoteFileDrag(transaction, {
    ...context,
    fileSessionId: 'files-2',
  }), {
    ok: false,
    reason: 'session-mismatch',
  })
})

test('过期事务自动失效并从注册表清理', () => {
  let now = 100
  const registry = new RemoteFileDragRegistry({
    createId: () => 'drag-expiring',
    now: () => now,
    ttlMs: 50,
  })
  const transaction = registry.register({
    fileSessionId: 'files-1',
    hostId: 'host-1',
    connectionGeneration: 1,
    paths: ['/srv/one'],
  })
  now = 151

  assert.equal(registry.resolve(transaction.id), null)
  assert.equal(registry.size, 0)
})

test('原生 Files 拖拽优先拒绝且不能解析远程事务', () => {
  const transfer = dataTransfer()
  transfer.setData(REMOTE_FILE_DRAG_MIME, 'drag-1')
  Object.defineProperty(transfer, 'files', { value: { length: 1 } })
  const registry = new RemoteFileDragRegistry({ createId: () => 'drag-1' })
  registry.register({
    fileSessionId: 'files-1',
    hostId: 'host-1',
    connectionGeneration: 1,
    paths: ['/srv/one'],
  })

  assert.equal(hasNativeFiles(transfer), true)
  assert.equal(remoteFileDragTransactionId(transfer), '')
  assert.equal(resolveRemoteFileDrag(transfer, registry), null)
})
