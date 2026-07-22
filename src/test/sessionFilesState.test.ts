import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  RemoteDirectoryListing,
  SessionCwdState,
} from '../types/domain.ts'
import {
  adoptSessionFilesCwdRefreshPending,
  applySessionFilesCwdRefreshDispatch,
  applySessionFilesSyncState,
  beginSessionFilesCwdRefresh,
  beginDirectoryRequest,
  cancelDirectoryRequest,
  cancelDirectoryRequestForFollowRefresh,
  completeDirectoryRequest,
  createSessionFilesCwdRefreshWatchdogDeadline,
  createSessionFilesViewState,
  deriveRejectedSessionFilesSyncState,
  deriveSessionFilesCwdRefreshSuccessState,
  deriveSessionFilesFollowSyncState,
  deriveSessionFilesSyncState,
  finishSessionFilesCwdRefresh,
  failDirectoryRequest,
  getSessionFilesNavigationState,
  getSessionFilesViewState,
  isSessionFilesCwdRefreshComplete,
  removeInactiveSessionFileStates,
  scheduleSessionFilesCwdLocalRetry,
  scheduleSessionFilesCwdRefreshRetry,
  sessionFilesCwdRefreshRetryDelay,
  sessionFilesCwdRefreshTransportDisposition,
  sessionFilesCwdRefreshWatchdogRemaining,
  shouldRefreshFollowedDirectory,
  shouldRequestInitialSessionFilesDirectory,
  shouldRequestFollowedDirectory,
  sessionFilesViewStatesReducer,
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

function cwdState(overrides: Partial<SessionCwdState> = {}): SessionCwdState {
  return {
    state_seq: 1,
    refresh_seq: 0,
    revision: 0,
    source: 'none',
    capability: 'supported',
    shell_phase: 'prompt',
    prompt_generation: 1,
    source_generation: 1,
    ...overrides,
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

test('初始目录自动加载只服务未开启跟随的空闲文件区', () => {
  const initial = createSessionFilesViewState('/root')
  assert.equal(shouldRequestInitialSessionFilesDirectory(initial), true)
  assert.equal(shouldRequestInitialSessionFilesDirectory({
    ...initial,
    followTerminal: true,
  }), false)
  assert.equal(shouldRequestInitialSessionFilesDirectory({
    ...initial,
    followTerminal: true,
    syncStatus: 'queued',
    path: '/srv/pending',
  }), false)
  assert.equal(shouldRequestInitialSessionFilesDirectory({
    ...initial,
    loading: true,
  }), false)
  assert.equal(shouldRequestInitialSessionFilesDirectory({
    ...initial,
    error: '读取失败',
  }), false)
})

test('目录跟随状态区分能力准备、路径定位和就绪', () => {
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({ capability: 'probing', capability_cause: '正在准备' }),
    null,
  ), {
    status: 'preparing',
    error: '正在准备',
  })
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({
      capability: 'probing',
      capability_cause: '正在等待终端提示符',
      shell_phase: 'running',
    }),
    null,
  ), {
    status: 'waiting-idle',
    error: '正在等待终端提示符',
  })
  assert.deepEqual(deriveSessionFilesSyncState(cwdState(), null), {
    status: 'locating',
    error: '',
  })
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({ confirmed_path: '/srv' }),
    null,
  ), {
    status: '',
    error: '',
  })
})

test('新控制状态在准备和降级期间保持可恢复且只在明确终态提示不支持', () => {
  for (const control_status of ['inactive', 'preparing', 'degraded'] as const) {
    assert.deepEqual(deriveSessionFilesSyncState(
      cwdState({
        capability: 'probing',
        control_status,
        control_code: 'CWD_NOT_READY',
        capability_cause: '目录控制仍在准备',
        observation_status: 'ready',
        confirmed_path: '/srv',
      }),
      null,
    ), {
      status: 'preparing',
      error: '目录控制仍在准备',
    })
  }
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({
      capability: 'unsupported',
      control_status: 'unsupported',
      capability_cause: '当前终端不可控制',
    }),
    null,
  ), {
    status: 'unsupported',
    error: '当前终端不可控制',
  })
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({
      capability: 'unsupported',
      control_status: 'reconnect_required',
      capability_cause: '组件已安装',
    }),
    null,
  ), {
    status: 'reconnect-required',
    error: '组件已安装',
  })
})

test('开启跟随在单一会话 reducer 中保留最后列表并建立固定事务', () => {
  const current = {
    ...createSessionFilesViewState('/srv/current'),
    listing: listing('/srv/current'),
  }
  const started = beginSessionFilesCwdRefresh(
    current,
    cwdState({ confirmed_path: '/srv/terminal', refresh_seq: 7, source_generation: 9 }),
    1_000,
  )
  assert.equal(started.listing, current.listing)
  assert.equal(started.followTerminal, true)
  assert.equal(started.followGeneration, 1)
  assert.deepEqual(started.cwdRefresh, {
    phase: 'waiting',
    requestId: '',
    baseRefreshSequence: 7,
    baseConfirmedPath: '/srv/terminal',
    baseSourceGeneration: 9,
    startedAt: 1_000,
    deadlineAt: 66_000,
    retryCount: 0,
    retryAt: 0,
    error: '',
  })

  const states = sessionFilesViewStatesReducer({}, {
    type: 'update',
    sessionId: 'session-1',
    update: started,
  })
  const finished = sessionFilesViewStatesReducer(states, {
    type: 'update',
    sessionId: 'session-1',
    update: (state) => finishSessionFilesCwdRefresh(state),
  })
  assert.equal(finished['session-1']?.cwdRefresh.phase, 'idle')
  assert.equal(finished['session-1']?.listing, current.listing)
})

test('目录刷新只接受 refresh sequence 前进的服务端确认', () => {
  const flight = {
    baseRefreshSequence: 4,
    baseConfirmedPath: '/root',
  }

  assert.equal(isSessionFilesCwdRefreshComplete(
    cwdState({ refresh_seq: 4, confirmed_path: '/root' }),
    flight,
  ), false)
  assert.equal(isSessionFilesCwdRefreshComplete(
    cwdState({ refresh_seq: 5, confirmed_path: '/root' }),
    flight,
  ), true)
  assert.equal(isSessionFilesCwdRefreshComplete(
    cwdState({ refresh_seq: 4, confirmed_path: '/srv' }),
    flight,
  ), true)
  assert.equal(isSessionFilesCwdRefreshComplete(
    cwdState({ refresh_seq: 4, confirmed_path: '/root' }),
    { ...flight, baseConfirmedPath: '' },
  ), true)
  assert.equal(isSessionFilesCwdRefreshComplete(
    cwdState({ refresh_seq: 4, confirmed_path: 'root' }),
    { ...flight, baseConfirmedPath: '' },
  ), false)
})

test('新服务端目录刷新只接受完全匹配的 request id 成功终态', () => {
  const baseline = {
    requestId: 'refresh-current',
    baseRefreshSequence: 4,
    baseConfirmedPath: '/root',
  }
  assert.equal(isSessionFilesCwdRefreshComplete(cwdState({
    refresh_request_id: 'refresh-current',
    refresh_status: 'pending',
    refresh_seq: 5,
  }), baseline), false)
  assert.equal(isSessionFilesCwdRefreshComplete(cwdState({
    refresh_request_id: 'refresh-stale',
    refresh_status: 'succeeded',
    refresh_seq: 5,
  }), baseline), false)
  assert.equal(isSessionFilesCwdRefreshComplete(cwdState({
    refresh_request_id: 'refresh-current',
    refresh_status: 'failed',
    refresh_seq: 5,
  }), baseline), false)
  assert.equal(isSessionFilesCwdRefreshComplete(cwdState({
    refresh_request_id: 'refresh-current',
    refresh_status: 'succeeded',
    refresh_seq: 5,
  }), baseline), true)
})

test('目录刷新确认清理历史失败且保留新的在途操作', () => {
  const failed = cwdState({
    confirmed_path: '/root',
    desired_path: '/srv/failed',
    pending_operation: {
      id: 'operation-failed',
      file_session_id: 'file-session-1',
      path: '/srv/failed',
      revision: 1,
      status: 'failed',
      error: '历史失败',
    },
  })
  assert.deepEqual(deriveSessionFilesCwdRefreshSuccessState(failed), {
    status: '',
    error: '',
  })

  const applying = cwdState({
    confirmed_path: '/root',
    desired_path: '/srv/next',
    pending_operation: {
      id: 'operation-applying',
      file_session_id: 'file-session-1',
      path: '/srv/next',
      revision: 1,
      status: 'applying',
    },
  })
  assert.deepEqual(deriveSessionFilesCwdRefreshSuccessState(applying), {
    status: 'applying',
    error: '',
  })

  assert.deepEqual(deriveSessionFilesFollowSyncState(
    applying,
    null,
    '历史刷新失败',
    false,
    false,
    'ready',
  ), {
    status: 'applying',
    error: '',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    failed,
    null,
    '历史刷新失败',
    false,
    true,
    'ready',
  ), {
    status: '',
    error: '',
  })
})

test('目录刷新阶段按能力、操作、错误和 transport 状态稳定派生', () => {
  const ready = cwdState({ confirmed_path: '/root' })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    { ...ready, capability: 'unsupported', capability_cause: '不支持当前终端' },
    null,
    '',
    true,
    false,
    'ready',
  ), {
    status: 'unsupported',
    error: '不支持当前终端',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    { ...ready, capability: 'probing' },
    null,
    '',
    true,
    false,
    'ready',
  ), {
    status: 'preparing',
    error: '',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    {
      ...ready,
      capability: 'probing',
      capability_cause: '正在等待终端提示符',
      shell_phase: 'running',
    },
    null,
    '',
    true,
    false,
    'ready',
  ), {
    status: 'waiting-idle',
    error: '正在等待终端提示符',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    ready,
    null,
    '',
    true,
    false,
    'wait',
  ), {
    status: 'preparing',
    error: '',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    { ...ready, shell_phase: 'running' },
    null,
    '',
    true,
    false,
    'ready',
  ), {
    status: 'waiting-idle',
    error: '',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    ready,
    null,
    '',
    true,
    false,
    'ready',
  ), {
    status: 'locating',
    error: '',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    ready,
    null,
    '',
    true,
    false,
    'failed',
  ), {
    status: 'failed',
    error: 'cwd_refresh_transport_unavailable',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    ready,
    null,
    '历史刷新失败',
    false,
    false,
    'ready',
  ), {
    status: 'failed',
    error: '历史刷新失败',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    ready,
    null,
    '',
    false,
    false,
    'ready',
  ), {
    status: '',
    error: '',
  })
})

test('目录刷新 pending 时不可恢复 transport 结束探测且不覆盖权威不支持状态', () => {
  const probing = cwdState({
    capability: 'probing',
    capability_cause: '正在准备目录跟随',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    probing,
    null,
    '',
    true,
    false,
    'failed',
  ), {
    status: 'failed',
    error: 'cwd_refresh_transport_unavailable',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    probing,
    null,
    'cwd_refresh_transport_unavailable',
    false,
    false,
    'failed',
  ), {
    status: 'failed',
    error: 'cwd_refresh_transport_unavailable',
  })
  assert.deepEqual(deriveSessionFilesFollowSyncState(
    cwdState({
      capability: 'unsupported',
      capability_cause: '当前 Shell 不支持目录跟随',
    }),
    null,
    '',
    true,
    false,
    'failed',
  ), {
    status: 'unsupported',
    error: '当前 Shell 不支持目录跟随',
  })
})

test('明确不支持和探测状态优先于遗留请求错误', () => {
  const requestError = {
    code: 'CWD_CHANGE_FAILED',
    message: '旧请求失败',
  }
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({
      capability: 'unsupported',
      capability_cause: 'Shell 不受支持',
    }),
    requestError,
  ), {
    status: 'unsupported',
    error: 'Shell 不受支持',
  })
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({ capability: 'probing' }),
    requestError,
  ), {
    status: 'preparing',
    error: '',
  })
})

test('服务端待处理操作优先于请求错误并保留阶段', () => {
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({
      pending_operation: {
        id: 'operation-1',
        file_session_id: 'file-session-1',
        path: '/srv/next',
        revision: 1,
        status: 'waiting-idle',
      },
    }),
    {
      code: 'CWD_CHANGE_FAILED',
      message: '旧请求失败',
    },
  ), {
    status: 'waiting-idle',
    error: '',
  })
})

test('传输暂不可用保持可恢复状态，其他请求错误才标记失败', () => {
  for (const code of ['CWD_NOT_READY', 'terminal_not_ready']) {
    assert.deepEqual(deriveSessionFilesSyncState(
      cwdState({ confirmed_path: '/srv' }),
      { code, message: '稍后重试' },
    ), {
      status: 'not_ready',
      error: '稍后重试',
    })
  }
  assert.deepEqual(deriveSessionFilesSyncState(
    cwdState({ confirmed_path: '/srv' }),
    { code: 'CWD_CHANGE_FAILED', message: '切换失败' },
  ), {
    status: 'failed',
    error: '切换失败',
  })
})

test('探测期目录操作被拒绝时保持准备状态而不是误报连接恢复', () => {
  assert.deepEqual(deriveRejectedSessionFilesSyncState(
    'not_ready',
    cwdState({ capability: 'probing', capability_cause: '正在准备' }),
  ), {
    status: 'preparing',
    error: '正在准备',
  })
  assert.deepEqual(deriveRejectedSessionFilesSyncState(
    'not_ready',
    cwdState({ confirmed_path: '/srv' }),
  ), {
    status: 'not_ready',
    error: '',
  })
})

test('目录刷新仅在开启跟随且终端进入可控提示符后调度一次', () => {
  const ready = cwdState({ confirmed_path: '/srv' })
  assert.equal(shouldRefreshFollowedDirectory(true, ready, true), true)
  assert.equal(shouldRefreshFollowedDirectory(true, ready, false), false)
  assert.equal(shouldRefreshFollowedDirectory(false, ready, true), false)
  assert.equal(shouldRefreshFollowedDirectory(
    true,
    { ...ready, capability: 'probing' },
    true,
  ), false)
  assert.equal(shouldRefreshFollowedDirectory(
    true,
    { ...ready, shell_phase: 'running' },
    true,
  ), false)
  assert.equal(shouldRefreshFollowedDirectory(
    true,
    {
      ...ready,
      pending_operation: {
        id: 'operation-1',
        file_session_id: 'file-session-1',
        path: '/srv/next',
        revision: 1,
        status: 'queued',
      },
    },
    true,
  ), false)
  assert.equal(shouldRefreshFollowedDirectory(
    true,
    {
      ...ready,
      pending_operation: {
        id: 'operation-failed',
        file_session_id: 'file-session-1',
        path: '/srv/failed',
        revision: 1,
        status: 'failed',
        error: '目录切换失败',
      },
    },
    true,
  ), true)
})

test('目录刷新根据 transport 生命周期决定等待、发送或失败', () => {
  assert.equal(sessionFilesCwdRefreshTransportDisposition('idle'), 'wait')
  assert.equal(sessionFilesCwdRefreshTransportDisposition('connecting'), 'wait')
  assert.equal(sessionFilesCwdRefreshTransportDisposition('attaching'), 'wait')
  assert.equal(sessionFilesCwdRefreshTransportDisposition('retry_wait'), 'wait')
  assert.equal(sessionFilesCwdRefreshTransportDisposition('live'), 'ready')
  assert.equal(sessionFilesCwdRefreshTransportDisposition('attach_failed'), 'failed')
  assert.equal(sessionFilesCwdRefreshTransportDisposition('ended'), 'failed')
  assert.equal(sessionFilesCwdRefreshTransportDisposition('disposed'), 'failed')
})

test('目录刷新只保留单一 65 秒安全看门狗', () => {
  const deadline = createSessionFilesCwdRefreshWatchdogDeadline(1_000)
  assert.equal(deadline, 66_000)
  assert.equal(sessionFilesCwdRefreshWatchdogRemaining(deadline, 1_000), 65_000)
  assert.equal(sessionFilesCwdRefreshWatchdogRemaining(deadline, 40_000), 26_000)
  assert.equal(sessionFilesCwdRefreshWatchdogRemaining(deadline, 66_000), 0)
  assert.equal(sessionFilesCwdRefreshWatchdogRemaining(deadline, 70_000), 0)
})

test('目录刷新实际发送时使用当前服务端代际并保留原事务时限', () => {
  const started = beginSessionFilesCwdRefresh(
    createSessionFilesViewState('/root'),
    cwdState({
      confirmed_path: undefined,
      refresh_seq: 0,
      source_generation: 0,
    }),
    1_000,
  )
  const dispatched = applySessionFilesCwdRefreshDispatch(started.cwdRefresh, {
    requestId: 'refresh-ready',
    baseRefreshSequence: 4,
    baseSourceGeneration: 7,
    baseConfirmedPath: '/srv/ready',
  })

  assert.equal(dispatched.requestId, 'refresh-ready')
  assert.equal(dispatched.baseRefreshSequence, 4)
  assert.equal(dispatched.baseSourceGeneration, 7)
  assert.equal(dispatched.baseConfirmedPath, '/srv/ready')
  assert.equal(dispatched.startedAt, 1_000)
  assert.equal(dispatched.deadlineAt, 66_000)
})

test('目录刷新可从服务端 pending 快照接管同一事务基线', () => {
  const started = beginSessionFilesCwdRefresh(
    createSessionFilesViewState('/root'),
    cwdState({ source_generation: 0 }),
    2_000,
  )
  const adopted = adoptSessionFilesCwdRefreshPending(started.cwdRefresh, cwdState({
    confirmed_path: '/srv/pending',
    refresh_seq: 5,
    source_generation: 8,
    refresh_request_id: 'refresh-attached',
    refresh_status: 'pending',
  }))

  assert.equal(adopted.phase, 'pending')
  assert.equal(adopted.requestId, 'refresh-attached')
  assert.equal(adopted.baseRefreshSequence, 5)
  assert.equal(adopted.baseSourceGeneration, 8)
  assert.equal(adopted.baseConfirmedPath, '/srv/pending')
  assert.equal(adopted.startedAt, 2_000)
  assert.equal(adopted.deadlineAt, 67_000)
})

test('本地未就绪短唤醒沿用刷新事务且不消耗服务端重试次数', () => {
  const original = {
    ...createSessionFilesViewState('/').cwdRefresh,
    phase: 'pending' as const,
    requestId: 'refresh-local-wake',
    startedAt: 1_000,
    deadlineAt: 66_000,
    retryCount: 2,
  }
  const scheduled = scheduleSessionFilesCwdLocalRetry(original, 2_000)

  assert.equal(scheduled.phase, 'waiting')
  assert.equal(scheduled.requestId, 'refresh-local-wake')
  assert.equal(scheduled.retryAt, 2_250)
  assert.equal(scheduled.retryCount, 2)
  assert.equal(scheduled.startedAt, 1_000)
  assert.equal(scheduled.deadlineAt, 66_000)
})

test('可重试刷新沿用 request id 和原始 deadline 并采用有限退避', () => {
  const original = {
    ...createSessionFilesViewState('/').cwdRefresh,
    phase: 'pending' as const,
    requestId: 'refresh-same',
    startedAt: 1_000,
    deadlineAt: 66_000,
  }
  const first = scheduleSessionFilesCwdRefreshRetry(original, 2_000)
  assert.ok(first)
  assert.equal(first.requestId, 'refresh-same')
  assert.equal(first.deadlineAt, 66_000)
  assert.equal(first.retryAt, 2_400)
  const second = scheduleSessionFilesCwdRefreshRetry(first, 2_400)
  assert.ok(second)
  assert.equal(second.requestId, 'refresh-same')
  assert.equal(second.deadlineAt, 66_000)
  assert.equal(second.retryAt, 3_400)
  const third = scheduleSessionFilesCwdRefreshRetry(second, 3_400)
  assert.ok(third)
  assert.equal(third.requestId, 'refresh-same')
  assert.equal(third.deadlineAt, 66_000)
  assert.equal(third.retryAt, 5_400)
  assert.equal(scheduleSessionFilesCwdRefreshRetry(third, 5_400), null)
  assert.equal(sessionFilesCwdRefreshRetryDelay(3), null)
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

  const failed = failDirectoryRequest(stale, second.requestSequence, '读取失败', '/srv/new')
  assert.equal(failed.path, '/srv')
  assert.equal(failed.listing?.path, '/srv')
  assert.equal(failed.error, '读取失败')
  assert.equal(failed.failedRequestPath, '/srv/new')
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

test('目录读取完成不会提前清除仍在进行的终端目录操作', () => {
  const request = beginDirectoryRequest({
    ...createSessionFilesViewState('/srv'),
    followTerminal: true,
    syncStatus: 'applying',
    syncError: '正在应用',
  }, '/srv/next')
  const completed = completeDirectoryRequest(
    request.state,
    request.requestSequence,
    listing('/srv/next'),
  )

  assert.equal(completed.syncStatus, 'applying')
  assert.equal(completed.syncError, '正在应用')
})

test('目录请求可以使用调用方同步分配的序号', () => {
  const initial = createSessionFilesViewState('/srv')
  const request = beginDirectoryRequest(initial, '/srv/next', 7)

  assert.equal(request.requestSequence, 7)
  assert.equal(request.state.requestSequence, 7)
  assert.equal(request.state.path, '/srv/next')
})

test('目录跟随不会重复请求正在加载的确认路径', () => {
  const state = beginDirectoryRequest({
    ...createSessionFilesViewState('/srv'),
    listing: listing('/srv'),
  }, '/srv/slow').state

  assert.equal(shouldRequestFollowedDirectory(state, '/srv/slow'), false)
})

test('目录跟随失败后等待显式重试或新的终端路径', () => {
  const request = beginDirectoryRequest({
    ...createSessionFilesViewState('/srv'),
    listing: listing('/srv'),
  }, '/srv/slow')
  const failed = failDirectoryRequest(
    request.state,
    request.requestSequence,
    '读取失败',
    '/srv/slow',
  )

  assert.equal(shouldRequestFollowedDirectory(failed, '/srv/slow'), false)
  assert.equal(shouldRequestFollowedDirectory(failed, '/srv/next'), true)

  const retry = beginDirectoryRequest(failed, '/srv/slow')
  assert.equal(retry.state.failedRequestPath, '')
  assert.equal(retry.state.loading, true)
})

test('目录观察就绪后控制准备状态不会阻塞文件列表跟随', () => {
  const initial = {
    ...createSessionFilesViewState('/srv/current'),
    followTerminal: true,
    listing: listing('/srv/current'),
  }

  for (const syncStatus of [
    'failed',
    'unsupported',
    'reconnect-required',
    'not_ready',
    'invalid_path',
  ] as const) {
    assert.equal(shouldRequestFollowedDirectory(
      { ...initial, syncStatus },
      '/srv/stale-confirmed',
    ), false)
  }
  for (const syncStatus of ['preparing', 'locating'] as const) {
    assert.equal(shouldRequestFollowedDirectory(
      { ...initial, syncStatus },
      '/srv/observed',
    ), true)
  }
  assert.equal(shouldRequestFollowedDirectory(
    { ...initial, syncStatus: '' },
    '/srv/confirmed',
  ), true)
})

test('目录切换反馈区分已展示目录和待打开目录', () => {
  const request = beginDirectoryRequest({
    ...createSessionFilesViewState('/srv/current'),
    listing: listing('/srv/current'),
  }, '/srv/next')

  assert.deepEqual(getSessionFilesNavigationState(request.state), {
    committedPath: '/srv/current',
    pendingPath: '/srv/next',
    refreshing: false,
  })
})

test('同目录刷新不会误报为目录切换', () => {
  const request = beginDirectoryRequest({
    ...createSessionFilesViewState('/srv/current'),
    listing: listing('/srv/current'),
  }, '/srv/current')

  assert.deepEqual(getSessionFilesNavigationState(request.state), {
    committedPath: '/srv/current',
    pendingPath: '',
    refreshing: true,
  })
})

test('目录跟随确认新路径后立即展示待切换目标', () => {
  const state = {
    ...createSessionFilesViewState('/srv/current'),
    followTerminal: true,
    listing: listing('/srv/current'),
  }

  assert.deepEqual(getSessionFilesNavigationState(state, '/srv/followed'), {
    committedPath: '/srv/current',
    pendingPath: '/srv/followed',
    refreshing: false,
  })
})

test('目录能力准备和定位期间不把旧确认路径展示为跟随目标', () => {
  const state = {
    ...createSessionFilesViewState('/srv/current'),
    followTerminal: true,
    listing: listing('/srv/current'),
  }

  for (const syncStatus of ['preparing', 'locating'] as const) {
    assert.deepEqual(getSessionFilesNavigationState(
      { ...state, syncStatus },
      '/srv/stale-confirmed',
    ), {
      committedPath: '/srv/current',
      pendingPath: '',
      refreshing: false,
    })
  }
})

test('关闭目录跟随后忽略终端遗留的待处理操作', () => {
  const state = {
    ...createSessionFilesViewState('/srv/current'),
    listing: listing('/srv/current'),
  }

  assert.deepEqual(getSessionFilesNavigationState(
    state,
    '/srv/current',
    '/srv/stale-pending',
  ), {
    committedPath: '/srv/current',
    pendingPath: '',
    refreshing: false,
  })
})

test('读取失败的跟随目标不会继续显示为切换中', () => {
  const state = {
    ...createSessionFilesViewState('/srv/current'),
    followTerminal: true,
    listing: listing('/srv/current'),
    error: '读取失败',
    failedRequestPath: '/srv/failed',
    syncStatus: 'failed' as const,
  }

  assert.deepEqual(getSessionFilesNavigationState(state, '/srv/failed', '/srv/failed'), {
    committedPath: '/srv/current',
    pendingPath: '',
    refreshing: false,
  })
})

test('关闭目录跟随后迟到的目录响应不会覆盖最后成功列表', () => {
  const current = {
    ...createSessionFilesViewState('/tmp'),
    listing: listing('/tmp'),
  }
  const request = beginDirectoryRequest(current, '/var', 7)
  const canceled = cancelDirectoryRequest(request.state)

  assert.equal(canceled.path, '/tmp')
  assert.equal(canceled.loading, false)
  assert.equal(canceled.requestSequence, 8)
  assert.equal(
    completeDirectoryRequest(canceled, request.requestSequence, listing('/var')),
    canceled,
  )
})

test('开启目录跟随后使在途读取失效并忽略迟到响应', () => {
  const requestWithoutListing = beginDirectoryRequest(
    createSessionFilesViewState('/root'),
    '/root/old',
    7,
  )
  const canceledWithoutListing = cancelDirectoryRequestForFollowRefresh(
    requestWithoutListing.state,
    8,
  )
  assert.equal(canceledWithoutListing.loading, false)
  assert.equal(canceledWithoutListing.listing, null)
  assert.equal(canceledWithoutListing.requestSequence, 8)
  assert.equal(
    completeDirectoryRequest(
      canceledWithoutListing,
      requestWithoutListing.requestSequence,
      listing('/root/old'),
    ),
    canceledWithoutListing,
  )

  const requestWithLastGood = beginDirectoryRequest({
    ...createSessionFilesViewState('/srv/current'),
    listing: listing('/srv/current'),
  }, '/srv/old', 11)
  const canceledWithLastGood = cancelDirectoryRequestForFollowRefresh(
    requestWithLastGood.state,
    12,
  )
  assert.equal(canceledWithLastGood.loading, false)
  assert.equal(canceledWithLastGood.path, '/srv/current')
  assert.equal(canceledWithLastGood.listing?.path, '/srv/current')
  assert.equal(
    completeDirectoryRequest(
      canceledWithLastGood,
      requestWithLastGood.requestSequence,
      listing('/srv/old'),
    ),
    canceledWithLastGood,
  )
})

test('首次目录列表尚未完成时关闭跟随会保留唯一的初始读取', () => {
  const request = beginDirectoryRequest(createSessionFilesViewState('/'), '/root', 3)

  assert.equal(cancelDirectoryRequest(request.state), request.state)
  assert.equal(request.state.loading, true)
})

test('文件区发起目录切换时不会回读终端的旧确认路径', () => {
  const state = {
    ...createSessionFilesViewState('/srv/current'),
    path: '/srv/pending',
    listing: listing('/srv/current'),
    syncStatus: 'waiting-idle' as const,
  }

  assert.equal(
    shouldRequestFollowedDirectory(state, '/srv/current'),
    false,
  )
  assert.equal(
    shouldRequestFollowedDirectory({ ...state, syncStatus: '' }, '/srv/current', '/srv/pending'),
    false,
  )
  assert.equal(shouldRequestFollowedDirectory(state, '/srv/pending'), true)
})

test('终端目录切换尚未确认时不会加载旧确认目录', () => {
  const state = createSessionFilesViewState('/srv/current')

  assert.equal(
    shouldRequestFollowedDirectory(state, '/srv/current', '/srv/pending'),
    false,
  )
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
