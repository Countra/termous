import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canCommitFilesBookmarkManagementRequest,
  consumeFilesBookmarkManagementIntent,
  type FilesBookmarkManagementIntent,
  type FilesBookmarkManagementRequest,
} from '../pages/files/model/filesBookmarkManagementIntent.ts'
import type { Session } from '../types/domain.ts'

test('匹配的书签管理意图只消费一次', () => {
  const intent: FilesBookmarkManagementIntent = {
    requestId: 3,
    fileSessionId: 'file-session-1',
  }

  assert.equal(consumeFilesBookmarkManagementIntent(intent, 3), null)
})

test('迟到消费不会清除更新的书签管理意图', () => {
  const intent: FilesBookmarkManagementIntent = {
    requestId: 4,
    fileSessionId: 'file-session-2',
  }

  assert.equal(consumeFilesBookmarkManagementIntent(intent, 3), intent)
  assert.equal(consumeFilesBookmarkManagementIntent(null, 3), null)
})

const request: FilesBookmarkManagementRequest = {
  requestId: 5,
  sourceSessionId: 'ssh-session-1',
  hostId: 'host-1',
}

const connectedSession = {
  id: 'ssh-session-1',
  host_id: 'host-1',
  kind: 'ssh',
  status: 'connected',
} as Session

test('只有最新且来源仍有效的书签管理请求可以提交', () => {
  assert.equal(
    canCommitFilesBookmarkManagementRequest(
      request,
      request,
      true,
      [connectedSession],
    ),
    true,
  )
  assert.equal(
    canCommitFilesBookmarkManagementRequest(
      request,
      { ...request, requestId: 6 },
      true,
      [connectedSession],
    ),
    false,
  )
  assert.equal(
    canCommitFilesBookmarkManagementRequest(
      request,
      request,
      false,
      [connectedSession],
    ),
    false,
  )
})

test('来源 SSH 断开或主机不匹配时拒绝迟到的管理请求', () => {
  assert.equal(
    canCommitFilesBookmarkManagementRequest(
      request,
      request,
      true,
      [{ ...connectedSession, status: 'disconnected' } as Session],
    ),
    false,
  )
  assert.equal(
    canCommitFilesBookmarkManagementRequest(
      request,
      request,
      true,
      [{ ...connectedSession, host_id: 'host-2' } as Session],
    ),
    false,
  )
})
