import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ForwardInstance } from '#entities/forward'
import { ForwardRuntimeMetrics } from './ForwardRuntimeMetrics'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (
      key === 'forwards.speedValue' ? `${String(options?.value)}/s` : key
    ),
  }),
}))

function forward(startedAt: string): ForwardInstance {
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
    started_at: startedAt,
  }
}

test('端口转发开始时间悬浮详情精确到年月日时分秒', () => {
  const startedAt = new Date(2026, 7, 9, 6, 5, 4).toISOString()
  render(<ForwardRuntimeMetrics forward={forward(startedAt)} enabled={false} />)

  const metric = screen.getByRole('group', {
    name: 'forwards.startedAt: 2026-08-09 06:05:04',
  })
  const exactTime = within(metric).getByText('2026-08-09 06:05:04')
  const detail = exactTime.closest('[popover]') as HTMLElement
  const showPopover = vi.fn()
  Object.defineProperties(detail, {
    matches: { configurable: true, value: vi.fn(() => false) },
    showPopover: { configurable: true, value: showPopover },
  })

  expect(metric).toHaveAttribute('tabindex', '0')
  expect(detail).toHaveAttribute('popover', 'manual')
  fireEvent.pointerEnter(metric)
  expect(showPopover).toHaveBeenCalledOnce()
})

test('非法开始时间保留原始可见值且不启用详情交互', () => {
  render(<ForwardRuntimeMetrics forward={forward('invalid')} enabled={false} />)

  const metric = screen.getByRole('group', { name: 'forwards.startedAt: invalid' })
  expect(metric).not.toHaveAttribute('tabindex')
  expect(metric.querySelector('[popover]')).toBeNull()
})
