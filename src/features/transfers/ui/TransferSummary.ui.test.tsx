import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TransferSummary } from './TransferSummary'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options: Record<string, unknown>) => key === 'files.activeTransferCount' ? `${options.count} 个传输` : `${options.value}/s` }) }))
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('持续更新按 600ms 合并最新数值，不因连续事件一直推迟刷新', () => {
  const view = render(<TransferSummary scopeKey="a" count={1} progress={1} speed={1024} />)
  for (let value = 2; value <= 6; value++) {
    act(() => vi.advanceTimersByTime(100))
    view.rerender(<TransferSummary scopeKey="a" count={1} progress={value} speed={value * 1024} />)
    expect(screen.getByText('1%')).toBeInTheDocument()
  }
  act(() => vi.advanceTimersByTime(100))
  expect(screen.getByText('6%')).toBeInTheDocument()
  expect(screen.getByText('6.0 KB/s')).toBeInTheDocument()
})

it('任务集合变化立即换用新指标，数量变化即时展示，卸载清理刷新定时器', () => {
  const view = render(<TransferSummary scopeKey="a" count={1} progress={99} speed={1024} />)
  view.rerender(<TransferSummary scopeKey="a" count={2} progress={99} speed={1024} />)
  expect(screen.getByText('2 个传输')).toBeInTheDocument()
  view.rerender(<TransferSummary scopeKey="b" count={1} progress={2} speed={2048} />)
  expect(screen.getByText('2%')).toBeInTheDocument()
  expect(screen.queryByText('99%')).not.toBeInTheDocument()
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('未知进度立即隐藏数值，零速率仍按本次采样展示且不会沿用旧速度', () => {
  const view = render(<TransferSummary scopeKey="a" count={1} progress={25} speed={1024} />)
  view.rerender(<TransferSummary scopeKey="a" count={1} speed={0} />)
  expect(screen.queryByText('25%')).not.toBeInTheDocument()
  act(() => vi.advanceTimersByTime(600))
  expect(screen.getByText('0 B/s')).toBeInTheDocument()
  view.rerender(<TransferSummary scopeKey="a" count={1} progress={0} speed={0} />)
  expect(screen.getByText('0%')).toBeInTheDocument()
  view.unmount()
  act(() => vi.advanceTimersByTime(600))
  expect(vi.getTimerCount()).toBe(0)
})
