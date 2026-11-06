import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { videoDefaultCapabilities, type PresentationState } from '@termous/remote-protocol/presentation'
import { DesktopStabilityNotice } from './DesktopStabilityNotice.tsx'

const state: PresentationState = {
  capabilities: videoDefaultCapabilities, revision: 1n, configRevision: 4n, status: 'confirmed',
  requested: { kind: 'video', size: '1440p', bitrate: 100_000_000, framerate: 60 },
  stability: {
    revision: 1n, adviceRevision: 1n, decodeEpoch: 2n, confirmedDecodeEpoch: 2n,
    phase: 'stable', level: 51, networkEstimate: 50_000_000, pressure: 'encoding',
    suggested: { kind: 'video', size: '1440p', bitrate: 100_000_000, framerate: 30 },
  },
}

test('持续性能问题仅由用户决定修改，忽略只通知会话所有者', () => {
  const changed = vi.fn()
  const dismissed = vi.fn()
  render(<DesktopStabilityNotice state={state} onChange={changed} onDismiss={dismissed} disabled={false} zh />)
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保持当前配置' }))
  expect(dismissed).toHaveBeenCalledOnce()
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '采用建议配置' }))
  expect(changed).toHaveBeenCalledExactlyOnceWith(state.stability!.suggested)
})

test('失败只显示恢复信息，重试必须由用户触发', () => {
  const changed = vi.fn()
  render(<DesktopStabilityNotice state={{ ...state, stability: { ...state.stability!, phase: 'attention', suggested: undefined } }} onChange={changed} onDismiss={vi.fn()} disabled={false} zh />)
  expect(changed).not.toHaveBeenCalled()
  expect(screen.getByText(/目标配置未确认/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '重试目标配置' }))
  expect(changed).toHaveBeenCalledExactlyOnceWith(state.requested)
})

test('高压缩提示保留固定目标，保持按钮不发送降档请求', () => {
  const changed = vi.fn()
  render(<DesktopStabilityNotice state={{ ...state, stability: { ...state.stability!, pressure: 'compression' } }} onChange={changed} onDismiss={vi.fn()} disabled={false} zh />)
  expect(screen.getByText(/持续出现高压缩/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '保持当前配置' }))
  expect(changed).not.toHaveBeenCalled()
})

test.each([
  ['local_delivery', '主机视频交付持续超时'],
  ['network', '检测到持续传输丢包或抖动'],
  ['unknown_reason', '当前画质需要确认'],
])('压力 %s 显示证据或通用提示', (pressure, message) => {
  render(<DesktopStabilityNotice state={{ ...state, stability: { ...state.stability!, pressure } }} onChange={vi.fn()} onDismiss={vi.fn()} disabled={false} zh />)
  expect(screen.getByText(new RegExp(message))).toBeInTheDocument()
  expect(screen.queryByText(/持续拥塞/)).not.toBeInTheDocument()
})
