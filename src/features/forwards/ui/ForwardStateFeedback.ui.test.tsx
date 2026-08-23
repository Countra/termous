import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ForwardInstance } from '#entities/forward'
import { ForwardStateFeedback } from './ForwardStateFeedback'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      key === 'forwards.reconnectAttempt'
        ? `${options?.attempt}/${options?.total}`
        : key
    ),
  }),
}))

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

test('后台转发恢复时展示当前阶段和重试次数', () => {
  render(<ForwardStateFeedback forward={forward({
    status: 'reconnecting',
    phase: 'waiting_retry',
    progress: 80,
    reconnect_attempt: 2,
    reconnect_max_attempts: 3,
    next_reconnect_at: '2026-08-23T00:00:04Z',
  })} />)

  const feedback = screen.getByRole('status')
  expect(feedback).toHaveTextContent('forwards.phaseName.waiting_retry')
  expect(feedback).toHaveTextContent('2/3')
})

test('稳定运行时不渲染过渡反馈', () => {
  const { container } = render(<ForwardStateFeedback forward={forward()} />)

  expect(container).toBeEmptyDOMElement()
})
