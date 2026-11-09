import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { RemoteDesktopMediaDetails } from '#entities/remote-desktop'
import { RemoteMediaDetails } from './RemoteMediaDetails'

const value: RemoteDesktopMediaDetails = {
  connectionId: 'control', title: 'Display 2', transport: 'h264', phase: 'viewing',
  presentation: {
    capabilities: { kind: 'video', available: true, maxBitrate: 100_000_000, videoLimitsVersion: 3 },
    status: 'confirmed', revision: 1n, configRevision: 5n,
    codec: { negotiated: { mimeType: 'video/H264', profile: 'constrained_baseline', receiverLevel: 51, negotiatedLevel: 51, packetizationMode: 1, profileLevelId: '42e033' }, applied: { configRevision: 6n, level: 42 } },
    transport: { revision: 2n, path: 'relay', bitrateLimit: 24_000_000 },
  },
  sample: { attachmentId: 'media', mediaGeneration: 1n, sampledAt: 1000, path: 'direct', protocol: 'udp', rttMs: 3 },
}

test('协商上限、应用等级、画面确认和两端路径分别展示并实时更新', () => {
  const view = render(<RemoteMediaDetails value={value} zh />)
  const row = (label: string) => within(screen.getByText(label).closest('tr')!)
  expect(row('接收声明上限').getByText('5.1')).toBeInTheDocument()
  expect(row('已应用编码等级').getByText('4.2')).toBeInTheDocument()
  expect(row('画面确认').getByText('未确认')).toBeInTheDocument()
  expect(row('媒体路径（本地观测）').getByText('P2P')).toBeInTheDocument()
  expect(row('发送端路径策略').getByText('TURN · 24.00 Mbps')).toBeInTheDocument()
  view.rerender(<RemoteMediaDetails value={{ ...value, sample: undefined, presentation: { ...value.presentation!, configRevision: 6n } }} zh />)
  expect(row('画面确认').getByText('已确认')).toBeInTheDocument()
  expect(row('媒体路径（本地观测）').getByText('未知')).toBeInTheDocument()
  expect(row('协议 / ICE RTT').getByText('— / —')).toBeInTheDocument()
})

test('RFB 仅显示自身传输，不展示 H.264 和虚构解码器', () => {
  render(<RemoteMediaDetails value={{ ...value, transport: 'rfb' }} zh />)
  expect(screen.getByText('WebRTC DataChannel / RFB')).toBeInTheDocument()
  expect(screen.queryByText('协商上限')).not.toBeInTheDocument()
  expect(screen.queryByText(/硬件解码|Hardware decoder/)).not.toBeInTheDocument()
})
