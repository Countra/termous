import assert from 'node:assert/strict'
import test from 'node:test'
import type { Session } from '../types/domain.ts'
import {
  mergeSessionReloadSnapshot,
  shouldApplySessionInventoryResponse,
} from '../app/data-runtime/model/sessionInventoryState.ts'
import {
  canRetrySessionInventory,
  getAutomaticSessionInventoryDemand,
  getSessionInventoryVisibleScope,
  isSessionInventoryRequestCurrent,
} from '../widgets/workbench/model/sessionInventoryDemand.ts'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    kind: 'ssh',
    host_id: 'host-1',
    status: 'connected',
    inventory_status: 'idle',
    started_at: '2026-07-22T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
    ...overrides,
  }
}

test('仅为展开且可见的系统信息与系统监控页建立 inventory scope', () => {
  const connected = session()
  assert.equal(getSessionInventoryVisibleScope(connected, 'system', false), connected.id)
  assert.equal(getSessionInventoryVisibleScope(connected, 'monitor', false), connected.id)
  assert.equal(getSessionInventoryVisibleScope(connected, 'overview', false), '')
  assert.equal(getSessionInventoryVisibleScope(connected, 'system', true), '')
  assert.equal(getSessionInventoryVisibleScope(session({ kind: 'local' }), 'system', false), '')
  assert.equal(getSessionInventoryVisibleScope(session({ status: 'disconnected' }), 'system', false), '')
})

test('自动 inventory demand 只接受 idle 状态', () => {
  assert.equal(getAutomaticSessionInventoryDemand(session(), 'system', false), 'session-1')
  assert.equal(getAutomaticSessionInventoryDemand(session({ inventory_status: undefined }), 'system', false), 'session-1')
  for (const inventoryStatus of ['collecting', 'ready', 'failed', 'unsupported'] as const) {
    assert.equal(
      getAutomaticSessionInventoryDemand(session({ inventory_status: inventoryStatus }), 'system', false),
      '',
    )
  }
})

test('仅已连接 SSH 会话的失败状态允许显式重试', () => {
  assert.equal(canRetrySessionInventory(session({ inventory_status: 'failed' })), true)
  assert.equal(canRetrySessionInventory(session({ inventory_status: 'ready' })), false)
  assert.equal(canRetrySessionInventory(session({ inventory_status: 'failed', status: 'disconnected' })), false)
  assert.equal(canRetrySessionInventory(session({ inventory_status: 'failed', kind: 'local' })), false)
})

test('请求结果必须同时匹配会话、代际和当前可见 scope', () => {
  const request = { sessionId: 'session-1', revision: 3 }
  assert.equal(isSessionInventoryRequestCurrent(request, request, 'session-1', false), true)
  assert.equal(isSessionInventoryRequestCurrent(request, { ...request, revision: 4 }, 'session-1', false), false)
  assert.equal(isSessionInventoryRequestCurrent(request, request, 'session-2', false), false)
  assert.equal(isSessionInventoryRequestCurrent(request, request, '', false), false)
  assert.equal(isSessionInventoryRequestCurrent(request, request, 'session-1', true), false)
  assert.equal(isSessionInventoryRequestCurrent(request, null, 'session-1', false), false)
})

test('REST 响应不得覆盖更新代请求或更新的 WebSocket 会话事件', () => {
  const current = {
    sessionId: 'session-1',
    responseSessionId: 'session-1',
    requestRevision: 4,
    latestRequestRevision: 4,
    baselineEventRevision: 7,
    latestEventRevision: 7,
    aborted: false,
  }
  assert.equal(shouldApplySessionInventoryResponse(current), true)
  assert.equal(shouldApplySessionInventoryResponse({ ...current, responseSessionId: 'session-2' }), false)
  assert.equal(shouldApplySessionInventoryResponse({ ...current, latestRequestRevision: 5 }), false)
  assert.equal(shouldApplySessionInventoryResponse({ ...current, latestEventRevision: 8 }), false)
  assert.equal(shouldApplySessionInventoryResponse({ ...current, aborted: true }), false)
})

test('全量会话刷新保留请求期间到达的实时 inventory 状态', () => {
  const baseline = new Map([['session-1', 3]])
  const latest = new Map([['session-1', 4]])
  const current = session({ inventory_status: 'ready', inventory_message: '系统信息已更新' })
  const stale = session({ inventory_status: 'collecting', inventory_message: '正在读取 Linux 系统信息' })

  assert.deepEqual(mergeSessionReloadSnapshot([current], [stale], baseline, latest), [current])
})

test('全量会话刷新不会复活期间关闭的会话并会保留期间创建的会话', () => {
  const baseline = new Map<string, number>()
  const latest = new Map([
    ['closed-session', 1],
    ['new-session', 1],
  ])
  const closedSnapshot = session({ id: 'closed-session' })
  const created = session({ id: 'new-session' })

  assert.deepEqual(
    mergeSessionReloadSnapshot([created], [closedSnapshot], baseline, latest),
    [created],
  )
})

test('全量会话刷新正常采用请求期间未变化的服务端快照', () => {
  const current = session({ inventory_status: 'collecting' })
  const ready = session({ inventory_status: 'ready' })

  assert.deepEqual(
    mergeSessionReloadSnapshot([current], [ready], new Map(), new Map()),
    [ready],
  )
})
