import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatRemoteFilePathsForClipboard,
  remoteFileActionDescriptors,
  runRemoteFileAction,
  snapshotRemoteFileActionSelection,
  type RemoteFileActionHandlers,
} from './remoteFileActions.ts'
import type { RemoteFileEntry } from '#entities/file'

const directoryEntry: RemoteFileEntry = {
  name: 'config',
  path: '/config',
  kind: 'directory',
  size: 0,
  is_hidden: false,
}

const fileEntry: RemoteFileEntry = {
  ...directoryEntry,
  name: 'app.conf',
  path: '/config/app.conf',
  kind: 'file',
}

const symlinkEntry: RemoteFileEntry = {
  ...fileEntry,
  name: 'app-link',
  path: '/config/app-link',
  kind: 'symlink',
}

const otherEntry: RemoteFileEntry = {
  ...fileEntry,
  name: 'app.sock',
  path: '/config/app.sock',
  kind: 'other',
}

test('文件操作菜单仅对普通文件提供打开入口', () => {
  assert.deepEqual(
    remoteFileActionDescriptors(fileEntry).map((item) => item.key),
    ['openFile', 'download', 'sendToHost', 'copy', 'cut', 'copyAbsolutePath', 'rename', 'advancedRename', 'permissions', 'delete'],
  )
  assert.deepEqual(
    remoteFileActionDescriptors(directoryEntry).map((item) => item.key),
    ['download', 'sendToHost', 'copy', 'cut', 'copyAbsolutePath', 'rename', 'advancedRename', 'permissions', 'delete'],
  )
  assert.deepEqual(
    remoteFileActionDescriptors(symlinkEntry).map((item) => item.key),
    ['download', 'sendToHost', 'copy', 'cut', 'copyAbsolutePath', 'rename', 'advancedRename', 'permissions', 'delete'],
  )
  assert.deepEqual(
    remoteFileActionDescriptors(otherEntry).map((item) => item.key),
    ['download', 'sendToHost', 'copy', 'cut', 'copyAbsolutePath', 'rename', 'permissions', 'delete'],
  )
})

test('共享分发器只执行已知文件动作', () => {
  const calls: string[] = []
  const handler = (entry: RemoteFileEntry) => calls.push(entry.path)
  const handlers: RemoteFileActionHandlers = {
    openFile: handler,
    download: handler,
    sendToHost: handler,
    copy: handler,
    cut: handler,
    copyAbsolutePath: handler,
    permissions: handler,
    rename: handler,
    advancedRename: handler,
    delete: handler,
  }

  assert.equal(runRemoteFileAction(fileEntry, 'download', handlers), true)
  assert.equal(runRemoteFileAction(fileEntry, 'copyAbsolutePath', handlers), true)
  assert.equal(runRemoteFileAction(fileEntry, 'unknown', handlers), false)
  assert.deepEqual(calls, ['/config/app.conf', '/config/app.conf'])
})

test('发送到其他主机动作只调用对应处理器', () => {
  const calls: string[] = []
  const ignored = () => assert.fail('不应调用其他文件动作')
  const handlers: RemoteFileActionHandlers = {
    openFile: ignored,
    download: ignored,
    sendToHost: (entry) => calls.push(entry.path),
    copy: ignored,
    cut: ignored,
    copyAbsolutePath: ignored,
    permissions: ignored,
    rename: ignored,
    advancedRename: ignored,
    delete: ignored,
  }

  assert.equal(runRemoteFileAction(fileEntry, 'sendToHost', handlers), true)
  assert.deepEqual(calls, ['/config/app.conf'])
})

test('右键点击已选条目时冻结完整多选快照', () => {
  const secondEntry: RemoteFileEntry = {
    ...fileEntry,
    name: 'app.env',
    path: '/config/app.env',
  }
  const snapshot = snapshotRemoteFileActionSelection(
    secondEntry,
    [fileEntry.path, secondEntry.path],
    [fileEntry, secondEntry],
  )

  assert.deepEqual(snapshot?.paths, [fileEntry.path, secondEntry.path])
  assert.deepEqual(snapshot?.entries, [fileEntry, secondEntry])
  assert.notEqual(snapshot?.entries[0], fileEntry)
  assert.notEqual(snapshot?.entries[1], secondEntry)
})

test('右键点击未选条目时只冻结点击项且拒绝陈旧选择', () => {
  assert.deepEqual(
    snapshotRemoteFileActionSelection(fileEntry, [directoryEntry.path], [fileEntry, directoryEntry]),
    { paths: [fileEntry.path], entries: [{ ...fileEntry }] },
  )
  assert.equal(
    snapshotRemoteFileActionSelection(fileEntry, [fileEntry.path, '/missing'], [fileEntry]),
    null,
  )
})

test('复制绝对路径时按选择顺序逐行保留原始路径', () => {
  assert.equal(
    formatRemoteFilePathsForClipboard(['/srv/应用 配置', '/var/log/app.log']),
    '/srv/应用 配置\n/var/log/app.log',
  )
})
