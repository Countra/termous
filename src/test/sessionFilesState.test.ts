import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDirectoryListing } from '../types/domain.ts'
import {
  applySessionFilesSyncState,
  beginDirectoryRequest,
  completeDirectoryRequest,
  createSessionFilesViewState,
  failDirectoryRequest,
  getSessionFilesViewState,
  removeInactiveSessionFileStates,
  updateSessionFilesViewState,
  type SessionFilesViewStateMap,
} from '../features/workbench/sessionFilesState.ts'

function listing(path: string): RemoteDirectoryListing {
  return {
    host_id: 'host-1',
    file_session_id: 'file-session-1',
    path,
    parent_path: '/',
    entries: [],
    read_at: '2026-07-18T00:00:00Z',
  }
}

test('会话文件状态默认关闭终端跟随并按会话隔离', () => {
  let states: SessionFilesViewStateMap = {}
  states = updateSessionFilesViewState(states, 'session-1', { path: '/srv', followTerminal: true })
  states = updateSessionFilesViewState(states, 'session-2', { path: '/home' })

  assert.equal(getSessionFilesViewState(states, 'session-1').path, '/srv')
  assert.equal(getSessionFilesViewState(states, 'session-1').followTerminal, true)
  assert.equal(getSessionFilesViewState(states, 'session-2').path, '/home')
  assert.equal(getSessionFilesViewState(states, 'session-2').followTerminal, false)
})

test('目录请求只接受最新响应并在失败时保留最后一次列表', () => {
  const initial = {
    ...createSessionFilesViewState('/srv'),
    listing: listing('/srv'),
  }
  const first = beginDirectoryRequest(initial, '/srv/old')
  const second = beginDirectoryRequest(first.state, '/srv/new')
  const stale = completeDirectoryRequest(second.state, first.requestSequence, listing('/srv/old'))
  assert.equal(stale.path, '/srv/new')
  assert.equal(stale.listing?.path, '/srv')

  const failed = failDirectoryRequest(stale, second.requestSequence, '读取失败')
  assert.equal(failed.path, '/srv')
  assert.equal(failed.listing?.path, '/srv')
  assert.equal(failed.error, '读取失败')
})

test('同目录刷新保留仍存在的选择，切换目录时清空选择', () => {
  const currentListing = {
    ...listing('/srv'),
    entries: [
      {
        name: 'keep.txt',
        path: '/srv/keep.txt',
        kind: 'file' as const,
        size: 12,
        mode: '0644',
        modified_at: '2026-07-18T00:00:00Z',
        is_hidden: false,
      },
    ],
  }
  const initial = {
    ...createSessionFilesViewState('/srv'),
    selectedPaths: ['/srv/keep.txt', '/srv/removed.txt'],
    listing: currentListing,
  }

  const refresh = beginDirectoryRequest(initial, '/srv')
  const refreshed = completeDirectoryRequest(
    refresh.state,
    refresh.requestSequence,
    currentListing,
  )
  assert.deepEqual(refreshed.selectedPaths, ['/srv/keep.txt'])

  const navigation = beginDirectoryRequest(refreshed, '/var')
  const navigated = completeDirectoryRequest(
    navigation.state,
    navigation.requestSequence,
    listing('/var'),
  )
  assert.deepEqual(navigated.selectedPaths, [])
})

test('目录请求可以使用调用方同步分配的序号', () => {
  const initial = createSessionFilesViewState('/srv')
  const request = beginDirectoryRequest(initial, '/srv/next', 7)

  assert.equal(request.requestSequence, 7)
  assert.equal(request.state.requestSequence, 7)
  assert.equal(request.state.path, '/srv/next')
})

test('会话关闭后仅保留仍活动的文件视图状态', () => {
  let states: SessionFilesViewStateMap = {}
  states = updateSessionFilesViewState(states, 'session-1', { path: '/one' })
  states = updateSessionFilesViewState(states, 'session-2', { path: '/two' })

  const next = removeInactiveSessionFileStates(states, new Set(['session-2']))
  assert.deepEqual(Object.keys(next), ['session-2'])
})

test('目录同步失败回退到已确认路径并保留最后成功列表', () => {
  const initial = {
    ...createSessionFilesViewState('/srv/current'),
    path: '/srv/pending',
    listing: listing('/srv/current'),
    syncStatus: 'applying' as const,
  }

  const failed = applySessionFilesSyncState(
    initial,
    'failed',
    'shell_busy',
    '/srv/current',
  )

  assert.equal(failed.path, '/srv/current')
  assert.equal(failed.listing?.path, '/srv/current')
  assert.equal(failed.syncStatus, 'failed')
  assert.equal(failed.syncError, 'shell_busy')
})
