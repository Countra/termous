import { expect, test } from 'vitest'
import type { ForwardEvent, ForwardInstance } from '#entities/forward'
import {
  reconcileForwardReloadSnapshot,
  shouldEmitForwardError,
} from './forwardRuntimeState.ts'

function forward(overrides: Partial<ForwardInstance> = {}): ForwardInstance {
  return {
    id: 'forward-1',
    name: 'Forward 1',
    mode: 'local',
    scope: 'background_once',
    status: 'running',
    phase: 'ready',
    progress: 100,
    host_id: 'host-1',
    bind_host: '127.0.0.1',
    bind_port: 8022,
    target_host: '127.0.0.1',
    target_port: 22,
    active_connections: 0,
    total_connections: 0,
    bytes_in: 0,
    bytes_out: 0,
    started_at: '2026-08-23T00:00:00Z',
    ...overrides,
  }
}

test('后台转发重连期间抑制中间错误并只提交最终失败事件', () => {
  const reconnecting = forward({
    status: 'reconnecting',
    phase: 'waiting_retry',
    progress: 80,
    last_error: 'connection reset',
    reconnect_attempt: 1,
    reconnect_max_attempts: 3,
  })
  const events: ForwardEvent[] = [
    { type: 'phase', forward: reconnecting },
    {
      type: 'error',
      forward: { ...reconnecting, phase: 'dialing_ssh', progress: 65 },
    },
    {
      type: 'error',
      forward: {
        ...reconnecting,
        status: 'failed',
        phase: 'failed',
        progress: 100,
        reconnect_attempt: 3,
      },
    },
  ]

  expect(events.map(shouldEmitForwardError)).toEqual([false, false, true])
  expect(events.filter(shouldEmitForwardError)).toHaveLength(1)
})

test('后台转发恢复运行且错误已清除时不提交错误通知', () => {
  const recovered = forward({
    status: 'running',
    phase: 'ready',
    last_error: undefined,
    reconnect_attempt: undefined,
    reconnect_max_attempts: undefined,
  })

  expect(shouldEmitForwardError({ type: 'ready', forward: recovered })).toBe(false)
  expect(shouldEmitForwardError({ type: 'update', forward: recovered })).toBe(false)
})

test('转发列表重载不会覆盖请求期间收到的恢复事件或重新插入终态实例', () => {
  const stable = forward({
    id: 'stable',
    name: 'Stable',
    started_at: '2026-08-24T00:00:00Z',
  })
  const reconnecting = forward({
    id: 'recovering',
    name: 'Recovering',
    status: 'reconnecting',
    phase: 'waiting_retry',
  })
  const staleRecovering = { ...reconnecting, status: 'running', phase: 'ready' } as ForwardInstance
  const staleFailed = forward({ id: 'failed', name: 'Failed' })

  expect(reconcileForwardReloadSnapshot(
    [stable, reconnecting],
    [stable, staleRecovering, staleFailed],
    new Set(['recovering', 'failed']),
  )).toEqual([stable, reconnecting])
})
