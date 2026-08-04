import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { AliasSyncTask } from '../types/domain.ts'
import {
  aliasSyncCloseNeedsCancellation,
  aliasSyncProgress,
  aliasSyncSelectedTargetIds,
  aliasSyncTaskMatchesRequest,
  aliasSyncTaskReducer,
  createAliasSyncTaskViewState,
  isAliasSyncTaskTerminal,
  parseAliasSyncTaskEvent,
  reconcileAliasSyncTask,
} from '../features/workbench/aliasSyncTaskState.ts'
import {
  groupAliasSyncHosts,
  isAliasSyncHostSelectable,
  orderAliasSyncHosts,
  orderAliasSyncSelectionIds,
} from '../features/workbench/aliasSyncSelection.ts'
import type { Host, HostGroup } from '../types/domain.ts'

const aliasSyncStyles = readFileSync(
  new URL('../features/workbench/alias-sync-modal.css', import.meta.url),
  'utf8',
)

test('任务快照只接受同任务的新 revision，且终态不会被同 revision 的运行态回退', () => {
  const running = createTask({ revision: 3, status: 'running', progress_percent: 40 })
  const stale = createTask({ revision: 2, status: 'running', progress_percent: 10 })
  assert.equal(reconcileAliasSyncTask(running, stale), running)

  const completed = createTask({ revision: 4, status: 'completed', progress_percent: 100 })
  const regressed = createTask({ revision: 4, status: 'running', progress_percent: 80 })
  assert.equal(reconcileAliasSyncTask(completed, regressed), completed)
})

test('reducer 在任务终态清除取消等待并保留最终快照', () => {
  let state = aliasSyncTaskReducer(createAliasSyncTaskViewState(), { type: 'cancel-start' })
  assert.equal(state.cancelling, true)

  const cancelled = createTask({ revision: 5, status: 'cancelled' })
  state = aliasSyncTaskReducer(state, { type: 'snapshot', task: cancelled })
  assert.equal(state.task, cancelled)
  assert.equal(state.cancelling, false)
  assert.equal(isAliasSyncTaskTerminal(state.task.status), true)
})

test('目标主机选择默认可为空并稳定排除来源主机与重复项', () => {
  assert.deepEqual(aliasSyncSelectedTargetIds([], 'source'), [])
  assert.deepEqual(
    aliasSyncSelectedTargetIds(['source', 'host-2', 'host-2', '', 'host-3'], 'source'),
    ['host-2', 'host-3'],
  )
})

test('创建请求未返回时的关闭仍进入取消确认流程', () => {
  assert.equal(aliasSyncCloseNeedsCancellation(true), true)
  assert.equal(aliasSyncCloseNeedsCancellation(false, 'loading_source'), true)
  assert.equal(aliasSyncCloseNeedsCancellation(false, 'cancelling'), true)
  assert.equal(aliasSyncCloseNeedsCancellation(false, 'completed'), false)
  assert.equal(aliasSyncCloseNeedsCancellation(false), false)
})

test('创建响应丢失后只允许接管并取消完全匹配的活动任务', () => {
  const task = createTask({
    alias_ids: ['alias-1', 'alias-2'],
    target_host_ids: ['host-2', 'host-3'],
  })

  assert.equal(
    aliasSyncTaskMatchesRequest(
      task,
      'session-1',
      ['alias-1', 'alias-2'],
      ['host-2', 'host-3'],
    ),
    true,
  )
  assert.equal(aliasSyncTaskMatchesRequest(task, 'session-other', task.alias_ids, task.target_host_ids), false)
  assert.equal(aliasSyncTaskMatchesRequest(task, 'session-1', ['alias-2', 'alias-1'], task.target_host_ids), false)
  assert.equal(aliasSyncTaskMatchesRequest(task, 'session-1', task.alias_ids, ['host-3', 'host-2']), false)
})

test('逆序勾选仍按界面稳定顺序提交 Alias 和目标主机 ID', () => {
  const items = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]
  assert.deepEqual(orderAliasSyncSelectionIds(items, ['third', 'first']), ['first', 'third'])
})

test('目标主机按分组顺序展示且来源主机与未分组位置稳定', () => {
  const groups: HostGroup[] = [
    { id: 'later', name: 'Later', sort_order: 2 },
    { id: 'first', name: 'First', sort_order: 1 },
  ]
  const hosts = [
    createHost('ungrouped', ''),
    createHost('later-host', 'later'),
    createHost('source', 'first'),
    createHost('first-host', 'first'),
  ]
  const ordered = orderAliasSyncHosts(hosts, groups, 'source')
  assert.deepEqual(ordered.map((host) => host.id), ['first-host', 'later-host', 'ungrouped'])
  assert.deepEqual(
    groupAliasSyncHosts(ordered, groups).map((section) => [section.id, section.hosts.map((host) => host.id)]),
    [['first', ['first-host']], ['later', ['later-host']], ['', ['ungrouped']]],
  )
})

test('缺少或无法解析凭据的主机不会进入可选目标集合', () => {
  const credentialIds = new Set(['credential-ready'])
  assert.equal(isAliasSyncHostSelectable(createHost('ready', ''), credentialIds), true)
  assert.equal(isAliasSyncHostSelectable(createHost('missing', ''), credentialIds), false)
  assert.equal(isAliasSyncHostSelectable({ credential_id: '' }, credentialIds), false)
})

test('进度被限制在有效区间且成功终态固定为百分之百', () => {
  assert.equal(aliasSyncProgress(null), 0)
  assert.equal(aliasSyncProgress(createTask({ progress_percent: -5 })), 0)
  assert.equal(aliasSyncProgress(createTask({ progress_percent: 130 })), 100)
  assert.equal(aliasSyncProgress(createTask({ status: 'completed', progress_percent: 82 })), 100)
})

test('WebSocket 事件只接受指定 envelope 和最小任务身份字段', () => {
  const task = createTask()
  assert.equal(parseAliasSyncTaskEvent({ type: 'alias_sync_task_update', task }), task)
  assert.equal(parseAliasSyncTaskEvent({ type: 'other', task }), null)
  assert.equal(parseAliasSyncTaskEvent({ type: 'alias_sync_task_update', task: { id: 'task' } }), null)
  assert.equal(parseAliasSyncTaskEvent('invalid'), null)
})

test('同步弹窗使用 AntD 6 单一外壳且列表行从顶部紧凑排列', () => {
  assert.match(
    aliasSyncStyles,
    /\.alias-sync-modal \.ant-modal-container\s*\{[^}]*background:\s*var\(--surface-strong\);[^}]*padding:\s*0;/s,
  )
  assert.doesNotMatch(aliasSyncStyles, /\.alias-sync-modal \.ant-modal-content\s*\{/)
  assert.match(
    aliasSyncStyles,
    /\.alias-sync-target-list\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start;/s,
  )
  assert.match(
    aliasSyncStyles,
    /\.alias-sync-selection-list\s*\{[^}]*grid-auto-rows:\s*max-content;[^}]*align-content:\s*start;/s,
  )
  assert.match(
    aliasSyncStyles,
    /\.alias-sync-select-row\.ant-checkbox-wrapper\s*\{[^}]*height:\s*52px;[^}]*align-items:\s*center;[^}]*padding:\s*6px 8px;/s,
  )
  assert.match(
    aliasSyncStyles,
    /\.alias-sync-select-row\.ant-checkbox-wrapper::after\s*\{[^}]*display:\s*none;[^}]*content:\s*none;/s,
  )
  assert.match(
    aliasSyncStyles,
    /\.alias-sync-select-row\.ant-checkbox-wrapper > \.ant-checkbox-label\s*\{[^}]*height:\s*auto;[^}]*align-items:\s*center;[^}]*align-self:\s*center;/s,
  )
  assert.match(
    aliasSyncStyles,
    /\.alias-sync-host-trailing\s*\{[^}]*justify-self:\s*end;[^}]*gap:\s*6px;/s,
  )
})

function createTask(overrides: Partial<AliasSyncTask> = {}): AliasSyncTask {
  return {
    id: 'task-1',
    revision: 1,
    status: 'running',
    source: {
      session_id: 'session-1',
      host_id: 'source',
      host_name: 'Source',
    },
    alias_ids: ['alias-1'],
    target_host_ids: ['host-2'],
    targets: [],
    total_targets: 1,
    completed_targets: 0,
    succeeded_targets: 0,
    skipped_targets: 0,
    failed_targets: 0,
    cancelled_targets: 0,
    uncertain_targets: 0,
    progress_percent: 0,
    cancellable: true,
    created_at: '2026-08-04T00:00:00Z',
    ...overrides,
  }
}

function createHost(id: string, groupId: string): Host {
  return {
    id,
    name: id,
    platform: 'linux',
    group_id: groupId,
    address: `${id}.example.com`,
    port: 22,
    username: 'root',
    auth_method: 'password',
    credential_id: `credential-${id}`,
    tags: [],
    favorite: false,
    fingerprint_policy: 'confirm_on_change',
  }
}
