import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  RemoteDirectoryListing,
  RemoteFileEntry,
} from '../types/domain.ts'
import {
  applyFilesWorkspaceSelection,
  beginFilesWorkspaceHistoryNavigation,
  beginFilesWorkspaceNavigation,
  beginFilesWorkspaceRefresh,
  canStartFilesWorkspaceDirectoryLoad,
  cancelFilesWorkspaceDirectoryRequest,
  clearFilesWorkspaceSelection,
  completeFilesWorkspaceDirectoryRequest,
  createRemoteDirectoryViewState,
  defaultFilesWorkspaceLayoutPreferences,
  failFilesWorkspaceDirectoryRequest,
  filesWorkspaceLayoutStorageKey,
  getFilesWorkspaceHistoryTarget,
  getFilesWorkspaceSessionState,
  isActiveFilesWorkspaceDirectoryResult,
  parseFilesWorkspaceLayoutPreferences,
  removeFilesWorkspaceSessionState,
  resolveFilesWorkspaceAutomaticDirectoryRequest,
  resolveFilesWorkspaceSortState,
  retainFilesWorkspaceSessionStates,
  serializeFilesWorkspaceLayoutPreferences,
  setFilesWorkspaceDirectoryStatus,
  setFilesWorkspaceScrollTop,
  setFilesWorkspaceSessionState,
  setFilesWorkspaceSortState,
  sortFilesWorkspaceEntries,
  type FilesWorkspaceRuntimeState,
  type RemoteDirectoryViewState,
} from '../widgets/files-workspace/model/filesWorkspaceState.ts'

function entry(
  name: string,
  kind: RemoteFileEntry['kind'] = 'file',
  overrides: Partial<RemoteFileEntry> = {},
): RemoteFileEntry {
  return {
    name,
    path: `/srv/${name}`,
    kind,
    size: 10,
    is_hidden: false,
    ...overrides,
  }
}

function listing(
  path: string,
  entries: RemoteFileEntry[] = [],
): RemoteDirectoryListing {
  return {
    host_id: 'host-1',
    file_session_id: 'files-1',
    path,
    parent_path: path === '/' ? '/' : '/',
    entries,
    read_at: '2026-07-23T00:00:00Z',
  }
}

function loadedState(
  path = '/srv',
  entries: RemoteFileEntry[] = [
    entry('alpha.txt'),
    entry('beta.txt'),
    entry('gamma.txt'),
  ],
) {
  const initial = createRemoteDirectoryViewState('/')
  const request = beginFilesWorkspaceNavigation(initial, path)
  return completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing(path, entries),
    1_000,
  )
}

test('恢复事务对账完成前不会消费 connected 会话的首次目录加载', () => {
  assert.equal(canStartFilesWorkspaceDirectoryLoad('connected', true), false)
  assert.equal(canStartFilesWorkspaceDirectoryLoad('connected', false), true)
  assert.equal(canStartFilesWorkspaceDirectoryLoad('disconnected', false), false)
})

test('每个文件会话拥有独立缓存且切换读取不会串状态', () => {
  let states: FilesWorkspaceRuntimeState = {}
  const first = loadedState('/srv/first')
  const second = loadedState('/srv/second')
  states = setFilesWorkspaceSessionState(states, 'files-1', first)
  states = setFilesWorkspaceSessionState(states, 'files-2', second)

  assert.equal(getFilesWorkspaceSessionState(states, 'files-1').committedPath, '/srv/first')
  assert.equal(getFilesWorkspaceSessionState(states, 'files-2').committedPath, '/srv/second')
  assert.notEqual(states['files-1'], states['files-2'])
})

test('首次加载、目录导航和刷新具有不同状态并保留已提交列表', () => {
  const initial = createRemoteDirectoryViewState('/')
  const first = beginFilesWorkspaceNavigation(initial, '/srv')
  assert.equal(first.state.directoryStatus, 'initial_loading')
  assert.equal(first.state.pendingPath, '/srv')
  assert.equal(first.state.committedPath, '/')

  const current = completeFilesWorkspaceDirectoryRequest(
    first.state,
    first.requestSequence,
    listing('/srv', [entry('alpha.txt')]),
    100,
  )
  const navigation = beginFilesWorkspaceNavigation(current, '/var')
  assert.equal(navigation.state.directoryStatus, 'navigating')
  assert.equal(navigation.state.committedPath, '/srv')
  assert.equal(navigation.state.listing, current.listing)

  const refresh = beginFilesWorkspaceRefresh(current)
  assert.equal(refresh.state.directoryStatus, 'refreshing')
  assert.equal(refresh.state.pendingPath, '/srv')
  assert.equal(refresh.state.listing, current.listing)
})

test('只有最新 requestSequence 能提交或失败', () => {
  const initial = loadedState('/srv')
  const first = beginFilesWorkspaceNavigation(initial, '/one')
  const second = beginFilesWorkspaceNavigation(first.state, '/two')
  const lateComplete = completeFilesWorkspaceDirectoryRequest(
    second.state,
    first.requestSequence,
    listing('/one'),
    200,
  )
  const lateFailure = failFilesWorkspaceDirectoryRequest(
    second.state,
    first.requestSequence,
    '旧请求失败',
  )

  assert.equal(lateComplete, second.state)
  assert.equal(lateFailure, second.state)
  assert.equal(second.state.pendingPath, '/two')

  const completed = completeFilesWorkspaceDirectoryRequest(
    second.state,
    second.requestSequence,
    listing('/two'),
    300,
  )
  assert.equal(completed.committedPath, '/two')
  assert.equal(completed.directoryStatus, 'idle')
  assert.equal(completed.lastLoadedAt, 300)
})

test('目录结果只有仍属于当前活动连接代际时才能驱动页面行为', () => {
  const requestSession = {
    id: 'files-1',
    connection_generation: 4,
  }
  const currentSession = {
    id: 'files-1',
    status: 'connected' as const,
    connection_generation: 4,
  }

  assert.equal(
    isActiveFilesWorkspaceDirectoryResult(requestSession, 'files-1', currentSession),
    true,
  )
  assert.equal(
    isActiveFilesWorkspaceDirectoryResult(requestSession, 'files-2', currentSession),
    false,
  )
  assert.equal(
    isActiveFilesWorkspaceDirectoryResult(requestSession, 'files-1', {
      ...currentSession,
      connection_generation: 5,
    }),
    false,
  )
  assert.equal(
    isActiveFilesWorkspaceDirectoryResult(requestSession, 'files-1', {
      ...currentSession,
      status: 'disconnected',
    }),
    false,
  )
})

test('新连接代际不会把旧连接的目录缓存视为新鲜', () => {
  const request = beginFilesWorkspaceNavigation(createRemoteDirectoryViewState('/'), '/srv')
  const cached = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/srv'),
    9_500,
    3,
  )
  assert.equal(cached.listingConnectionGeneration, 3)
  assert.equal(
    resolveFilesWorkspaceAutomaticDirectoryRequest(
      cached,
      '/srv',
      10_000,
      5_000,
      false,
      3,
    ),
    null,
  )
  assert.deepEqual(
    resolveFilesWorkspaceAutomaticDirectoryRequest(
      cached,
      '/srv',
      10_000,
      5_000,
      false,
      4,
    ),
    {
      path: '/srv',
      kind: 'refresh',
    },
  )
})

test('导航失败恢复已提交目录、列表、历史、选择和滚动', () => {
  const current = {
    ...applyFilesWorkspaceSelection(
      loadedState('/srv'),
      ['/srv/alpha.txt', '/srv/beta.txt', '/srv/gamma.txt'],
      '/srv/beta.txt',
    ),
    scrollTop: 320,
  }
  const request = beginFilesWorkspaceNavigation(current, '/forbidden')
  const failed = failFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    '权限不足',
  )

  assert.equal(failed.committedPath, '/srv')
  assert.equal(failed.pendingPath, null)
  assert.equal(failed.listing, current.listing)
  assert.deepEqual(failed.history, current.history)
  assert.deepEqual(failed.selectedPaths, ['/srv/beta.txt'])
  assert.equal(failed.scrollTop, 320)
  assert.equal(failed.directoryStatus, 'failed')
  assert.equal(failed.error, '权限不足')
  assert.deepEqual(failed.failedRequest, {
    path: '/forbidden',
    kind: 'navigate',
    historyMode: 'push',
    historyIndex: null,
  })
})

test('目录失败请求保存在会话状态中并可在页面重挂载后按原目标重试', () => {
  const current = loadedState('/srv')
  const request = beginFilesWorkspaceNavigation(current, '/forbidden')
  const failed = failFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    '权限不足',
  )

  // 页面卸载后 provider 会继续保存该会话状态；重新挂载只需读取失败请求即可重试。
  const restoredAfterRemount = failed
  assert.deepEqual(restoredAfterRemount.failedRequest, {
    path: '/forbidden',
    kind: 'navigate',
    historyMode: 'push',
    historyIndex: null,
  })

  const failedRequest = restoredAfterRemount.failedRequest
  assert.ok(failedRequest)
  assert.equal(
    resolveFilesWorkspaceAutomaticDirectoryRequest(
      restoredAfterRemount,
      '/srv',
      10_000,
      5_000,
      true,
    ),
    null,
  )
  const offline = setFilesWorkspaceDirectoryStatus(
    restoredAfterRemount,
    'offline',
    '连接已断开',
  )
  assert.deepEqual(
    resolveFilesWorkspaceAutomaticDirectoryRequest(
      offline,
      '/srv',
      10_000,
      5_000,
      true,
    ),
    {
      path: '/srv',
      kind: 'refresh',
    },
  )
  const retry = beginFilesWorkspaceNavigation(
    restoredAfterRemount,
    failedRequest.path,
    {
      historyMode: failedRequest.historyMode,
      historyIndex: failedRequest.historyIndex ?? undefined,
    },
  )
  assert.equal(retry.state.pendingPath, '/forbidden')
  assert.equal(retry.state.failedRequest, null)

  const completed = completeFilesWorkspaceDirectoryRequest(
    retry.state,
    retry.requestSequence,
    listing('/forbidden'),
    2_000,
  )
  assert.equal(completed.failedRequest, null)
})

test('导航成功清理选择和滚动，刷新成功只清理已消失条目', () => {
  const paths = ['/srv/alpha.txt', '/srv/beta.txt', '/srv/gamma.txt']
  const selected = {
    ...applyFilesWorkspaceSelection(
      applyFilesWorkspaceSelection(loadedState('/srv'), paths, paths[0]),
      paths,
      paths[1],
      { ctrlKey: true },
    ),
    scrollTop: 240,
  }
  const refresh = beginFilesWorkspaceRefresh(selected)
  const refreshed = completeFilesWorkspaceDirectoryRequest(
    refresh.state,
    refresh.requestSequence,
    listing('/srv', [entry('beta.txt'), entry('gamma.txt')]),
    2_000,
  )
  assert.deepEqual(refreshed.selectedPaths, ['/srv/beta.txt'])
  assert.equal(refreshed.focusedPath, '/srv/beta.txt')
  assert.equal(refreshed.anchorPath, '/srv/beta.txt')
  assert.equal(refreshed.scrollTop, 240)

  const navigation = beginFilesWorkspaceNavigation(refreshed, '/var')
  const navigated = completeFilesWorkspaceDirectoryRequest(
    navigation.state,
    navigation.requestSequence,
    listing('/var'),
    3_000,
  )
  assert.deepEqual(navigated.selectedPaths, [])
  assert.equal(navigated.focusedPath, null)
  assert.equal(navigated.anchorPath, null)
  assert.equal(navigated.scrollTop, 0)
})

test('历史后退和前进只在请求成功后移动游标，失败不改变历史', () => {
  let state = loadedState('/srv')
  let request = beginFilesWorkspaceNavigation(state, '/var')
  state = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/var'),
    2_000,
  )
  request = beginFilesWorkspaceNavigation(state, '/tmp')
  state = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/tmp'),
    3_000,
  )
  assert.deepEqual(state.history, ['/', '/srv', '/var', '/tmp'])
  assert.deepEqual(getFilesWorkspaceHistoryTarget(state, 'back'), {
    path: '/var',
    historyIndex: 2,
  })

  const back = beginFilesWorkspaceHistoryNavigation(state, 2)
  assert.ok(back)
  assert.equal(back.state.historyIndex, 3)
  const failed = failFilesWorkspaceDirectoryRequest(
    back.state,
    back.requestSequence,
    '失败',
  )
  assert.equal(failed.historyIndex, 3)

  const retried = beginFilesWorkspaceHistoryNavigation(failed, 2)
  assert.ok(retried)
  const backed = completeFilesWorkspaceDirectoryRequest(
    retried.state,
    retried.requestSequence,
    listing('/var'),
    4_000,
  )
  assert.equal(backed.historyIndex, 2)
  assert.deepEqual(getFilesWorkspaceHistoryTarget(backed, 'forward'), {
    path: '/tmp',
    historyIndex: 3,
  })
})

test('从历史中间导航新路径会截断前进分支', () => {
  let state = loadedState('/srv')
  let request = beginFilesWorkspaceNavigation(state, '/var')
  state = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/var'),
    2,
  )
  const back = beginFilesWorkspaceHistoryNavigation(state, 1)
  assert.ok(back)
  state = completeFilesWorkspaceDirectoryRequest(
    back.state,
    back.requestSequence,
    listing('/srv'),
    3,
  )
  request = beginFilesWorkspaceNavigation(state, '/opt')
  state = completeFilesWorkspaceDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/opt'),
    4,
  )

  assert.deepEqual(state.history, ['/', '/srv', '/opt'])
  assert.equal(getFilesWorkspaceHistoryTarget(state, 'forward'), null)
})

test('取消请求递增序号并使迟到响应失效', () => {
  const request = beginFilesWorkspaceNavigation(loadedState('/srv'), '/tmp')
  const canceled = cancelFilesWorkspaceDirectoryRequest(request.state)
  assert.equal(canceled.requestSequence, request.requestSequence + 1)
  assert.equal(canceled.pendingPath, null)
  assert.equal(canceled.directoryStatus, 'idle')
  assert.equal(
    completeFilesWorkspaceDirectoryRequest(
      canceled,
      request.requestSequence,
      listing('/tmp'),
      4,
    ),
    canceled,
  )
})

test('普通点击替换选择，Ctrl 和 Meta 点击切换单项', () => {
  const paths = ['/a', '/b', '/c']
  let state = createRemoteDirectoryViewState('/')
  state = applyFilesWorkspaceSelection(state, paths, '/a')
  assert.deepEqual(state.selectedPaths, ['/a'])
  assert.equal(state.focusedPath, '/a')
  assert.equal(state.anchorPath, '/a')

  state = applyFilesWorkspaceSelection(state, paths, '/c', { ctrlKey: true })
  assert.deepEqual(state.selectedPaths, ['/a', '/c'])
  state = applyFilesWorkspaceSelection(state, paths, '/a', { metaKey: true })
  assert.deepEqual(state.selectedPaths, ['/c'])
  assert.equal(state.focusedPath, '/a')
  assert.equal(state.anchorPath, '/a')
})

test('Shift 选择连续范围，Ctrl+Shift 合并既有选择', () => {
  const paths = ['/a', '/b', '/c', '/d', '/e']
  let state = applyFilesWorkspaceSelection(
    createRemoteDirectoryViewState('/'),
    paths,
    '/b',
  )
  state = applyFilesWorkspaceSelection(state, paths, '/d', { shiftKey: true })
  assert.deepEqual(state.selectedPaths, ['/b', '/c', '/d'])
  assert.equal(state.anchorPath, '/b')

  state = applyFilesWorkspaceSelection(state, paths, '/a')
  state = applyFilesWorkspaceSelection(state, paths, '/e', { ctrlKey: true })
  state = applyFilesWorkspaceSelection(state, paths, '/c', {
    ctrlKey: true,
    shiftKey: true,
  })
  assert.deepEqual(state.selectedPaths, ['/a', '/c', '/d', '/e'])
})

test('右键已选项保留整组，右键未选项改为单选', () => {
  const paths = ['/a', '/b', '/c']
  let state = applyFilesWorkspaceSelection(
    createRemoteDirectoryViewState('/'),
    paths,
    '/a',
  )
  state = applyFilesWorkspaceSelection(state, paths, '/b', { ctrlKey: true })
  state = applyFilesWorkspaceSelection(state, paths, '/a', { contextMenu: true })
  assert.deepEqual(state.selectedPaths, ['/a', '/b'])
  assert.equal(state.focusedPath, '/a')

  state = applyFilesWorkspaceSelection(state, paths, '/c', { contextMenu: true })
  assert.deepEqual(state.selectedPaths, ['/c'])
  assert.equal(state.anchorPath, '/c')
})

test('Escape 清空选择但保留键盘焦点', () => {
  const state = applyFilesWorkspaceSelection(
    createRemoteDirectoryViewState('/'),
    ['/a', '/b'],
    '/b',
  )
  const cleared = clearFilesWorkspaceSelection(state)
  assert.deepEqual(cleared.selectedPaths, [])
  assert.equal(cleared.anchorPath, null)
  assert.equal(cleared.focusedPath, '/b')
})

test('会话关闭和 retain 会清理对应内存状态', () => {
  const states = {
    first: loadedState('/first'),
    second: loadedState('/second'),
    third: loadedState('/third'),
  }
  const removed = removeFilesWorkspaceSessionState(states, 'second')
  assert.deepEqual(Object.keys(removed).sort(), ['first', 'third'])
  assert.equal(removeFilesWorkspaceSessionState(removed, 'unknown'), removed)

  const retained = retainFilesWorkspaceSessionStates(
    states,
    new Set(['second']),
  )
  assert.deepEqual(Object.keys(retained), ['second'])
})

test('离线、恢复和关闭状态保留最后成功列表并使在途请求失效', () => {
  const request = beginFilesWorkspaceNavigation(loadedState('/srv'), '/tmp')
  const offline = setFilesWorkspaceDirectoryStatus(
    request.state,
    'offline',
    '连接已断开',
  )
  assert.equal(offline.directoryStatus, 'offline')
  assert.equal(offline.committedPath, '/srv')
  assert.ok(offline.listing)
  assert.equal(offline.requestSequence, request.requestSequence + 1)
  assert.equal(offline.error, '连接已断开')

  const recovering = setFilesWorkspaceDirectoryStatus(offline, 'recovering')
  assert.equal(recovering.directoryStatus, 'recovering')
  const closing = setFilesWorkspaceDirectoryStatus(recovering, 'closing')
  assert.equal(closing.directoryStatus, 'closing')
})

test('滚动和排序状态更新保持纯函数与稳定引用', () => {
  const initial = createRemoteDirectoryViewState('/')
  assert.deepEqual(initial.sortState, {
    key: null,
    direction: null,
  })
  const scrolled = setFilesWorkspaceScrollTop(initial, 124.6)
  assert.equal(scrolled.scrollTop, 124.6)
  assert.equal(setFilesWorkspaceScrollTop(scrolled, 124.6), scrolled)
  assert.equal(setFilesWorkspaceScrollTop(scrolled, -10).scrollTop, 0)

  const sorted = setFilesWorkspaceSortState(initial, {
    key: 'size',
    direction: 'descending',
  })
  assert.deepEqual(sorted.sortState, {
    key: 'size',
    direction: 'descending',
  })
  assert.equal(setFilesWorkspaceSortState(sorted, sorted.sortState), sorted)
})

test('未启用排序时保留服务端顺序且不修改原数组', () => {
  const entries = [
    entry('large.txt', 'file', { size: 100 }),
    entry('z-dir', 'directory', { size: 0 }),
    entry('small.txt', 'file', { size: 10 }),
  ]
  const sorted = sortFilesWorkspaceEntries(entries, {
    key: null,
    direction: null,
  })
  assert.deepEqual(sorted.map((item) => item.name), [
    'large.txt',
    'z-dir',
    'small.txt',
  ])
  assert.notEqual(sorted, entries)
})

test('主动排序后目录优先且文件按指定字段排序', () => {
  const entries = [
    entry('large.txt', 'file', { size: 100 }),
    entry('z-dir', 'directory', { size: 0 }),
    entry('small.txt', 'file', { size: 10 }),
    entry('a-dir', 'directory', { size: 0 }),
  ]
  assert.deepEqual(
    sortFilesWorkspaceEntries(entries, {
      key: 'size',
      direction: 'descending',
    }).map((item) => item.name),
    ['a-dir', 'z-dir', 'large.txt', 'small.txt'],
  )
  assert.deepEqual(entries.map((item) => item.name), [
    'large.txt',
    'z-dir',
    'small.txt',
    'a-dir',
  ])
})

test('表头三态排序可在第三次点击后恢复未排序状态', () => {
  assert.deepEqual(resolveFilesWorkspaceSortState('name', 'ascend'), {
    key: 'name',
    direction: 'ascending',
  })
  assert.deepEqual(resolveFilesWorkspaceSortState('name', 'descend'), {
    key: 'name',
    direction: 'descending',
  })
  assert.deepEqual(resolveFilesWorkspaceSortState('name', undefined), {
    key: null,
    direction: null,
  })
})

test('布局偏好使用无版本 key，非法内容安全回落且尺寸有界', () => {
  assert.equal(filesWorkspaceLayoutStorageKey, 'termous.ui.files.workspace')
  assert.deepEqual(
    parseFilesWorkspaceLayoutPreferences('not-json'),
    defaultFilesWorkspaceLayoutPreferences,
  )
  const parsed = parseFilesWorkspaceLayoutPreferences(JSON.stringify({
    bookmarkRailExpanded: false,
    locationsPanelOpen: true,
    inspectorOpen: 'yes',
    transfersDockOpen: true,
    inspectorWidth: 999,
    bookmarkSidebarWidth: 999,
    bottomDrawerHeight: 100,
    columnWidths: {
      name: 10,
      size: 144.4,
      modifiedAt: Number.NaN,
      permissions: 260,
    },
    committedPath: '/should-not-be-restored',
  }))
  assert.deepEqual(parsed, {
    bookmarkRailExpanded: false,
    sidePanelWidth: 440,
    bottomDrawerHeight: 260,
    columnWidths: {
      name: 180,
      size: 144,
      modifiedAt: 140,
      permissions: 180,
    },
  })
  assert.equal('committedPath' in parsed, false)
  assert.equal('locationsPanelOpen' in parsed, false)
  assert.equal('inspectorOpen' in parsed, false)
  assert.equal('transfersDockOpen' in parsed, false)
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({ transferDockHeight: 999 }),
    ).bottomDrawerHeight,
    420,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({ transferDockHeight: 180 }),
    ).bottomDrawerHeight,
    260,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({ sidePanelWidth: 100 }),
    ).sidePanelWidth,
    300,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({ sidePanelWidth: 999 }),
    ).sidePanelWidth,
    440,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({
        inspectorWidth: 400,
        bookmarkSidebarWidth: 352,
        bottomDrawerHeight: 320,
        columnWidths: {
          name: 500,
          size: 100,
          modifiedAt: 150,
          permissions: 110,
        },
      }),
    ).sidePanelWidth,
    400,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({
        inspectorWidth: 352,
        bookmarkSidebarWidth: 416,
      }),
    ).sidePanelWidth,
    416,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({
        inspectorWidth: 400,
        bookmarkSidebarWidth: 416,
      }),
    ).sidePanelWidth,
    416,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({
        sidePanelWidth: 388,
        inspectorWidth: 400,
        bookmarkSidebarWidth: 416,
      }),
    ).sidePanelWidth,
    388,
  )
  assert.equal(
    parseFilesWorkspaceLayoutPreferences(
      JSON.stringify({
        sidePanelWidth: 'invalid',
        inspectorWidth: 404,
      }),
    ).sidePanelWidth,
    404,
  )
})

test('旧版默认列宽迁移到紧凑值且保留用户自定义列宽', () => {
  assert.deepEqual(
    parseFilesWorkspaceLayoutPreferences(JSON.stringify({
      columnWidths: {
        name: 420,
        size: 120,
        modifiedAt: 180,
        permissions: 120,
      },
    })).columnWidths,
    defaultFilesWorkspaceLayoutPreferences.columnWidths,
  )
  assert.deepEqual(
    parseFilesWorkspaceLayoutPreferences(JSON.stringify({
      columnWidths: {
        name: 430,
        size: 118,
        modifiedAt: 176,
        permissions: 116,
      },
    })).columnWidths,
    {
      name: 430,
      size: 118,
      modifiedAt: 176,
      permissions: 116,
    },
  )
})

test('布局偏好序列化只输出受支持字段并可稳定往返', () => {
  const preferences = {
    ...defaultFilesWorkspaceLayoutPreferences,
    bookmarkRailExpanded: false,
    sidePanelWidth: 416,
    bottomDrawerHeight: 360,
    columnWidths: {
      ...defaultFilesWorkspaceLayoutPreferences.columnWidths,
      name: 500,
    },
  }
  const serialized = serializeFilesWorkspaceLayoutPreferences(preferences)
  assert.deepEqual(
    parseFilesWorkspaceLayoutPreferences(serialized),
    preferences,
  )
  assert.equal(
    serializeFilesWorkspaceLayoutPreferences(
      parseFilesWorkspaceLayoutPreferences(serialized),
    ),
    serialized,
  )
  assert.equal(serialized.includes('committedPath'), false)
  assert.equal(serialized.includes('inspectorWidth'), false)
  assert.equal(serialized.includes('bookmarkSidebarWidth'), false)
})

test('初始状态包含规划要求的完整会话视图字段', () => {
  const state: RemoteDirectoryViewState = createRemoteDirectoryViewState('/root/../srv')
  assert.deepEqual(state, {
    committedPath: '/srv',
    pendingPath: null,
    listing: null,
    focusedPath: null,
    selectedPaths: [],
    anchorPath: null,
    history: ['/srv'],
    historyIndex: 0,
    scrollTop: 0,
    sortState: {
      key: null,
      direction: null,
    },
    directoryStatus: 'idle',
    requestSequence: 0,
    error: '',
    lastLoadedAt: null,
    listingConnectionGeneration: null,
    activeRequest: null,
    failedRequest: null,
  })
})
