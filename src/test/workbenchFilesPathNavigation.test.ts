import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveWorkbenchFilesPathNavigationAction,
  resolveWorkbenchFilesPathNavigationTarget,
} from '../features/workbench/workbenchFilesPathNavigation.ts'
import type { RemoteFileEntry } from '../types/domain.ts'

test('目录路径直接进入，文件路径进入父目录', () => {
  assert.deepEqual(
    resolveWorkbenchFilesPathNavigationTarget({
      path: '/srv/app/',
      kind: 'directory',
    } as RemoteFileEntry),
    {
      directoryPath: '/srv/app',
    },
  )
  assert.deepEqual(
    resolveWorkbenchFilesPathNavigationTarget({
      path: '/srv/app/config.json',
      kind: 'file',
    } as RemoteFileEntry),
    {
      directoryPath: '/srv/app',
    },
  )
  assert.deepEqual(
    resolveWorkbenchFilesPathNavigationTarget({
      path: '/readme.txt',
      kind: 'file',
    } as RemoteFileEntry),
    {
      directoryPath: '/',
    },
  )
})

test('拒绝远端返回的非法路径', () => {
  assert.equal(
    resolveWorkbenchFilesPathNavigationTarget({
      path: 'relative/file.txt',
      kind: 'file',
    } as RemoteFileEntry),
    null,
  )
})

test('路径导航只触发一轮文件会话恢复并等待连接就绪', () => {
  assert.equal(resolveWorkbenchFilesPathNavigationAction({
    fileSessionStatus: 'disconnected',
    recoveryCanRetry: true,
    recoveryBusy: false,
    recoveryAttempted: false,
  }), 'recover')
  assert.equal(resolveWorkbenchFilesPathNavigationAction({
    fileSessionStatus: 'connecting',
    recoveryCanRetry: false,
    recoveryBusy: true,
    recoveryAttempted: true,
  }), 'wait')
  assert.equal(resolveWorkbenchFilesPathNavigationAction({
    fileSessionStatus: 'failed',
    recoveryCanRetry: true,
    recoveryBusy: false,
    recoveryAttempted: true,
  }), 'fail')
  assert.equal(resolveWorkbenchFilesPathNavigationAction({
    fileSessionStatus: 'connected',
    recoveryCanRetry: false,
    recoveryBusy: false,
    recoveryAttempted: true,
  }), 'navigate')
})
