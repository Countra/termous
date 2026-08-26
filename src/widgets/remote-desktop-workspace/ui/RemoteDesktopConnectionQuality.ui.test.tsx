import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import {
  formatBytes,
  formatSshRtt,
  sshRttStaleAfterMs,
  transportHealth,
} from '../model/connectionQuality.ts'
import { RemoteDesktopConnectionQuality } from './RemoteDesktopConnectionQuality.tsx'

const metricsMock = vi.hoisted(() => ({
  value: {
    connectedAt: Date.now() - 5_000,
    sampledAt: Date.now(),
    receivedBytes: 602_112,
    sentBytes: 1_010,
    receiveBytesPerSecond: 2_048,
    sendBytesPerSecond: 1_024,
    bufferedAmount: 0,
    outboundMeasured: true,
    sshRttMs: 0,
    sshRttSampledAt: Date.now(),
  },
}))

vi.mock('#features/remote-desktop', () => ({
  useRemoteDesktopConnectionMetrics: () => metricsMock.value,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'remoteDesktop.connectionQuality.details': '查看连接详情',
      'remoteDesktop.connectionQuality.normal': '正常',
      'remoteDesktop.connectionQuality.duration': '连接时长',
      'remoteDesktop.connectionQuality.receiveRate': '接收速率',
      'remoteDesktop.connectionQuality.sendRate': '发送速率',
      'remoteDesktop.connectionQuality.sshLatency': 'SSH 延迟',
      'remoteDesktop.connectionQuality.received': '累计接收',
      'remoteDesktop.connectionQuality.sent': '累计发送',
      'remoteDesktop.connectionQuality.sendQueue': '待发送数据',
    })[key] ?? key,
  }),
}))

test('连接状态只依据发送队列判断，不把静态桌面误判为异常', () => {
  expect(transportHealth(0)).toBe('normal')
  expect(transportHealth(64 * 1024)).toBe('queued')
  expect(transportHealth(1024 * 1024)).toBe('congested')
})

test('流量数值使用紧凑二进制单位', () => {
  expect(formatBytes(512)).toBe('512 B')
  expect(formatBytes(1536)).toBe('1.5 KiB')
  expect(formatBytes(12 * 1024 * 1024)).toBe('12 MiB')
})

test('SSH 链路延迟超过采样有效期后不再展示旧值', () => {
  const sampledAt = Date.parse('2026-08-24T08:00:00Z')
  expect(formatSshRtt(0, sampledAt, sampledAt)).toBe('<1 ms')
  expect(formatSshRtt(24.6, sampledAt, sampledAt + sshRttStaleAfterMs)).toBe('25 ms')
  expect(formatSshRtt(24.6, sampledAt, sampledAt + sshRttStaleAfterMs + 1)).toBe('--')
  expect(formatSshRtt(null, sampledAt, sampledAt)).toBe('--')
})

test('连接详情以同一主指标层级展示延迟和双向速率', async () => {
  render(<RemoteDesktopConnectionQuality sessionId="rds_metrics" connected />)

  fireEvent.click(screen.getByRole('button', { name: '查看连接详情' }))

  expect(screen.getAllByText('正常')).toHaveLength(2)
  expect(await screen.findByText('SSH 延迟')).toBeInTheDocument()
  expect(screen.getByText('接收速率')).toBeInTheDocument()
  expect(screen.getByText('发送速率')).toBeInTheDocument()
  expect(screen.getByText('待发送数据')).toBeInTheDocument()
  expect(screen.getAllByText('<1 ms')).toHaveLength(2)
})
