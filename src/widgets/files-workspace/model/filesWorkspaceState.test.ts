import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDirectoryListing } from '#entities/file'
import {
  beginFilesWorkspaceNavigation,
  beginFilesWorkspaceRefresh,
  completeFilesWorkspaceDirectoryRequest,
  createRemoteDirectoryViewState,
} from './filesWorkspaceState.ts'

function listing(path: string, entries: RemoteDirectoryListing['entries']): RemoteDirectoryListing {
  return {
    host_id: 'host-1',
    file_session_id: 'file-session-1',
    path,
    parent_path: path === '/' ? '/' : '/',
    entries,
    read_at: '2026-08-22T00:00:00Z',
  }
}

test('目录定位只在目标仍存在时提交选择和焦点', () => {
  const request = beginFilesWorkspaceNavigation(
    createRemoteDirectoryViewState('/'),
    '/srv',
    { revealPath: '/srv/report.txt' },
  )
  const completed = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/srv', [{
      name: 'report.txt',
      path: '/srv/report.txt',
      kind: 'file',
      size: 42,
      is_hidden: false,
    }]),
    100,
    3,
  )

  assert.equal(completed.focusedPath, '/srv/report.txt')
  assert.deepEqual(completed.selectedPaths, ['/srv/report.txt'])
  assert.equal(completed.anchorPath, '/srv/report.txt')
})

test('定位目标在目录加载期间消失时仍完成导航但不保留幽灵选择', () => {
  const request = beginFilesWorkspaceNavigation(
    createRemoteDirectoryViewState('/'),
    '/srv',
    { revealPath: '/srv/missing.txt' },
  )
  const completed = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/srv', []),
    100,
    3,
  )

  assert.equal(completed.committedPath, '/srv')
  assert.equal(completed.focusedPath, null)
  assert.deepEqual(completed.selectedPaths, [])
  assert.equal(completed.anchorPath, null)
})

test('刷新当前目录时同样可以提交定位目标', () => {
  const state = {
    ...createRemoteDirectoryViewState('/srv'),
    committedPath: '/srv',
    listing: listing('/srv', []),
  }
  const request = beginFilesWorkspaceRefresh(state, {
    revealPath: '/srv/current.log',
  })
  const completed = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/srv', [{
      name: 'current.log',
      path: '/srv/current.log',
      kind: 'file',
      size: 3,
      is_hidden: false,
    }]),
    100,
    3,
  )

  assert.equal(completed.focusedPath, '/srv/current.log')
  assert.deepEqual(completed.selectedPaths, ['/srv/current.log'])
})

test('导航到当前目录定位目标时不重复写入历史', () => {
  const state = {
    ...createRemoteDirectoryViewState('/srv'),
    committedPath: '/srv',
    history: ['/', '/srv'],
    historyIndex: 1,
    listing: listing('/srv', []),
  }
  const request = beginFilesWorkspaceNavigation(state, '/srv', {
    revealPath: '/srv/current.log',
  })
  const completed = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/srv', [{
      name: 'current.log',
      path: '/srv/current.log',
      kind: 'file',
      size: 3,
      is_hidden: false,
    }]),
    100,
    3,
  )

  assert.deepEqual(completed.history, ['/', '/srv'])
  assert.equal(completed.historyIndex, 1)
  assert.equal(completed.focusedPath, '/srv/current.log')
})

test('普通导航保持清空选择且迟到结果不能提交定位目标', () => {
  const initial = {
    ...createRemoteDirectoryViewState('/'),
    focusedPath: '/old.txt',
    selectedPaths: ['/old.txt'],
    anchorPath: '/old.txt',
  }
  const first = beginFilesWorkspaceNavigation(initial, '/first', {
    revealPath: '/first/result.txt',
  })
  const second = beginFilesWorkspaceNavigation(first.state, '/second')
  const ignored = completeFilesWorkspaceDirectoryRequest(
    second.state,
    first.requestSequence,
    listing('/first', [{
      name: 'result.txt',
      path: '/first/result.txt',
      kind: 'file',
      size: 1,
      is_hidden: false,
    }]),
    100,
    3,
  )

  assert.equal(ignored, second.state)

  const completed = completeFilesWorkspaceDirectoryRequest(
    second.state,
    second.requestSequence,
    listing('/second', []),
    101,
    3,
  )
  assert.equal(completed.focusedPath, null)
  assert.deepEqual(completed.selectedPaths, [])
})
