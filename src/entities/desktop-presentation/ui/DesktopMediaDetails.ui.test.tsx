import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { RemoteDesktopMediaDetails } from '#entities/remote-desktop'
import { DesktopMediaDetails } from './DesktopMediaDetails'

const value: RemoteDesktopMediaDetails = {
  connectionId: 'control', title: 'Display 2', transport: 'h264', phase: 'viewing',
  presentation: {
    capabilities: { kind: 'video', available: true, maxBitrate: 100_000_000, videoLimitsVersion: 3 },
    status: 'confirmed', revision: 1n, configRevision: 5n,
    codec: { negotiated: { mimeType: 'video/H264', profile: 'constrained_baseline', receiverLevel: 51, negotiatedLevel: 51, packetizationMode: 1, profileLevelId: '42e033' }, applied: { configRevision: 6n, level: 42 } },
    transport: { revision: 2n, path: 'relay', bitrateLimit: 24_000_000 },
  },
  sample: { attachmentId: 'media', mediaGeneration: 1n, sampledAt: 1000, path: 'direct', protocol: 'udp', localRelayProtocol: 'none', rttMs: 3 },
}

test('协商上限、应用等级、画面确认和两端路径分别展示并实时更新', () => {
  const view = render(<DesktopMediaDetails value={value} zh />)
  const row = (label: string) => within(screen.getByText(label).closest('div')!)
  expect(row('接收声明上限').getByText('5.1')).toBeInTheDocument()
  expect(row('已应用编码等级').getByText('4.2')).toBeInTheDocument()
  expect(row('画面确认').getByText('未确认')).toBeInTheDocument()
  expect(row('媒体路径').getByText('P2P 直连')).toBeInTheDocument()
  expect(row('TURN 接入（本机）').getByText('未使用')).toBeInTheDocument()
  expect(row('发送端路径策略').getByText('TURN · 24.00 Mbps')).toBeInTheDocument()
  view.rerender(<DesktopMediaDetails value={{ ...value, sample: undefined, presentation: { ...value.presentation!, configRevision: 6n } }} zh />)
  expect(row('画面确认').getByText('已确认')).toBeInTheDocument()
  expect(row('媒体路径').getByText('待确认')).toBeInTheDocument()
  expect(row('往返延迟').getByText('—')).toBeInTheDocument()
  expect(row('TURN 接入（本机）').getByText('未知')).toBeInTheDocument()
})

test('TURN 接入展示原生本机协议，候选 UDP 不覆盖 TLS', () => {
  render(<DesktopMediaDetails value={{ ...value, sample: { ...value.sample!, path: 'relay', localRelayProtocol: 'tls' } }} zh />)
  expect(within(screen.getByText('TURN 接入（本机）').closest('div')!).getByText('TLS')).toBeInTheDocument()
  expect(within(screen.getByText('传输协议').closest('div')!).getByText('UDP')).toBeInTheDocument()
})

test('RFB 仅显示自身传输，不展示 H.264 和虚构解码器', () => {
  render(<DesktopMediaDetails value={{ ...value, transport: 'rfb' }} zh />)
  expect(screen.getByText('WebRTC DataChannel / RFB')).toBeInTheDocument()
  expect(screen.queryByText('协商上限')).not.toBeInTheDocument()
  expect(screen.queryByText(/硬件解码|Hardware decoder/)).not.toBeInTheDocument()
})

test('初次连接及恢复期间不显示旧媒体样本，零速率仍是有效实测值', () => {
  const sample = { ...value.sample!, bitrate: 0, framerate: 0, lossPerMille: 0, jitterMs: 0 }
  const presentation = { ...value.presentation!, configRevision: 6n }
  const view = render(<DesktopMediaDetails value={{ ...value, presentation, sample }} zh />)
  expect(screen.getByText('0.00 Mbps')).toBeInTheDocument()
  expect(screen.getByText('0.0 fps')).toBeInTheDocument()
  expect(screen.getByText('0.0% / 0.0 ms')).toBeInTheDocument()
  expect(screen.getByText('已确认')).toBeInTheDocument()
  view.rerender(<DesktopMediaDetails value={{ ...value, presentation, phase: 'recovering', sample }} zh />)
  expect(screen.queryByText('0.00 Mbps')).not.toBeInTheDocument()
  expect(screen.queryByText('0.0 fps')).not.toBeInTheDocument()
  expect(screen.queryByText('P2P 直连')).not.toBeInTheDocument()
  expect(screen.getByText('未确认')).toBeInTheDocument()
})
