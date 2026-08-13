import assert from 'node:assert/strict'
import test from 'node:test'
import {
  remoteFileActionDescriptors,
  runRemoteFileAction,
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

test('文件操作菜单仅对普通文件提供打开入口', () => {
  assert.deepEqual(
    remoteFileActionDescriptors(fileEntry).map((item) => item.key),
    ['openFile', 'download', 'copy', 'cut', 'permissions', 'rename', 'delete'],
  )
  assert.deepEqual(
    remoteFileActionDescriptors(directoryEntry).map((item) => item.key),
    ['download', 'copy', 'cut', 'permissions', 'rename', 'delete'],
  )
})

test('共享分发器只执行已知文件动作', () => {
  const calls: string[] = []
  const handler = (entry: RemoteFileEntry) => calls.push(entry.path)
  const handlers: RemoteFileActionHandlers = {
    openFile: handler,
    download: handler,
    copy: handler,
    cut: handler,
    permissions: handler,
    rename: handler,
    delete: handler,
  }

  assert.equal(runRemoteFileAction(fileEntry, 'download', handlers), true)
  assert.equal(runRemoteFileAction(fileEntry, 'unknown', handlers), false)
  assert.deepEqual(calls, ['/config/app.conf'])
})
