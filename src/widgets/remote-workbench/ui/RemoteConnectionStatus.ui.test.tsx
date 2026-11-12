import { fireEvent, render, screen, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { expect, test } from 'vitest'
import type { RemoteConnection } from '#common/contracts'
import { remoteCopy } from '#features/remote-control'
import { RemoteConnectionStatus } from './RemoteConnectionStatus'

test('主连接与桌面媒体分别呈现实测路径，连接偏好不冒充实际路径', async () => {
  const connection = { id: 'parent', transport_policy: 'auto', stats: { path: 'direct', protocol: 'udp', ip_version: 'ipv4', rtt_ms: 8, receive_bytes_per_second: 1024, send_bytes_per_second: 0 } } as RemoteConnection
  const media = { connectionId: 'parent', title: 'Display 1', phase: 'viewing', transport: 'rfb' as const, sample: { attachmentId: 'media', mediaGeneration: 1n, sampledAt: 1000, path: 'relay' as const, localRelayProtocol: 'unknown' as const, rttMs: 40 } }
  const props = { connection, media, ready: true, closed: false, path: 'P2P 直连', copy: remoteCopy('zh-CN'), zh: true }
  const view = render(<ConfigProvider theme={{ token: { motion: false } }}><RemoteConnectionStatus {...props} /></ConfigProvider>)
  fireEvent.click(screen.getByRole('button', { name: '连接详情' }))
  const control = within(await screen.findByRole('region', { name: '控制连接' }))
  expect(control.getByText('P2P 直连')).toBeInTheDocument()
  expect(control.getByText('8 ms')).toBeInTheDocument()
  expect(control.getByText('1.0 KB/s')).toBeInTheDocument()
  expect(control.getByText('0 B/s')).toBeInTheDocument()
  expect(control.getByText('自动（优先直连）')).toBeInTheDocument()
  const desktop = within(screen.getByRole('region', { name: '桌面媒体' }))
  expect(desktop.getByText('TURN 中继')).toBeInTheDocument()
  expect(desktop.getByText('40 ms')).toBeInTheDocument()
  expect(desktop.queryByText('8 ms')).not.toBeInTheDocument()
  view.rerender(<ConfigProvider theme={{ token: { motion: false } }}><RemoteConnectionStatus {...props} media={{ ...media, connectionId: 'old' }} /></ConfigProvider>)
  expect(screen.queryByRole('region', { name: '桌面媒体' })).not.toBeInTheDocument()
  fireEvent.keyDown(screen.getByRole('region', { name: '控制连接' }), { key: 'Escape' })
  expect(screen.getByRole('button', { name: '连接详情' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('button', { name: '连接详情' })).toHaveFocus()
})
